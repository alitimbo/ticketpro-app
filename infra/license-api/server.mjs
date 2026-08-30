import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import { subscriptionNotificationEvent } from "./subscription-notification-policy.mjs";

const PORT = Number(process.env.LICENSE_PORT ?? 8787);
const HOST = process.env.LICENSE_BIND ?? "127.0.0.1";
const DB_PATH = process.env.LICENSE_DB ?? "/data/licenses.sqlite";
const APP_UPDATE_MANIFEST_PATH = process.env.APP_UPDATE_MANIFEST_PATH
  ?? path.join(path.dirname(DB_PATH), "app-updates", "stable.json");
const MASTER_TOKEN = process.env.LICENSE_MASTER_TOKEN ?? "";
const HASH_SECRET = process.env.LICENSE_HASH_SECRET ?? "";
const ROUTER_VAULT_KEY = process.env.ROUTER_VAULT_KEY ?? "";
const TICKET_ARCHIVE_KEY = process.env.TICKET_ARCHIVE_KEY ?? "";
const IPAY_BASE_URL = String(process.env.IPAY_BASE_URL ?? "https://api.i-pay.money").replace(/\/$/, "");
const IPAY_ENV = process.env.IPAY_ENV ?? "";
const IPAY_PUBLIC_KEY = process.env.IPAY_PUBLIC_KEY ?? "";
const IPAY_PRIVATE_KEY = process.env.IPAY_PRIVATE_KEY ?? "";
const IPAY_SECRET_HASH = process.env.IPAY_SECRET_HASH ?? "";
const VPN_HUB_URL = String(process.env.VPN_HUB_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const VPN_HUB_MASTER_TOKEN = process.env.VPN_HUB_MASTER_TOKEN ?? "";
const VPN_CLIENT_ALLOWED_IPS = parseVpnClientAllowedIps(
  process.env.VPN_CLIENT_ALLOWED_IPS ?? "10.250.0.0/16"
);
const SAAS_PASSWORD_RESET_URL = String(
  process.env.SAAS_PASSWORD_RESET_URL ?? "https://www.ticketpro-ne.com/reset-password"
);
const SAAS_INVITATION_URL = String(
  process.env.SAAS_INVITATION_URL ?? "https://www.ticketpro-ne.com/accept-invitation"
);
const SAAS_SUBSCRIPTION_URL = String(
  process.env.SAAS_SUBSCRIPTION_URL ?? "https://www.ticketpro-ne.com/"
);
const SMTP_HOST = String(process.env.SMTP_HOST ?? "");
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? "true") === "true";
const SMTP_USER = String(process.env.SMTP_USER ?? "");
const SMTP_PASSWORD = String(process.env.SMTP_PASSWORD ?? "");
const SMTP_FROM_EMAIL = String(process.env.SMTP_FROM_EMAIL ?? SMTP_USER);
const SMTP_FROM_NAME = String(process.env.SMTP_FROM_NAME ?? "TicketPro");
const SAAS_EXPOSE_RESET_TOKEN = process.env.SAAS_EXPOSE_RESET_TOKEN === "true";
const parsedInvitationTtlHours = Number(process.env.SAAS_INVITATION_TTL_HOURS ?? 24);
const SAAS_INVITATION_TTL_HOURS = Number.isFinite(parsedInvitationTtlHours)
  ? Math.min(168, Math.max(1, Math.trunc(parsedInvitationTtlHours)))
  : 24;
const parsedMaxBodyBytes = Number(process.env.LICENSE_MAX_BODY_BYTES ?? 256 * 1024);
const MAX_BODY_BYTES = Number.isFinite(parsedMaxBodyBytes)
  ? Math.min(1024 * 1024, Math.max(64 * 1024, Math.trunc(parsedMaxBodyBytes)))
  : 256 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.LICENSE_RATE_LIMIT_MAX ?? 60));
const SAAS_TRIAL_DAYS = 7;
const SAAS_TRIAL_ROUTER_LIMIT = 1;
const SAAS_TRIAL_PLAN_ID = "ticketpro-trial-7-days";
const SAAS_TRIAL_PLAN_CODE = "TRIAL-7D";
const SAAS_PAID_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;
const CLIENT_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;
const SUBSCRIPTION_NOTIFICATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VPN_RECONCILIATION_INTERVAL_MS = Number(
  process.env.VPN_RECONCILIATION_INTERVAL_MS ?? 60_000
);
const ORGANIZATION_APP_ROLES = new Set(["admin", "operator", "agent", "guest"]);
const ORGANIZATION_ROLE_PERMISSIONS = {
  admin: [
    "global.home", "global.routers", "global.routers.select", "global.routers.manage",
    "global.routers.add", "global.routers.edit", "global.routers.delete", "global.vpn",
    "global.settings", "global.team", "router.home", "router.plans.read", "router.plans.write",
    "router.tickets.read", "router.tickets.generate", "router.tickets.reprint",
    "router.tickets.disable", "router.tickets.delete", "router.tickets.sync",
    "router.tickets.revealPassword", "router.files.read", "router.report.read",
    "router.clients.read", "router.clients.disconnect", "router.network.read",
    "router.logs.read", "router.logs.clean", "router.settings", "router.settings.manage"
  ],
  operator: [
    "global.home", "global.routers", "global.routers.select", "router.home",
    "router.plans.read", "router.tickets.read", "router.tickets.generate",
    "router.tickets.reprint", "router.files.read", "router.report.read",
    "router.clients.read"
  ],
  agent: [
    "global.home", "global.routers.select", "router.home", "router.tickets.generate",
    "router.tickets.own", "router.tickets.reprint", "router.files.own", "router.report.own"
  ],
  guest: [
    "global.home", "global.routers.select", "router.home", "router.tickets.read",
    "router.report.read", "router.network.read"
  ]
};
const rateLimits = new Map();
let smtpTransporter = null;

if (HASH_SECRET.length < 32) {
  throw new Error("LICENSE_HASH_SECRET doit contenir au moins 32 caractères.");
}
const routerVaultKey = decodeRouterVaultKey(ROUTER_VAULT_KEY);
const ticketArchiveKey = decodeOptionalTicketArchiveKey(TICKET_ARCHIVE_KEY);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    router_limit INTEGER NOT NULL CHECK(router_limit > 0),
    max_devices INTEGER NOT NULL CHECK(max_devices > 0),
    device_limit_mode TEXT NOT NULL DEFAULT 'limited' CHECK(device_limit_mode IN ('limited', 'unlimited')),
    duration_days INTEGER NOT NULL CHECK(duration_days > 0),
    price_cfa INTEGER,
    billing_period TEXT NOT NULL CHECK(billing_period IN ('monthly', 'yearly', 'custom')),
    offer_code TEXT,
    purchase_mode TEXT NOT NULL DEFAULT 'online' CHECK(purchase_mode IN ('online', 'contact')),
    is_recommended INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('issued', 'active', 'expired', 'revoked')),
    duration_days INTEGER NOT NULL CHECK(duration_days > 0),
    router_limit INTEGER NOT NULL CHECK(router_limit > 0),
    label TEXT,
    notes TEXT,
    activated_account_id TEXT,
    device_id_hash TEXT,
    device_proof_hash TEXT,
    install_id TEXT,
    activation_token_hash TEXT,
    issued_at TEXT NOT NULL,
    activated_at TEXT,
    expires_at TEXT,
    last_seen_at TEXT,
    router_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS license_activations (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    device_id_hash TEXT NOT NULL,
    device_proof_hash TEXT NOT NULL,
    install_id TEXT NOT NULL,
    activation_token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
    activated_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(license_id, account_id, device_id_hash, install_id)
  );

  CREATE TABLE IF NOT EXISTS license_router_sources (
    license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    activation_id TEXT NOT NULL REFERENCES license_activations(id) ON DELETE CASCADE,
    router_fingerprint_hash TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (license_id, activation_id, router_fingerprint_hash)
  );

  CREATE TABLE IF NOT EXISTS license_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT,
    event_type TEXT NOT NULL,
    account_id TEXT,
    device_id_hash TEXT,
    ip_address TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reseller_accounts (
    id TEXT PRIMARY KEY,
    plan_id TEXT REFERENCES plans(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'revoked')),
    router_capacity INTEGER NOT NULL CHECK(router_capacity > 0),
    max_child_devices INTEGER NOT NULL CHECK(max_child_devices > 0),
    max_child_duration_days INTEGER NOT NULL CHECK(max_child_duration_days > 0),
    issued_at TEXT NOT NULL,
    expires_at TEXT,
    last_seen_at TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'support')),
    status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
    must_change_password INTEGER NOT NULL DEFAULT 1,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK(actor_type IN ('admin', 'reseller')),
    actor_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK(actor_type IN ('admin', 'reseller')),
    actor_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by_admin_id TEXT,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending_payment', 'active', 'suspended')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organization_users (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
    status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organization_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organization_password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organization_user_router_access (
    user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, router_id)
  );

  CREATE TABLE IF NOT EXISTS organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
    authority_role TEXT NOT NULL CHECK(authority_role IN ('owner', 'member')),
    app_role TEXT NOT NULL CHECK(app_role IN ('admin', 'operator', 'agent', 'guest')),
    status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
    router_access_mode TEXT NOT NULL CHECK(router_access_mode IN ('all', 'selected')),
    invitation_status TEXT NOT NULL CHECK(invitation_status IN ('pending', 'accepted')),
    created_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accepted_at TEXT,
    last_used_at TEXT,
    UNIQUE (organization_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS organization_membership_router_access (
    membership_id TEXT NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (membership_id, router_id)
  );

  CREATE TABLE IF NOT EXISTS organization_invitation_tokens (
    id TEXT PRIMARY KEY,
    membership_id TEXT NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    requires_password INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organization_subscriptions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    plan_code TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'cancelled')),
    router_limit INTEGER NOT NULL CHECK(router_limit > 0),
    max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices > 0),
    device_limit_mode TEXT NOT NULL DEFAULT 'limited' CHECK(device_limit_mode IN ('limited', 'unlimited')),
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XOF',
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    payment_order_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS router_access_policies (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    updated_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, router_id)
  );

  CREATE TABLE IF NOT EXISTS organization_devices (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    registered_by_user_id TEXT REFERENCES organization_users(id) ON DELETE SET NULL,
    installation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('windows', 'macos', 'linux')),
    os_version TEXT,
    app_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'offline', 'stale', 'revoked')),
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (organization_id, installation_id)
  );

  CREATE TABLE IF NOT EXISTS organization_vpn_peers (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE REFERENCES organization_devices(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL DEFAULT 'gateway-africa-west-1',
    public_key TEXT NOT NULL UNIQUE,
    vpn_ip TEXT UNIQUE,
    key_version INTEGER NOT NULL DEFAULT 1 CHECK(key_version > 0),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
    desired_state TEXT NOT NULL CHECK(desired_state IN ('enabled', 'disabled')),
    applied_state TEXT NOT NULL CHECK(applied_state IN ('pending', 'enabled', 'disabled', 'error')),
    last_handshake_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS subscription_notifications (
    subscription_id TEXT NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sending', 'sent')),
    created_at TEXT NOT NULL,
    sent_at TEXT,
    PRIMARY KEY (subscription_id, event_key, recipient_email)
  );

  CREATE TABLE IF NOT EXISTS router_access_policy_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    policy_json TEXT NOT NULL,
    changed_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    changed_at TEXT NOT NULL,
    UNIQUE (organization_id, router_id, revision)
  );

  CREATE TABLE IF NOT EXISTS organization_routers (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stable_identity TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    model TEXT,
    board_name TEXT,
    serial_number TEXT,
    routeros_version TEXT,
    local_ip TEXT NOT NULL,
    hotspot_address TEXT,
    notes TEXT,
    api_port INTEGER NOT NULL,
    api_ssl_port INTEGER NOT NULL,
    username TEXT NOT NULL,
    credential_ciphertext TEXT NOT NULL,
    connection_mode TEXT NOT NULL CHECK(connection_mode IN ('local', 'vpn', 'distant_ip', 'agent_future')),
    connections_json TEXT NOT NULL,
    plans_json TEXT NOT NULL,
    vpn_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('active', 'offline', 'warning')),
    last_seen_at TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    updated_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (organization_id, stable_identity)
  );

  CREATE TABLE IF NOT EXISTS organization_ticket_batches (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL REFERENCES organization_routers(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    operator_profile TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    prefix TEXT,
    code_length INTEGER NOT NULL,
    status TEXT NOT NULL,
    hotspot_server_name TEXT NOT NULL,
    currency TEXT NOT NULL,
    price_snapshot INTEGER,
    sync_status TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_by_name TEXT NOT NULL,
    created_by_email TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organization_tickets (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL REFERENCES organization_routers(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES organization_ticket_batches(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_is_username INTEGER NOT NULL DEFAULT 0 CHECK(password_is_username IN (0, 1)),
    status TEXT NOT NULL,
    mac_address TEXT,
    ip_address TEXT,
    activated_at TEXT,
    completed_at TEXT,
    expires_at TEXT,
    deleted_at TEXT,
    printed_count INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_bytes INTEGER NOT NULL DEFAULT 0,
    mikrotik_id TEXT,
    hotspot_server_name TEXT NOT NULL,
    mikrotik_profile_name TEXT,
    exported_at TEXT,
    archived_at TEXT,
    router_deleted_at TEXT,
    last_router_sync_at TEXT,
    uptime_seconds INTEGER NOT NULL DEFAULT 0,
    remaining_seconds INTEGER,
    data_remaining_bytes INTEGER,
    duration_minutes_snapshot INTEGER,
    validity_minutes_snapshot INTEGER,
    data_limit_mb_snapshot INTEGER,
    download_limit_snapshot TEXT,
    upload_limit_snapshot TEXT,
    shared_users_snapshot INTEGER,
    sync_status TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_by_name TEXT NOT NULL,
    created_by_email TEXT NOT NULL,
    created_by_role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (organization_id, router_id, username)
  );

  CREATE TABLE IF NOT EXISTS organization_generated_files (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL REFERENCES organization_routers(id) ON DELETE CASCADE,
    batch_id TEXT,
    type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    format TEXT NOT NULL,
    metadata_json TEXT,
    sync_status TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_by_name TEXT NOT NULL,
    created_by_email TEXT NOT NULL,
    created_by_role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    print_archive_ciphertext TEXT,
    print_archive_iv TEXT,
    print_archive_tag TEXT,
    print_archive_version INTEGER,
    print_archive_updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS organization_activity_logs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    router_id TEXT NOT NULL REFERENCES organization_routers(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    user_message TEXT NOT NULL,
    technical_message TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES organization_users(id),
    created_by_name TEXT NOT NULL,
    created_by_email TEXT NOT NULL,
    created_by_role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reseller_registrations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'cancelled')),
    order_id TEXT,
    reseller_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    purchaser_type TEXT NOT NULL CHECK(purchaser_type IN ('organization', 'reseller')),
    reseller_id TEXT REFERENCES reseller_accounts(id),
    reseller_registration_id TEXT REFERENCES reseller_registrations(id),
    plan_id TEXT NOT NULL,
    plan_code TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    router_limit INTEGER NOT NULL,
    max_devices INTEGER NOT NULL,
    device_limit_mode TEXT NOT NULL DEFAULT 'limited' CHECK(device_limit_mode IN ('limited', 'unlimited')),
    duration_days INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK(amount > 0),
    currency TEXT NOT NULL DEFAULT 'XOF',
    country TEXT NOT NULL DEFAULT 'NE',
    msisdn TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    payment_type TEXT NOT NULL CHECK(payment_type IN ('mobile', 'nita_online', 'amanata')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'succeeded', 'failed', 'cancelled')),
    fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('pending', 'fulfilled', 'failed')),
    provider_reference TEXT,
    provider_public_reference TEXT,
    access_token_hash TEXT NOT NULL UNIQUE,
    license_id TEXT,
    license_key_encrypted TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT,
    fulfilled_at TEXT,
    last_checked_at TEXT,
    failure_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id TEXT PRIMARY KEY,
    event_hash TEXT NOT NULL UNIQUE,
    transaction_id TEXT,
    provider_reference TEXT,
    provider_status TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    result TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_licenses_key_hash ON licenses(key_hash);
  CREATE INDEX IF NOT EXISTS idx_license_activations_license ON license_activations(license_id, status);
  CREATE INDEX IF NOT EXISTS idx_license_router_sources_license ON license_router_sources(license_id);
  CREATE INDEX IF NOT EXISTS idx_license_events_license ON license_events(license_id);
  CREATE INDEX IF NOT EXISTS idx_reseller_accounts_token ON reseller_accounts(token_hash);
  CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor ON auth_sessions(actor_type, actor_id);
  CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_organization_users_email ON organization_users(email);
  CREATE INDEX IF NOT EXISTS idx_organization_users_organization ON organization_users(organization_id);
  CREATE INDEX IF NOT EXISTS idx_organization_router_access_user
    ON organization_user_router_access(user_id);
  CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
    ON organization_memberships(user_id, status, invitation_status);
  CREATE INDEX IF NOT EXISTS idx_organization_memberships_organization
    ON organization_memberships(organization_id, status);
  CREATE INDEX IF NOT EXISTS idx_membership_router_access_membership
    ON organization_membership_router_access(membership_id);
  CREATE INDEX IF NOT EXISTS idx_organization_invitation_token
    ON organization_invitation_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_organization_sessions_token ON organization_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_organization
    ON organization_subscriptions(organization_id, current_period_end);
  CREATE INDEX IF NOT EXISTS idx_organization_devices_organization
    ON organization_devices(organization_id, status, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_vpn_peers_desired_state
    ON organization_vpn_peers(desired_state, applied_state, updated_at);
  CREATE INDEX IF NOT EXISTS idx_subscription_notifications_status
    ON subscription_notifications(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_router_access_policies_organization
    ON router_access_policies(organization_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_router_access_policy_history_router
    ON router_access_policy_history(organization_id, router_id, revision DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_routers_organization
    ON organization_routers(organization_id, deleted_at, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_ticket_batches_router
    ON organization_ticket_batches(organization_id, router_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_tickets_router
    ON organization_tickets(organization_id, router_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_tickets_creator
    ON organization_tickets(organization_id, created_by_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_generated_files_router
    ON organization_generated_files(organization_id, router_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_generated_files_creator
    ON organization_generated_files(organization_id, created_by_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_organization_activity_logs_router
    ON organization_activity_logs(organization_id, router_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_transaction ON payment_orders(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_reseller ON payment_orders(reseller_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_registration ON payment_orders(reseller_registration_id);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, fulfillment_status);
`);

ensureColumn("plans", "is_reseller", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("plans", "device_limit_mode", "TEXT NOT NULL DEFAULT 'limited'");
ensureColumn("plans", "offer_code", "TEXT");
ensureColumn("plans", "purchase_mode", "TEXT NOT NULL DEFAULT 'online'");
ensureColumn("licenses", "plan_id", "TEXT");
ensureColumn("licenses", "plan_code", "TEXT");
ensureColumn("licenses", "plan_name", "TEXT");
ensureColumn("licenses", "plan_description", "TEXT");
ensureColumn("licenses", "price_cfa", "INTEGER");
ensureColumn("licenses", "billing_period", "TEXT NOT NULL DEFAULT 'custom'");
ensureColumn("licenses", "max_devices", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("licenses", "device_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("licenses", "license_type", "TEXT NOT NULL DEFAULT 'standard'");
ensureColumn("licenses", "reseller_id", "TEXT");
ensureColumn("licenses", "activation_deadline_at", "TEXT");
ensureColumn("reseller_accounts", "email", "TEXT");
ensureColumn("reseller_accounts", "password_hash", "TEXT");
ensureColumn("reseller_accounts", "must_change_password", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("reseller_accounts", "failed_login_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("reseller_accounts", "locked_until", "TEXT");
ensureColumn("reseller_accounts", "updated_at", "TEXT");
ensureColumn("reseller_accounts", "last_login_at", "TEXT");
ensureColumn("payment_orders", "reseller_registration_id", "TEXT");
ensureColumn("payment_orders", "organization_id", "TEXT");
ensureColumn("payment_orders", "organization_user_id", "TEXT");
ensureColumn("payment_orders", "device_limit_mode", "TEXT NOT NULL DEFAULT 'limited'");
ensureColumn("organization_users", "app_role", "TEXT NOT NULL DEFAULT 'operator'");
ensureColumn("organization_users", "router_access_mode", "TEXT NOT NULL DEFAULT 'selected'");
ensureColumn("organization_users", "invitation_pending", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("organization_users", "created_by_user_id", "TEXT");
ensureColumn("organization_sessions", "active_membership_id", "TEXT");
ensureColumn("organization_subscriptions", "max_devices", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("organization_subscriptions", "device_limit_mode", "TEXT NOT NULL DEFAULT 'limited'");
ensureColumn("organization_tickets", "duration_minutes_snapshot", "INTEGER");
ensureColumn("organization_tickets", "validity_minutes_snapshot", "INTEGER");
ensureColumn("organization_tickets", "data_limit_mb_snapshot", "INTEGER");
ensureColumn("organization_tickets", "download_limit_snapshot", "TEXT");
ensureColumn("organization_tickets", "upload_limit_snapshot", "TEXT");
ensureColumn("organization_tickets", "shared_users_snapshot", "INTEGER");
ensureColumn("organization_generated_files", "print_archive_ciphertext", "TEXT");
ensureColumn("organization_generated_files", "print_archive_iv", "TEXT");
ensureColumn("organization_generated_files", "print_archive_tag", "TEXT");
ensureColumn("organization_generated_files", "print_archive_version", "INTEGER");
ensureColumn("organization_generated_files", "print_archive_updated_at", "TEXT");
migrateOrganizationVpnPeersForSharedDevices();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_licenses_reseller ON licenses(reseller_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_accounts_email
    ON reseller_accounts(email) WHERE email IS NOT NULL;
`);
db.exec(`
  UPDATE organization_users
  SET app_role = 'admin', router_access_mode = 'all'
  WHERE role IN ('owner', 'admin');

  INSERT OR IGNORE INTO organization_memberships (
    id, organization_id, user_id, authority_role, app_role, status,
    router_access_mode, invitation_status, created_by_user_id,
    created_at, updated_at, accepted_at, last_used_at
  )
  SELECT
    'membership:' || organization_id || ':' || id,
    organization_id,
    id,
    CASE WHEN role = 'owner' THEN 'owner' ELSE 'member' END,
    CASE WHEN role = 'owner' THEN 'admin' ELSE app_role END,
    status,
    CASE WHEN role = 'owner' THEN 'all' ELSE router_access_mode END,
    CASE WHEN invitation_pending = 1 THEN 'pending' ELSE 'accepted' END,
    created_by_user_id,
    created_at,
    updated_at,
    CASE WHEN invitation_pending = 1 THEN NULL ELSE created_at END,
    last_login_at
  FROM organization_users;

  INSERT OR IGNORE INTO organization_membership_router_access (membership_id, router_id, created_at)
  SELECT membership.id, access.router_id, membership.created_at
  FROM organization_user_router_access AS access
  JOIN organization_memberships AS membership ON membership.user_id = access.user_id;

  UPDATE organization_sessions
  SET active_membership_id = (
    SELECT membership.id
    FROM organization_memberships AS membership
    WHERE membership.user_id = organization_sessions.user_id
    ORDER BY CASE membership.authority_role WHEN 'owner' THEN 0 ELSE 1 END
    LIMIT 1
  )
  WHERE active_membership_id IS NULL;
`);

const timestamp = nowIso();
const seedPlan = db.prepare(`
  INSERT OR IGNORE INTO plans (
    id, code, name, description, router_limit, max_devices, duration_days,
    price_cfa, billing_period, is_recommended, is_active, is_reseller, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'monthly', ?, 1, ?, ?, ?, ?)
`);
[
  ["subscription-plan-1-router", "STARTER-1", "Pack 1 routeur", "Pour un seul site WiFi.", 1, 1, 30, 1500, 0, 0, 10],
  ["subscription-plan-5-routers", "PRO-5", "Pack 5 routeurs", "Pour les petits exploitants multi-zones.", 5, 2, 30, 6000, 1, 0, 20],
  ["subscription-plan-10-routers", "BUSINESS-10", "Pack 10 routeurs", "Pour les gérants et techniciens en croissance.", 10, 5, 30, 10000, 0, 0, 30],
  ["subscription-plan-50-routers", "RESELLER-50", "Pack Revendeur 50", "Pour revendre des sous-licences isolées.", 50, 25, 30, 40000, 0, 1, 40],
  ["subscription-plan-100-routers", "RESELLER-100", "Pack Revendeur 100", "Pour revendre des sous-licences isolées.", 100, 100, 30, 70000, 0, 1, 50]
].forEach((plan) => seedPlan.run(...plan, timestamp, timestamp));
const seedSaasCatalogPlan = db.prepare(`
  INSERT OR IGNORE INTO plans (
    id, code, name, description, router_limit, max_devices, device_limit_mode,
    duration_days, price_cfa, billing_period, offer_code, purchase_mode,
    is_recommended, is_active, is_reseller, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
`);
[
  ["subscription-starter-monthly", "STARTER-MONTHLY", "STARTER", "Pour une petite WiFi Zone qui démarre.", 1, 2, "limited", 30, 5000, "monthly", "STARTER", "online", 0, 10],
  ["subscription-starter-yearly", "STARTER-YEARLY", "STARTER", "Pour une petite WiFi Zone qui démarre.", 1, 2, "limited", 365, 50000, "yearly", "STARTER", "online", 0, 10],
  ["subscription-growth-monthly", "GROWTH-MONTHLY", "GROWTH", "Pour plusieurs points d'accès et une petite équipe.", 5, 4, "limited", 30, 10000, "monthly", "GROWTH", "online", 0, 20],
  ["subscription-growth-yearly", "GROWTH-YEARLY", "GROWTH", "Pour plusieurs points d'accès et une petite équipe.", 5, 4, "limited", 365, 100000, "yearly", "GROWTH", "online", 0, 20],
  ["subscription-pro-monthly", "PRO-MONTHLY", "PRO", "Pour les exploitants multi-sites et leurs techniciens.", 20, 10, "limited", 30, 20000, "monthly", "PRO", "online", 1, 30],
  ["subscription-pro-yearly", "PRO-YEARLY", "PRO", "Pour les exploitants multi-sites et leurs techniciens.", 20, 10, "limited", 365, 200000, "yearly", "PRO", "online", 1, 30],
  ["subscription-ultra-monthly", "ULTRA-MONTHLY", "ULTRA", "Pour les grands opérateurs et intégrateurs.", 100, 25, "limited", 30, 40000, "monthly", "ULTRA", "online", 0, 40],
  ["subscription-ultra-yearly", "ULTRA-YEARLY", "ULTRA", "Pour les grands opérateurs et intégrateurs.", 100, 25, "limited", 365, 400000, "yearly", "ULTRA", "online", 0, 40],
  ["subscription-enterprise-contact", "ENTERPRISE-CONTACT", "ENTREPRISE", "Capacité, appareils et accompagnement sur mesure.", 1000, 1, "unlimited", 365, null, "custom", "ENTERPRISE", "contact", 0, 50]
].forEach((plan) => seedSaasCatalogPlan.run(...plan, timestamp, timestamp));
db.exec("UPDATE plans SET is_reseller = 1 WHERE code LIKE 'RESELLER-%';");
db.exec(`
  UPDATE plans
  SET is_active = 0, updated_at = '${timestamp}'
  WHERE id IN (
    'subscription-plan-1-router',
    'subscription-plan-5-routers',
    'subscription-plan-10-routers'
  );

  UPDATE plans
  SET offer_code = COALESCE(NULLIF(offer_code, ''), code)
  WHERE offer_code IS NULL OR offer_code = '';

  UPDATE plans
  SET device_limit_mode = 'unlimited'
  WHERE is_reseller = 0 AND max_devices >= 100000;

  UPDATE payment_orders
  SET device_limit_mode = 'unlimited'
  WHERE purchaser_type = 'organization' AND max_devices >= 100000;

  UPDATE organization_subscriptions
  SET device_limit_mode = 'unlimited'
  WHERE max_devices >= 100000;

  -- Les abonnements conservent l'instantané commercial acheté. Une modification
  -- ultérieure du catalogue ne doit jamais changer leurs droits rétroactivement.
`);

const statements = {
  listPlans: db.prepare(`
    SELECT * FROM plans
    WHERE is_active = 1 AND is_reseller = 0 AND purchase_mode = 'online'
    ORDER BY sort_order ASC, router_limit ASC, duration_days ASC
  `),
  listPublicCatalogPlans: db.prepare(`
    SELECT * FROM plans
    WHERE is_active = 1 AND is_reseller = 0
    ORDER BY sort_order ASC, router_limit ASC, duration_days ASC
  `),
  listAllPlans: db.prepare(`
    SELECT * FROM plans WHERE is_reseller = 0 ORDER BY sort_order ASC, router_limit ASC
  `),
  findPlanById: db.prepare("SELECT * FROM plans WHERE id = ?"),
  clearRecommendedPlans: db.prepare(`
    UPDATE plans SET is_recommended = 0, updated_at = ?
    WHERE COALESCE(offer_code, code) <> ? AND is_reseller = 0
  `),
  setOfferRecommended: db.prepare(`
    UPDATE plans SET is_recommended = ?, updated_at = ?
    WHERE COALESCE(offer_code, code) = ? AND is_reseller = 0
  `),
  upsertPlan: db.prepare(`
    INSERT INTO plans (
      id, code, name, description, router_limit, max_devices, device_limit_mode, duration_days,
      price_cfa, billing_period, offer_code, purchase_mode,
      is_recommended, is_active, is_reseller, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code, name = excluded.name, description = excluded.description,
      router_limit = excluded.router_limit, max_devices = excluded.max_devices,
      device_limit_mode = excluded.device_limit_mode,
      duration_days = excluded.duration_days, price_cfa = excluded.price_cfa,
      billing_period = excluded.billing_period, is_recommended = excluded.is_recommended,
      offer_code = excluded.offer_code, purchase_mode = excluded.purchase_mode,
      is_active = excluded.is_active, is_reseller = excluded.is_reseller,
      sort_order = excluded.sort_order, updated_at = excluded.updated_at
  `),
  findLicenseByKey: db.prepare("SELECT * FROM licenses WHERE key_hash = ?"),
  findLicenseById: db.prepare("SELECT * FROM licenses WHERE id = ?"),
  insertLicense: db.prepare(`
    INSERT INTO licenses (
      id, key_hash, status, plan_id, plan_code, plan_name, plan_description,
      duration_days, router_limit, max_devices, price_cfa, billing_period,
      label, notes, issued_at, license_type, reseller_id, activation_deadline_at
    ) VALUES (?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  startLicense: db.prepare(`
    UPDATE licenses SET status = 'active', activated_at = ?, expires_at = ?, last_seen_at = ? WHERE id = ?
  `),
  touchLicense: db.prepare(`
    UPDATE licenses SET status = ?, last_seen_at = ?, router_count = ?, device_count = ? WHERE id = ?
  `),
  revokeLicense: db.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?"),
  findActivationByDevice: db.prepare(`
    SELECT * FROM license_activations
    WHERE license_id = ? AND account_id = ? AND device_id_hash = ? AND install_id = ? LIMIT 1
  `),
  findActivationByToken: db.prepare(`
    SELECT * FROM license_activations WHERE license_id = ? AND activation_token_hash = ? LIMIT 1
  `),
  insertActivation: db.prepare(`
    INSERT INTO license_activations (
      id, license_id, account_id, device_id_hash, device_proof_hash, install_id,
      activation_token_hash, status, activated_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `),
  rotateActivationToken: db.prepare(`
    UPDATE license_activations SET activation_token_hash = ?, device_proof_hash = ?,
      status = 'active', last_seen_at = ? WHERE id = ?
  `),
  touchActivation: db.prepare("UPDATE license_activations SET last_seen_at = ? WHERE id = ?"),
  revokeActivation: db.prepare(`
    UPDATE license_activations SET status = 'revoked' WHERE id = ? AND license_id = ?
  `),
  revokeAllActivations: db.prepare("UPDATE license_activations SET status = 'revoked' WHERE license_id = ?"),
  countDevices: db.prepare(`
    SELECT COUNT(*) AS count FROM license_activations WHERE license_id = ? AND status = 'active'
  `),
  listActivations: db.prepare(`
    SELECT id, account_id, install_id, status, activated_at, last_seen_at
    FROM license_activations WHERE license_id = ? ORDER BY activated_at ASC
  `),
  deleteRouterSourcesForActivation: db.prepare("DELETE FROM license_router_sources WHERE activation_id = ?"),
  upsertRouterSource: db.prepare(`
    INSERT INTO license_router_sources (
      license_id, activation_id, router_fingerprint_hash, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(license_id, activation_id, router_fingerprint_hash)
    DO UPDATE SET last_seen_at = excluded.last_seen_at
  `),
  otherRouterSources: db.prepare(`
    SELECT DISTINCT router_fingerprint_hash FROM license_router_sources
    WHERE license_id = ? AND activation_id <> ?
  `),
  countRouters: db.prepare(`
    SELECT COUNT(DISTINCT router_fingerprint_hash) AS count FROM license_router_sources WHERE license_id = ?
  `),
  insertEvent: db.prepare(`
    INSERT INTO license_events
      (license_id, event_type, account_id, device_id_hash, ip_address, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertReseller: db.prepare(`
    INSERT INTO reseller_accounts (
      id, plan_id, name, email, password_hash, token_hash, status, router_capacity,
      max_child_devices, max_child_duration_days, issued_at, expires_at, last_seen_at,
      updated_at, notes, must_change_password
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `),
  findResellerById: db.prepare("SELECT * FROM reseller_accounts WHERE id = ?"),
  findResellerByEmail: db.prepare("SELECT * FROM reseller_accounts WHERE email = ?"),
  findResellerByToken: db.prepare("SELECT * FROM reseller_accounts WHERE token_hash = ?"),
  listResellers: db.prepare(`
    SELECT id, plan_id, name, email, status, router_capacity, max_child_devices,
      max_child_duration_days, must_change_password, issued_at, expires_at,
      last_seen_at, last_login_at, notes
    FROM reseller_accounts ORDER BY issued_at DESC
  `),
  touchReseller: db.prepare("UPDATE reseller_accounts SET last_seen_at = ?, status = ? WHERE id = ?"),
  resellerLoginSucceeded: db.prepare(`
    UPDATE reseller_accounts SET failed_login_count = 0, locked_until = NULL,
      last_login_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?
  `),
  resellerLoginFailed: db.prepare(`
    UPDATE reseller_accounts SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?
  `),
  updateResellerPassword: db.prepare(`
    UPDATE reseller_accounts SET password_hash = ?, must_change_password = ?,
      failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?
  `),
  renewReseller: db.prepare(`
    UPDATE reseller_accounts SET status = 'active', expires_at = ?, router_capacity = ?,
      max_child_devices = ?, max_child_duration_days = ? WHERE id = ?
  `),
  topUpReseller: db.prepare(`
    UPDATE reseller_accounts SET status = 'active', expires_at = ?,
      router_capacity = router_capacity + ?, max_child_devices = ?,
      max_child_duration_days = ?, last_seen_at = ? WHERE id = ?
  `),
  revokeReseller: db.prepare("UPDATE reseller_accounts SET status = 'revoked' WHERE id = ?"),
  listResellerLicenses: db.prepare(`
    SELECT id, status, plan_code, plan_name, duration_days, router_limit, max_devices,
      label, issued_at, activation_deadline_at, activated_at, expires_at, router_count, device_count
    FROM licenses WHERE reseller_id = ? ORDER BY issued_at DESC
  `),
  consumedResellerCapacity: db.prepare(`
    SELECT COALESCE(SUM(router_limit), 0) AS consumed
    FROM licenses
    WHERE reseller_id = ?
  `),
  insertAdmin: db.prepare(`
    INSERT INTO admin_users (
      id, email, name, password_hash, role, status, must_change_password, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `),
  findAdminById: db.prepare("SELECT * FROM admin_users WHERE id = ?"),
  findAdminByEmail: db.prepare("SELECT * FROM admin_users WHERE email = ?"),
  listAdmins: db.prepare(`
    SELECT id, email, name, role, status, must_change_password, created_at, last_login_at
    FROM admin_users ORDER BY created_at ASC
  `),
  adminLoginSucceeded: db.prepare(`
    UPDATE admin_users SET failed_login_count = 0, locked_until = NULL,
      last_login_at = ?, updated_at = ? WHERE id = ?
  `),
  adminLoginFailed: db.prepare(`
    UPDATE admin_users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?
  `),
  updateAdminPassword: db.prepare(`
    UPDATE admin_users SET password_hash = ?, must_change_password = ?,
      failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?
  `),
  insertSession: db.prepare(`
    INSERT INTO auth_sessions (
      id, actor_type, actor_id, token_hash, created_at, expires_at, last_seen_at,
      ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  findSessionByToken: db.prepare(`
    SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1
  `),
  touchSession: db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?"),
  revokeSession: db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?"),
  revokeActorSessions: db.prepare(`
    UPDATE auth_sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL
  `),
  insertPasswordReset: db.prepare(`
    INSERT INTO password_reset_tokens (
      id, actor_type, actor_id, token_hash, expires_at, created_at, created_by_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  findPasswordReset: db.prepare(`
    SELECT * FROM password_reset_tokens
    WHERE token_hash = ? AND actor_type = ? AND used_at IS NULL LIMIT 1
  `),
  consumePasswordReset: db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"),
  insertOrganization: db.prepare(`
    INSERT INTO organizations (id, name, status, created_at, updated_at)
    VALUES (?, ?, 'pending_payment', ?, ?)
  `),
  findOrganizationById: db.prepare("SELECT * FROM organizations WHERE id = ?"),
  activateOrganization: db.prepare(`
    UPDATE organizations SET status = 'active', updated_at = ? WHERE id = ?
  `),
  insertOrganizationUser: db.prepare(`
    INSERT INTO organization_users (
      id, organization_id, email, name, phone, password_hash, role, status,
      app_role, router_access_mode, invitation_pending, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'owner', 'active', 'admin', 'all', 0, ?, ?)
  `),
  insertOrganizationMember: db.prepare(`
    INSERT INTO organization_users (
      id, organization_id, email, name, phone, password_hash, role, status,
      app_role, router_access_mode, invitation_pending, created_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'member', 'active', ?, ?, 1, ?, ?, ?)
  `),
  findOrganizationUserById: db.prepare("SELECT * FROM organization_users WHERE id = ?"),
  findOrganizationUserByEmail: db.prepare("SELECT * FROM organization_users WHERE email = ?"),
  updateOrganizationUserProfile: db.prepare(`
    UPDATE organization_users SET name = ?, phone = ?, updated_at = ? WHERE id = ?
  `),
  insertOrganizationMembership: db.prepare(`
    INSERT INTO organization_memberships (
      id, organization_id, user_id, authority_role, app_role, status,
      router_access_mode, invitation_status, created_by_user_id,
      created_at, updated_at, accepted_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `),
  findOrganizationMembershipById: db.prepare(`
    SELECT * FROM organization_memberships WHERE id = ?
  `),
  findOrganizationMembership: db.prepare(`
    SELECT * FROM organization_memberships WHERE organization_id = ? AND user_id = ?
  `),
  listAcceptedMembershipsByUser: db.prepare(`
    SELECT membership.*, organization.name AS organization_name,
      organization.status AS organization_status
    FROM organization_memberships AS membership
    JOIN organizations AS organization ON organization.id = membership.organization_id
    WHERE membership.user_id = ? AND membership.status = 'active'
      AND membership.invitation_status = 'accepted'
    ORDER BY COALESCE(membership.last_used_at, membership.created_at) DESC
  `),
  listOrganizationMemberships: db.prepare(`
    SELECT membership.*, user.email, user.name, user.phone, user.last_login_at,
      user.created_at AS user_created_at
    FROM organization_memberships AS membership
    JOIN organization_users AS user ON user.id = membership.user_id
    WHERE membership.organization_id = ?
    ORDER BY CASE membership.authority_role WHEN 'owner' THEN 0 ELSE 1 END,
      user.name COLLATE NOCASE
  `),
  updateOrganizationMembership: db.prepare(`
    UPDATE organization_memberships
    SET app_role = ?, router_access_mode = ?, status = ?, updated_at = ?
    WHERE id = ? AND organization_id = ? AND authority_role <> 'owner'
  `),
  acceptOrganizationMembershipsForUser: db.prepare(`
    UPDATE organization_memberships
    SET invitation_status = 'accepted', accepted_at = ?, updated_at = ?
    WHERE user_id = ? AND invitation_status = 'pending'
  `),
  acceptOrganizationMembership: db.prepare(`
    UPDATE organization_memberships
    SET invitation_status = 'accepted', accepted_at = ?, updated_at = ?
    WHERE id = ? AND invitation_status = 'pending'
  `),
  touchOrganizationMembership: db.prepare(`
    UPDATE organization_memberships SET last_used_at = ?, updated_at = ? WHERE id = ?
  `),
  deleteOrganizationMembership: db.prepare(`
    DELETE FROM organization_memberships
    WHERE id = ? AND organization_id = ? AND authority_role <> 'owner'
  `),
  clearMembershipRouterAccess: db.prepare(`
    DELETE FROM organization_membership_router_access WHERE membership_id = ?
  `),
  insertMembershipRouterAccess: db.prepare(`
    INSERT OR IGNORE INTO organization_membership_router_access (membership_id, router_id, created_at)
    VALUES (?, ?, ?)
  `),
  listMembershipRouterAccess: db.prepare(`
    SELECT router_id FROM organization_membership_router_access
    WHERE membership_id = ? ORDER BY router_id
  `),
  insertOrganizationInvitationToken: db.prepare(`
    INSERT INTO organization_invitation_tokens (
      id, membership_id, token_hash, requires_password, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),
  findOrganizationInvitationToken: db.prepare(`
    SELECT token.*, membership.organization_id, membership.user_id,
      membership.invitation_status, membership.status AS membership_status,
      organization.name AS organization_name,
      user.email, user.name
    FROM organization_invitation_tokens AS token
    JOIN organization_memberships AS membership ON membership.id = token.membership_id
    JOIN organizations AS organization ON organization.id = membership.organization_id
    JOIN organization_users AS user ON user.id = membership.user_id
    WHERE token.token_hash = ? AND token.used_at IS NULL
    LIMIT 1
  `),
  consumePendingOrganizationInvitationTokens: db.prepare(`
    UPDATE organization_invitation_tokens SET used_at = ?
    WHERE membership_id = ? AND used_at IS NULL
  `),
  listOrganizationUsers: db.prepare(`
    SELECT * FROM organization_users
    WHERE organization_id = ?
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name COLLATE NOCASE
  `),
  updateOrganizationMember: db.prepare(`
    UPDATE organization_users
    SET name = ?, app_role = ?, router_access_mode = ?, status = ?, updated_at = ?
    WHERE id = ? AND organization_id = ? AND role <> 'owner'
  `),
  deleteOrganizationMember: db.prepare(`
    DELETE FROM organization_users
    WHERE id = ? AND organization_id = ? AND role <> 'owner'
  `),
  markOrganizationInvitationAccepted: db.prepare(`
    UPDATE organization_users SET invitation_pending = 0, updated_at = ? WHERE id = ?
  `),
  clearOrganizationRouterAccess: db.prepare(`
    DELETE FROM organization_user_router_access WHERE user_id = ?
  `),
  insertOrganizationRouterAccess: db.prepare(`
    INSERT OR IGNORE INTO organization_user_router_access (user_id, router_id, created_at)
    VALUES (?, ?, ?)
  `),
  listOrganizationRouterAccess: db.prepare(`
    SELECT router_id FROM organization_user_router_access WHERE user_id = ? ORDER BY router_id
  `),
  organizationLoginSucceeded: db.prepare(`
    UPDATE organization_users SET failed_login_count = 0, locked_until = NULL,
      last_login_at = ?, updated_at = ? WHERE id = ?
  `),
  organizationLoginFailed: db.prepare(`
    UPDATE organization_users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?
  `),
  updateOrganizationPassword: db.prepare(`
    UPDATE organization_users SET password_hash = ?, failed_login_count = 0,
      locked_until = NULL, updated_at = ? WHERE id = ?
  `),
  insertOrganizationSession: db.prepare(`
    INSERT INTO organization_sessions (
      id, user_id, token_hash, created_at, expires_at, last_seen_at,
      ip_address, user_agent, active_membership_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  findOrganizationSessionByToken: db.prepare(`
    SELECT * FROM organization_sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1
  `),
  touchOrganizationSession: db.prepare("UPDATE organization_sessions SET last_seen_at = ? WHERE id = ?"),
  setOrganizationSessionMembership: db.prepare(`
    UPDATE organization_sessions SET active_membership_id = ?, last_seen_at = ? WHERE id = ?
  `),
  revokeOrganizationSession: db.prepare("UPDATE organization_sessions SET revoked_at = ? WHERE id = ?"),
  revokeOrganizationUserSessions: db.prepare(`
    UPDATE organization_sessions SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `),
  revokeOrganizationMembershipSessions: db.prepare(`
    UPDATE organization_sessions SET revoked_at = ?
    WHERE active_membership_id = ? AND revoked_at IS NULL
  `),
  insertOrganizationPasswordReset: db.prepare(`
    INSERT INTO organization_password_reset_tokens (
      id, user_id, token_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `),
  findOrganizationPasswordReset: db.prepare(`
    SELECT * FROM organization_password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL LIMIT 1
  `),
  consumeOrganizationPasswordReset: db.prepare(`
    UPDATE organization_password_reset_tokens SET used_at = ? WHERE id = ?
  `),
  insertOrganizationSubscription: db.prepare(`
    INSERT INTO organization_subscriptions (
      id, organization_id, plan_id, plan_code, plan_name, status, router_limit, max_devices, device_limit_mode,
      amount, currency, current_period_start, current_period_end, payment_order_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'XOF', ?, ?, ?, ?, ?)
  `),
  expireOrganizationSubscriptions: db.prepare(`
    UPDATE organization_subscriptions SET status = 'expired', updated_at = ?
    WHERE organization_id = ? AND status = 'active' AND (
      (plan_id = ? AND current_period_end <= ?)
      OR (plan_id <> ? AND current_period_end <= ?)
    )
  `),
  expireDueOrganizationSubscriptions: db.prepare(`
    UPDATE organization_subscriptions SET status = 'expired', updated_at = ?
    WHERE status = 'active' AND (
      (plan_id = ? AND current_period_end <= ?)
      OR (plan_id <> ? AND current_period_end <= ?)
    )
  `),
  expireOrganizationSubscriptionById: db.prepare(`
    UPDATE organization_subscriptions
    SET status = 'expired', updated_at = ?
    WHERE id = ? AND status = 'active'
  `),
  findActiveOrganizationSubscription: db.prepare(`
    SELECT * FROM organization_subscriptions
    WHERE organization_id = ? AND status = 'active'
    ORDER BY current_period_end DESC LIMIT 1
  `),
  findLatestOrganizationSubscription: db.prepare(`
    SELECT * FROM organization_subscriptions
    WHERE organization_id = ? ORDER BY current_period_end DESC LIMIT 1
  `),
  listActiveOrganizationSubscriptions: db.prepare(`
    SELECT subscription.*, organization.name AS organization_name
    FROM organization_subscriptions AS subscription
    JOIN organizations AS organization ON organization.id = subscription.organization_id
    WHERE subscription.status = 'active' OR subscription.plan_id = ?
    ORDER BY subscription.current_period_end ASC
  `),
  hasPaidOrganizationSubscription: db.prepare(`
    SELECT 1 AS found FROM organization_subscriptions
    WHERE organization_id = ? AND plan_id <> ?
    LIMIT 1
  `),
  findOrganizationDeviceByInstallation: db.prepare(`
    SELECT * FROM organization_devices
    WHERE organization_id = ? AND installation_id = ? LIMIT 1
  `),
  findOrganizationDeviceById: db.prepare(`
    SELECT * FROM organization_devices
    WHERE organization_id = ? AND id = ? LIMIT 1
  `),
  countOrganizationRegisteredDevices: db.prepare(`
    SELECT COUNT(*) AS count FROM organization_devices
    WHERE organization_id = ? AND status <> 'revoked'
  `),
  countOrganizationOwnerDevices: db.prepare(`
    SELECT COUNT(*) AS count
    FROM organization_devices AS device
    JOIN organization_memberships AS membership
      ON membership.organization_id = device.organization_id
      AND membership.user_id = device.registered_by_user_id
    WHERE device.organization_id = ?
      AND device.status <> 'revoked'
      AND membership.authority_role = 'owner'
  `),
  countOrganizationMemberDevices: db.prepare(`
    SELECT COUNT(*) AS count
    FROM organization_devices AS device
    JOIN organization_memberships AS membership
      ON membership.organization_id = device.organization_id
      AND membership.user_id = device.registered_by_user_id
    WHERE device.organization_id = ?
      AND device.status <> 'revoked'
      AND membership.authority_role = 'member'
  `),
  countOrganizationDevicesForUser: db.prepare(`
    SELECT COUNT(*) AS count FROM organization_devices
    WHERE organization_id = ? AND registered_by_user_id = ? AND status <> 'revoked'
  `),
  insertOrganizationDevice: db.prepare(`
    INSERT OR IGNORE INTO organization_devices (
      id, organization_id, registered_by_user_id, installation_id, name,
      platform, os_version, app_version, status, last_seen_at,
      created_at, updated_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
  `),
  touchOrganizationDevice: db.prepare(`
    UPDATE organization_devices
    SET name = ?, platform = ?, os_version = ?, app_version = ?, status = 'active',
      last_seen_at = ?, updated_at = ?
    WHERE organization_id = ? AND id = ? AND status <> 'revoked'
  `),
  transferOrganizationDeviceRegistration: db.prepare(`
    UPDATE organization_devices
    SET registered_by_user_id = ?, updated_at = ?, last_seen_at = ?
    WHERE organization_id = ? AND id = ? AND status <> 'revoked'
  `),
  heartbeatOrganizationDevice: db.prepare(`
    UPDATE organization_devices
    SET app_version = ?, status = CASE WHEN status = 'revoked' THEN status ELSE 'active' END,
      last_seen_at = ?, updated_at = ?
    WHERE organization_id = ? AND id = ?
  `),
  revokeOrganizationDevice: db.prepare(`
    UPDATE organization_devices
    SET status = 'revoked', revoked_at = ?, updated_at = ?
    WHERE organization_id = ? AND id = ? AND status <> 'revoked'
  `),
  restoreOrganizationDevice: db.prepare(`
    UPDATE organization_devices
    SET status = 'active', revoked_at = NULL, last_seen_at = ?, updated_at = ?
    WHERE organization_id = ? AND id = ? AND status = 'revoked'
  `),
  listOrganizationDevices: db.prepare(`
    SELECT device.*, peer.id AS peer_id, peer.gateway_id, peer.public_key,
      peer.vpn_ip, peer.key_version, peer.config_version, peer.desired_state,
      peer.applied_state, peer.last_handshake_at, peer.last_error_code
    FROM organization_devices AS device
    LEFT JOIN organization_vpn_peers AS peer ON peer.device_id = device.id
    WHERE device.organization_id = ?
    ORDER BY device.created_at ASC
  `),
  listOrganizationDevicesForUser: db.prepare(`
    SELECT device.*, peer.id AS peer_id, peer.gateway_id, peer.public_key,
      peer.vpn_ip, peer.key_version, peer.config_version, peer.desired_state,
      peer.applied_state, peer.last_handshake_at, peer.last_error_code
    FROM organization_devices AS device
    LEFT JOIN organization_vpn_peers AS peer ON peer.device_id = device.id
    WHERE device.organization_id = ? AND device.registered_by_user_id = ?
    ORDER BY device.created_at ASC
  `),
  listOrganizationVpnPeersForReconciliation: db.prepare(`
    SELECT peer.*, device.organization_id, device.name AS device_name,
      device.status AS device_status,
      membership.status AS membership_status,
      membership.invitation_status AS membership_invitation_status
    FROM organization_vpn_peers AS peer
    JOIN organization_devices AS device ON device.id = peer.device_id
    LEFT JOIN organization_memberships AS membership
      ON membership.organization_id = device.organization_id
      AND membership.user_id = device.registered_by_user_id
    ORDER BY peer.updated_at ASC
  `),
  findOrganizationVpnPeerByDevice: db.prepare(`
    SELECT peer.* FROM organization_vpn_peers AS peer
    JOIN organization_devices AS device ON device.id = peer.device_id
    WHERE device.organization_id = ? AND peer.device_id = ? LIMIT 1
  `),
  findOrganizationVpnPeerByPublicKey: db.prepare(`
    SELECT peer.*, device.organization_id FROM organization_vpn_peers AS peer
    JOIN organization_devices AS device ON device.id = peer.device_id
    WHERE peer.public_key = ? AND device.organization_id = ? LIMIT 1
  `),
  listSharedOrganizationVpnPeersByPublicKey: db.prepare(`
    SELECT peer.*, device.organization_id, device.installation_id,
      device.registered_by_user_id, device.status AS device_status
    FROM organization_vpn_peers AS peer
    JOIN organization_devices AS device ON device.id = peer.device_id
    WHERE peer.public_key = ? AND device.status != 'revoked'
    ORDER BY device.organization_id ASC
  `),
  insertOrganizationVpnPeer: db.prepare(`
    INSERT OR IGNORE INTO organization_vpn_peers (
      id, device_id, gateway_id, public_key, vpn_ip, key_version,
      config_version, desired_state, applied_state, last_handshake_at,
      last_error_code, created_at, updated_at, revoked_at
    ) VALUES (?, ?, 'gateway-africa-west-1', ?, NULL, 1, 1,
      'enabled', 'pending', NULL, NULL, ?, ?, NULL)
  `),
  markOrganizationVpnPeerEnabled: db.prepare(`
    UPDATE organization_vpn_peers
    SET vpn_ip = ?, desired_state = 'enabled', applied_state = 'enabled',
      last_error_code = NULL, revoked_at = NULL, updated_at = ?
    WHERE device_id = ?
  `),
  markOrganizationVpnPeerPending: db.prepare(`
    UPDATE organization_vpn_peers
    SET desired_state = ?, applied_state = 'pending', last_error_code = NULL, updated_at = ?
    WHERE device_id = ?
  `),
  markOrganizationVpnPeerDisabled: db.prepare(`
    UPDATE organization_vpn_peers
    SET desired_state = 'disabled', applied_state = 'disabled', revoked_at = ?,
      last_error_code = NULL, updated_at = ?
    WHERE device_id = ?
  `),
  markOrganizationVpnPeerSuspended: db.prepare(`
    UPDATE organization_vpn_peers
    SET desired_state = 'disabled', applied_state = 'disabled', revoked_at = NULL,
      last_error_code = NULL, updated_at = ?
    WHERE device_id = ?
  `),
  markOrganizationVpnPeerError: db.prepare(`
    UPDATE organization_vpn_peers
    SET applied_state = 'error', last_error_code = ?, updated_at = ?
    WHERE device_id = ?
  `),
  rotateOrganizationVpnPeer: db.prepare(`
    UPDATE organization_vpn_peers
    SET public_key = ?, key_version = key_version + 1,
      config_version = config_version + 1, desired_state = 'enabled',
      applied_state = 'enabled', last_error_code = NULL, revoked_at = NULL,
      updated_at = ?
    WHERE device_id = ? AND public_key = ?
  `),
  rotateOrganizationVpnPeerPreservingDesiredState: db.prepare(`
    UPDATE organization_vpn_peers
    SET public_key = ?, key_version = key_version + 1,
      config_version = config_version + 1,
      applied_state = CASE desired_state WHEN 'enabled' THEN 'enabled' ELSE 'disabled' END,
      last_error_code = NULL, revoked_at = NULL, updated_at = ?
    WHERE device_id = ? AND public_key = ?
  `),
  updateOrganizationVpnPeerHandshake: db.prepare(`
    UPDATE organization_vpn_peers
    SET last_handshake_at = ?, updated_at = ?
    WHERE device_id = ?
  `),
  listOrganizationOwnerRecipients: db.prepare(`
    SELECT DISTINCT user.email, user.name
    FROM organization_memberships AS membership
    JOIN organization_users AS user ON user.id = membership.user_id
    WHERE membership.organization_id = ?
      AND membership.authority_role = 'owner'
      AND membership.status = 'active'
      AND membership.invitation_status = 'accepted'
      AND user.status = 'active'
    ORDER BY user.created_at ASC
  `),
  claimSubscriptionNotification: db.prepare(`
    INSERT OR IGNORE INTO subscription_notifications (
      subscription_id, event_key, recipient_email, status, created_at, sent_at
    ) VALUES (?, ?, ?, 'sending', ?, NULL)
  `),
  markSubscriptionNotificationSent: db.prepare(`
    UPDATE subscription_notifications
    SET status = 'sent', sent_at = ?
    WHERE subscription_id = ? AND event_key = ? AND recipient_email = ?
  `),
  releaseSubscriptionNotification: db.prepare(`
    DELETE FROM subscription_notifications
    WHERE subscription_id = ? AND event_key = ? AND recipient_email = ? AND status = 'sending'
  `),
  releaseStaleSubscriptionNotifications: db.prepare(`
    DELETE FROM subscription_notifications
    WHERE status = 'sending' AND created_at <= ?
  `),
  findRouterAccessPolicy: db.prepare(`
    SELECT organization_id, router_id, policy_json, revision,
      updated_by_user_id, created_at, updated_at
    FROM router_access_policies
    WHERE organization_id = ? AND router_id = ?
  `),
  insertRouterAccessPolicy: db.prepare(`
    INSERT INTO router_access_policies (
      organization_id, router_id, policy_json, revision,
      updated_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?)
  `),
  updateRouterAccessPolicy: db.prepare(`
    UPDATE router_access_policies
    SET policy_json = ?, revision = revision + 1,
      updated_by_user_id = ?, updated_at = ?
    WHERE organization_id = ? AND router_id = ? AND revision = ?
  `),
  insertRouterAccessPolicyHistory: db.prepare(`
    INSERT INTO router_access_policy_history (
      organization_id, router_id, revision, policy_json,
      changed_by_user_id, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),
  listRouterAccessPolicyHistory: db.prepare(`
    SELECT organization_id, router_id, revision, policy_json,
      changed_by_user_id, changed_at
    FROM router_access_policy_history
    WHERE organization_id = ? AND router_id = ?
    ORDER BY revision DESC
    LIMIT 100
  `),
  findOrganizationRouterById: db.prepare(`
    SELECT * FROM organization_routers
    WHERE organization_id = ? AND id = ? AND deleted_at IS NULL
  `),
  findOrganizationRouterByStableIdentity: db.prepare(`
    SELECT * FROM organization_routers
    WHERE organization_id = ? AND stable_identity = ? AND deleted_at IS NULL
  `),
  findAnyOrganizationRouterById: db.prepare(`
    SELECT * FROM organization_routers
    WHERE organization_id = ? AND id = ?
  `),
  findAnyOrganizationRouterByStableIdentity: db.prepare(`
    SELECT * FROM organization_routers
    WHERE organization_id = ? AND stable_identity = ?
  `),
  listOrganizationRouters: db.prepare(`
    SELECT * FROM organization_routers
    WHERE organization_id = ? AND deleted_at IS NULL
    ORDER BY created_at ASC
  `),
  insertOrganizationRouter: db.prepare(`
    INSERT INTO organization_routers (
      id, organization_id, stable_identity, name, label, model, board_name,
      serial_number, routeros_version, local_ip, hotspot_address, notes,
      api_port, api_ssl_port, username, credential_ciphertext, connection_mode,
      connections_json, plans_json, vpn_json, status, last_seen_at,
      created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `),
  updateOrganizationRouter: db.prepare(`
    UPDATE organization_routers SET
      stable_identity = ?, name = ?, label = ?, model = ?, board_name = ?,
      serial_number = ?, routeros_version = ?, local_ip = ?, hotspot_address = ?,
      notes = ?, api_port = ?, api_ssl_port = ?, username = ?,
      credential_ciphertext = ?, connection_mode = ?, connections_json = ?,
      plans_json = ?, vpn_json = ?, status = ?, last_seen_at = ?,
      updated_by_user_id = ?, updated_at = ?, deleted_at = NULL
    WHERE organization_id = ? AND id = ?
  `),
  softDeleteOrganizationRouter: db.prepare(`
    UPDATE organization_routers
    SET deleted_at = ?, updated_at = ?, updated_by_user_id = ?
    WHERE organization_id = ? AND id = ? AND deleted_at IS NULL
  `),
  findOrganizationTicketBatchById: db.prepare(`
    SELECT * FROM organization_ticket_batches
    WHERE organization_id = ? AND router_id = ? AND id = ?
  `),
  listOrganizationTicketBatches: db.prepare(`
    SELECT * FROM organization_ticket_batches
    WHERE organization_id = ? AND router_id = ?
    ORDER BY created_at DESC
  `),
  upsertOrganizationTicketBatch: db.prepare(`
    INSERT INTO organization_ticket_batches (
      id, organization_id, router_id, plan_id, operator_profile, quantity,
      prefix, code_length, status, hotspot_server_name, currency, price_snapshot,
      sync_status, created_by_user_id, created_by_name, created_by_email,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      plan_id = excluded.plan_id,
      operator_profile = excluded.operator_profile,
      quantity = excluded.quantity,
      prefix = excluded.prefix,
      code_length = excluded.code_length,
      status = excluded.status,
      hotspot_server_name = excluded.hotspot_server_name,
      currency = excluded.currency,
      price_snapshot = excluded.price_snapshot,
      sync_status = excluded.sync_status,
      updated_at = excluded.updated_at
    WHERE organization_ticket_batches.organization_id = excluded.organization_id
      AND organization_ticket_batches.router_id = excluded.router_id
      AND excluded.updated_at >= organization_ticket_batches.updated_at
  `),
  findOrganizationTicketById: db.prepare(`
    SELECT * FROM organization_tickets
    WHERE organization_id = ? AND router_id = ? AND id = ?
  `),
  findOrganizationTicketByUsername: db.prepare(`
    SELECT * FROM organization_tickets
    WHERE organization_id = ? AND router_id = ? AND username = ?
  `),
  listOrganizationTickets: db.prepare(`
    SELECT * FROM organization_tickets
    WHERE organization_id = ? AND router_id = ?
    ORDER BY created_at DESC
  `),
  upsertOrganizationTicket: db.prepare(`
    INSERT INTO organization_tickets (
      id, organization_id, router_id, batch_id, plan_id, username,
      password_is_username, status, mac_address, ip_address, activated_at,
      completed_at, expires_at, deleted_at, printed_count, downloaded_bytes,
      uploaded_bytes, mikrotik_id, hotspot_server_name, mikrotik_profile_name,
      exported_at, archived_at, router_deleted_at, last_router_sync_at,
      uptime_seconds, remaining_seconds, data_remaining_bytes,
      duration_minutes_snapshot, validity_minutes_snapshot, data_limit_mb_snapshot,
      download_limit_snapshot, upload_limit_snapshot, shared_users_snapshot, sync_status,
      created_by_user_id, created_by_name, created_by_email, created_by_role,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      batch_id = excluded.batch_id,
      plan_id = excluded.plan_id,
      username = excluded.username,
      password_is_username = excluded.password_is_username,
      status = excluded.status,
      mac_address = excluded.mac_address,
      ip_address = excluded.ip_address,
      activated_at = excluded.activated_at,
      completed_at = excluded.completed_at,
      expires_at = excluded.expires_at,
      deleted_at = excluded.deleted_at,
      printed_count = excluded.printed_count,
      downloaded_bytes = excluded.downloaded_bytes,
      uploaded_bytes = excluded.uploaded_bytes,
      mikrotik_id = excluded.mikrotik_id,
      hotspot_server_name = excluded.hotspot_server_name,
      mikrotik_profile_name = excluded.mikrotik_profile_name,
      exported_at = excluded.exported_at,
      archived_at = excluded.archived_at,
      router_deleted_at = excluded.router_deleted_at,
      last_router_sync_at = excluded.last_router_sync_at,
      uptime_seconds = excluded.uptime_seconds,
      remaining_seconds = excluded.remaining_seconds,
      data_remaining_bytes = excluded.data_remaining_bytes,
      duration_minutes_snapshot = excluded.duration_minutes_snapshot,
      validity_minutes_snapshot = excluded.validity_minutes_snapshot,
      data_limit_mb_snapshot = excluded.data_limit_mb_snapshot,
      download_limit_snapshot = excluded.download_limit_snapshot,
      upload_limit_snapshot = excluded.upload_limit_snapshot,
      shared_users_snapshot = excluded.shared_users_snapshot,
      sync_status = excluded.sync_status,
      updated_at = excluded.updated_at
    WHERE organization_tickets.organization_id = excluded.organization_id
      AND organization_tickets.router_id = excluded.router_id
      AND excluded.updated_at >= organization_tickets.updated_at
  `),
  findOrganizationGeneratedFileById: db.prepare(`
    SELECT * FROM organization_generated_files
    WHERE organization_id = ? AND router_id = ? AND id = ?
  `),
  listOrganizationGeneratedFiles: db.prepare(`
    SELECT * FROM organization_generated_files
    WHERE organization_id = ? AND router_id = ?
    ORDER BY created_at DESC
    LIMIT 1000
  `),
  upsertOrganizationGeneratedFile: db.prepare(`
    INSERT INTO organization_generated_files (
      id, organization_id, router_id, batch_id, type, file_name, format,
      metadata_json, sync_status, created_by_user_id, created_by_name,
      created_by_email, created_by_role, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      batch_id = excluded.batch_id,
      type = excluded.type,
      file_name = excluded.file_name,
      format = excluded.format,
      metadata_json = excluded.metadata_json,
      sync_status = excluded.sync_status,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
    WHERE organization_generated_files.organization_id = excluded.organization_id
      AND organization_generated_files.router_id = excluded.router_id
      AND excluded.updated_at >= organization_generated_files.updated_at
  `),
  updateOrganizationGeneratedFilePrintArchive: db.prepare(`
    UPDATE organization_generated_files
    SET print_archive_ciphertext = ?, print_archive_iv = ?, print_archive_tag = ?,
      print_archive_version = ?, print_archive_updated_at = ?
    WHERE organization_id = ? AND router_id = ? AND id = ?
  `),
  findOrganizationActivityLogById: db.prepare(`
    SELECT * FROM organization_activity_logs
    WHERE organization_id = ? AND router_id = ? AND id = ?
  `),
  listOrganizationActivityLogs: db.prepare(`
    SELECT * FROM organization_activity_logs
    WHERE organization_id = ? AND router_id = ?
    ORDER BY created_at DESC
    LIMIT 2000
  `),
  insertOrganizationActivityLog: db.prepare(`
    INSERT OR IGNORE INTO organization_activity_logs (
      id, organization_id, router_id, level, category, user_message,
      technical_message, created_by_user_id, created_by_name, created_by_email,
      created_by_role, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteOrganizationActivityLogsBefore: db.prepare(`
    DELETE FROM organization_activity_logs
    WHERE organization_id = ? AND router_id = ? AND created_at < ?
  `),
  linkPaymentOrderOrganization: db.prepare(`
    UPDATE payment_orders SET organization_id = ?, organization_user_id = ?, updated_at = ?
    WHERE id = ?
  `),
  listLicenses: db.prepare(`
    SELECT id, status, license_type, reseller_id, plan_id, plan_code, plan_name,
      duration_days, router_limit, max_devices, price_cfa, label, issued_at,
      activation_deadline_at, activated_at, expires_at, router_count, device_count
    FROM licenses ORDER BY issued_at DESC LIMIT ?
  `),
  insertPaymentOrder: db.prepare(`
    INSERT INTO payment_orders (
      id, transaction_id, purchaser_type, reseller_id, reseller_registration_id,
      organization_id, organization_user_id,
      plan_id, plan_code, plan_name,
      router_limit, max_devices, device_limit_mode, duration_days, amount, currency, country, msisdn,
      customer_name, payment_type, status, fulfillment_status, access_token_hash,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'XOF', 'NE', ?, ?, ?, 'pending', 'pending', ?, ?, ?)
  `),
  findPaymentOrderById: db.prepare("SELECT * FROM payment_orders WHERE id = ?"),
  findPaymentOrderByTransaction: db.prepare("SELECT * FROM payment_orders WHERE transaction_id = ?"),
  setPaymentProviderReferences: db.prepare(`
    UPDATE payment_orders SET provider_reference = ?, provider_public_reference = ?,
      updated_at = ? WHERE id = ?
  `),
  markPaymentChecked: db.prepare(`
    UPDATE payment_orders SET status = ?, last_checked_at = ?, updated_at = ?,
      failure_reason = ? WHERE id = ?
  `),
  abandonPaymentOrder: db.prepare(`
    UPDATE payment_orders SET status = 'cancelled', fulfillment_status = 'failed',
      last_checked_at = ?, updated_at = ?, failure_reason = ? WHERE id = ?
  `),
  markLatePayment: db.prepare(`
    UPDATE payment_orders SET status = 'succeeded', fulfillment_status = 'failed',
      paid_at = ?, last_checked_at = ?, updated_at = ?, failure_reason = ? WHERE id = ?
  `),
  fulfillOrganizationPayment: db.prepare(`
    UPDATE payment_orders SET status = 'succeeded', fulfillment_status = 'fulfilled',
      license_id = ?, license_key_encrypted = ?, paid_at = ?, fulfilled_at = ?,
      last_checked_at = ?, updated_at = ?, failure_reason = NULL WHERE id = ?
  `),
  fulfillResellerPayment: db.prepare(`
    UPDATE payment_orders SET status = 'succeeded', fulfillment_status = 'fulfilled',
      paid_at = ?, fulfilled_at = ?, last_checked_at = ?, updated_at = ?,
      failure_reason = NULL WHERE id = ?
  `),
  fulfillSaasPayment: db.prepare(`
    UPDATE payment_orders SET status = 'succeeded', fulfillment_status = 'fulfilled',
      paid_at = ?, fulfilled_at = ?, last_checked_at = ?, updated_at = ?,
      failure_reason = NULL WHERE id = ?
  `),
  failPaymentFulfillment: db.prepare(`
    UPDATE payment_orders SET fulfillment_status = 'failed', failure_reason = ?,
      last_checked_at = ?, updated_at = ? WHERE id = ?
  `),
  listResellerPayments: db.prepare(`
    SELECT id, transaction_id, plan_id, plan_name, router_limit, amount, currency,
      msisdn, payment_type, status, fulfillment_status, provider_public_reference,
      created_at, paid_at, fulfilled_at, failure_reason
    FROM payment_orders WHERE reseller_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  listPayments: db.prepare(`
    SELECT id, transaction_id, purchaser_type, reseller_id, plan_id, plan_name,
      router_limit, amount, currency, msisdn, payment_type, status,
      fulfillment_status, provider_public_reference, license_id, created_at,
      paid_at, fulfilled_at, failure_reason
    FROM payment_orders ORDER BY created_at DESC LIMIT ?
  `),
  insertWebhookEvent: db.prepare(`
    INSERT INTO payment_webhook_events (
      id, event_hash, transaction_id, provider_reference, provider_status,
      received_at, result
    ) VALUES (?, ?, ?, ?, ?, ?, 'received')
  `),
  finishWebhookEvent: db.prepare(`
    UPDATE payment_webhook_events SET processed_at = ?, result = ? WHERE event_hash = ?
  `),
  insertResellerRegistration: db.prepare(`
    INSERT INTO reseller_registrations (
      id, email, name, password_hash, plan_id, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `),
  findResellerRegistrationById: db.prepare("SELECT * FROM reseller_registrations WHERE id = ?"),
  findResellerRegistrationByEmail: db.prepare("SELECT * FROM reseller_registrations WHERE email = ?"),
  linkResellerRegistrationOrder: db.prepare(`
    UPDATE reseller_registrations SET order_id = ? WHERE id = ?
  `),
  completeResellerRegistration: db.prepare(`
    UPDATE reseller_registrations SET status = 'completed', reseller_id = ?,
      completed_at = ? WHERE id = ?
  `),
  cancelResellerRegistration: db.prepare(`
    UPDATE reseller_registrations SET status = 'cancelled'
    WHERE id = ? AND status = 'pending'
  `),
  restartResellerRegistration: db.prepare(`
    UPDATE reseller_registrations SET name = ?, password_hash = ?, plan_id = ?,
      status = 'pending', order_id = NULL, reseller_id = NULL, created_at = ?,
      completed_at = NULL WHERE id = ? AND status = 'cancelled'
  `),
  linkPaymentOrderReseller: db.prepare(`
    UPDATE payment_orders SET reseller_id = ?, updated_at = ? WHERE id = ?
  `)
};

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * A Windows installation has one WireGuard identity, even when its user is a
 * member of several organizations. Older installations made public_key and
 * vpn_ip globally unique, preventing the same device from joining a second
 * organization. Keep the device-level uniqueness, but allow the same global
 * identity to be represented once per organization membership.
 */
function migrateOrganizationVpnPeersForSharedDevices() {
  const table = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'organization_vpn_peers'
  `).get();
  const definition = String(table?.sql ?? "");
  if (!definition.includes("public_key TEXT NOT NULL UNIQUE") && !definition.includes("vpn_ip TEXT UNIQUE")) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    db.exec(`
      CREATE TABLE organization_vpn_peers_shared (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE REFERENCES organization_devices(id) ON DELETE CASCADE,
        gateway_id TEXT NOT NULL DEFAULT 'gateway-africa-west-1',
        public_key TEXT NOT NULL,
        vpn_ip TEXT,
        key_version INTEGER NOT NULL DEFAULT 1 CHECK(key_version > 0),
        config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
        desired_state TEXT NOT NULL CHECK(desired_state IN ('enabled', 'disabled')),
        applied_state TEXT NOT NULL CHECK(applied_state IN ('pending', 'enabled', 'disabled', 'error')),
        last_handshake_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT
      );
      INSERT INTO organization_vpn_peers_shared (
        id, device_id, gateway_id, public_key, vpn_ip, key_version,
        config_version, desired_state, applied_state, last_handshake_at,
        last_error_code, created_at, updated_at, revoked_at
      )
      SELECT
        id, device_id, gateway_id, public_key, vpn_ip, key_version,
        config_version, desired_state, applied_state, last_handshake_at,
        last_error_code, created_at, updated_at, revoked_at
      FROM organization_vpn_peers;
      DROP TABLE organization_vpn_peers;
      ALTER TABLE organization_vpn_peers_shared RENAME TO organization_vpn_peers;
      CREATE INDEX idx_organization_vpn_peers_public_key
        ON organization_vpn_peers(public_key);
      CREATE INDEX idx_organization_vpn_peers_vpn_ip
        ON organization_vpn_peers(vpn_ip);
    `);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function parseVpnClientAllowedIps(value) {
  const routes = String(value ?? "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean);
  if (routes.length === 0 || routes.length > 16) {
    throw new Error("VPN_CLIENT_ALLOWED_IPS doit contenir entre 1 et 16 routes privées.");
  }
  for (const route of routes) validatePrivateIpv4Cidr(route);
  return Object.freeze([...new Set(routes)]);
}

function validatePrivateIpv4Cidr(value) {
  const [address, rawPrefix, unexpected] = String(value).split("/");
  const octets = address.split(".").map(Number);
  const prefix = Number(rawPrefix);
  if (
    unexpected !== undefined
    || octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    || !Number.isInteger(prefix)
    || prefix < 8
    || prefix > 32
  ) {
    throw new Error(`Route VPN cliente invalide: ${value}`);
  }
  const addressInt = octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  if (((addressInt & mask) >>> 0) !== addressInt) {
    throw new Error(`La route VPN cliente doit être une adresse réseau: ${value}`);
  }
  const isPrivate = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 && prefix >= 12)
    || (octets[0] === 192 && octets[1] === 168 && prefix >= 16);
  if (!isPrivate) {
    throw new Error(`La route VPN cliente doit rester privée: ${value}`);
  }
}

function hash(value) {
  return crypto.createHmac("sha256", HASH_SECRET).update(String(value)).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, saltHex, expectedHex] = String(encoded ?? "").split("$");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function requireEmail(body, field = "email") {
  const email = normalizeEmail(body?.[field]);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, `Champ ${field} invalide.`);
  }
  return email;
}

function requireNewPassword(body, field = "new_password") {
  const password = String(body?.[field] ?? "");
  if (password.length < 12 || password.length > 256
    || !/[a-z]/.test(password) || !/[A-Z]/.test(password)
    || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new HttpError(
      400,
      "Le nouveau mot de passe doit contenir au moins 12 caractères, avec majuscule, minuscule, chiffre et symbole."
    );
  }
  return password;
}

function requireCustomerPassword(body, field = "password") {
  const password = String(body?.[field] ?? "");
  if (password.length < 8 || password.length > 256) {
    throw new HttpError(400, "Le mot de passe doit contenir au moins 8 caractères.");
  }
  return password;
}

function requirePasswordInput(body, field = "password") {
  const password = String(body?.[field] ?? "");
  if (!password || password.length > 256) throw new HttpError(400, `Champ ${field} invalide.`);
  return password;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeKey(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatKey(raw) {
  const normalized = raw.replace(/[^A-Z0-9]/g, "");
  return `TP-${normalized.match(/.{1,4}/g).join("-")}`;
}

function generateLicenseKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (const byte of crypto.randomBytes(16)) value += alphabet[byte % alphabet.length];
  return formatKey(value);
}

function encryptSensitive(value) {
  const key = crypto.createHash("sha256").update(HASH_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptSensitive(value) {
  const [ivValue, tagValue, encryptedValue] = String(value ?? "").split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Secret chiffré invalide.");
  const key = crypto.createHash("sha256").update(HASH_SECRET).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function normalizeNigerMsisdn(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00227")) digits = digits.slice(2);
  if (digits.length === 8) digits = `227${digits}`;
  if (!/^227\d{8}$/.test(digits)) {
    throw new HttpError(400, "Le numéro doit être un MSISDN Niger au format 227XXXXXXXX.");
  }
  return digits;
}

function normalizeInternationalContactPhone(value) {
  const raw = String(value ?? "").trim();
  const message = "Saisissez le numéro avec l'indicatif du pays, par exemple +227 88 99 99 00.";
  if (!raw) throw new HttpError(400, "Saisissez un numéro de téléphone.");
  if (raw.length > 64 || /[^\d+().\-\s]/.test(raw)) throw new HttpError(400, message);

  const compact = raw.replace(/[().\-\s]/g, "");
  const plusCount = (compact.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !compact.startsWith("+"))) {
    throw new HttpError(400, message);
  }

  let normalized;
  if (compact.startsWith("+")) normalized = compact;
  else if (compact.startsWith("00")) normalized = `+${compact.slice(2)}`;
  else if (/^\d{8}$/.test(compact)) normalized = `+227${compact}`;
  else if (/^227\d{8}$/.test(compact)) normalized = `+${compact}`;
  else throw new HttpError(400, message);

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new HttpError(400, message);
  return normalized;
}

function requirePaymentType(body) {
  const paymentType = String(body?.payment_type ?? "");
  if (!["mobile", "nita_online", "amanata"].includes(paymentType)) {
    throw new HttpError(400, "Moyen de paiement iPay invalide.");
  }
  return paymentType;
}

function assertIpayConfigured() {
  if (!IPAY_ENV || IPAY_ENV === "disabled" || !IPAY_PUBLIC_KEY || !IPAY_PRIVATE_KEY || !IPAY_SECRET_HASH) {
    throw new HttpError(503, "Le paiement iPay n'est pas configuré sur le serveur.");
  }
}

async function ipayRequest(pathname, options) {
  let response;
  try {
    response = await fetch(`${IPAY_BASE_URL}${pathname}`, options);
  } catch {
    throw new HttpError(502, "Le service iPay est temporairement inaccessible.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(502, "iPay a refusé la requête.", {
      provider_status: response.status
    });
  }
  return payload;
}

async function vpnHubRequest(pathname, body) {
  if (!VPN_HUB_URL || VPN_HUB_MASTER_TOKEN.length < 32) {
    throw new HttpError(503, "Le service VPN n'est pas configuré sur le serveur.");
  }
  let response;
  try {
    response = await fetch(`${VPN_HUB_URL}${pathname}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${VPN_HUB_MASTER_TOKEN}`,
        "content-type": "application/json"
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new HttpError(502, "Le hub VPN est temporairement inaccessible.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, "Le hub VPN a refusé le provisionnement.", {
      hub_error: payload.error ?? "unknown"
    });
  }
  return payload;
}

function requireInstallationId(body) {
  const installationId = String(body?.installation_id ?? body?.installationId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)) {
    throw new HttpError(400, "Identifiant d'installation invalide.", {
      code: "INSTALLATION_ID_INVALID"
    });
  }
  return installationId.toLowerCase();
}

function requireVpnPublicKey(body, field = "public_key") {
  const publicKey = String(body?.[field] ?? body?.publicKey ?? "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
    throw new HttpError(400, "Clé publique WireGuard invalide.", {
      code: "VPN_PUBLIC_KEY_INVALID"
    });
  }
  return publicKey;
}

function normalizeDevicePlatform(value) {
  const platform = String(value ?? "windows").trim().toLowerCase();
  if (!['windows', 'macos', 'linux'].includes(platform)) {
    throw new HttpError(400, "Plateforme d'appareil invalide.", {
      code: "DEVICE_PLATFORM_INVALID"
    });
  }
  return platform;
}

function organizationDeviceResponse(record) {
  const lastSeenMs = Date.parse(record.last_seen_at ?? "");
  const inactivityMs = Number.isFinite(lastSeenMs) ? Date.now() - lastSeenMs : Number.POSITIVE_INFINITY;
  const effectiveStatus = record.status === "revoked"
    ? "revoked"
    : inactivityMs > 30 * DAY_MS
      ? "stale"
      : inactivityMs > 5 * 60_000
        ? "offline"
        : "active";
  return {
    id: record.id,
    installation_id: record.installation_id,
    name: record.name,
    platform: record.platform,
    os_version: record.os_version ?? null,
    app_version: record.app_version,
    status: effectiveStatus,
    is_current: false,
    last_seen_at: record.last_seen_at,
    created_at: record.created_at,
    revoked_at: record.revoked_at ?? null,
    vpn: record.peer_id ? {
      gateway_id: record.gateway_id,
      assigned_address: record.vpn_ip ?? null,
      key_version: Number(record.key_version),
      config_version: Number(record.config_version),
      desired_state: record.desired_state,
      applied_state: record.applied_state,
      last_handshake_at: record.last_handshake_at ?? null,
      last_error_code: record.last_error_code ?? null
    } : null
  };
}

let vpnReconciliationRunning = false;

function managedOrganizationDeviceResources(organizationId) {
  return new Set(
    statements.listOrganizationDevices
      .all(organizationId)
      .filter((device) => device.status !== "revoked")
      .map((device) => `device:${device.id}`)
  );
}

async function revokeUnmanagedOrganizationOperatorPeers(organizationId, actual = null) {
  const managedResources = managedOrganizationDeviceResources(organizationId);
  const hubState = actual ?? await vpnHubRequest("/v1/peers/list", {
    account_id: organizationId
  });
  for (const peer of Array.isArray(hubState.peers) ? hubState.peers : []) {
    if (peer.peer_type !== "operator" || peer.status !== "active"
      || managedResources.has(peer.resource_id)) {
      continue;
    }
    await vpnHubRequest("/v1/peers", {
      account_id: organizationId,
      action: "revoke",
      name: peer.name || "Ancien appareil TicketPro",
      peer_type: "operator",
      public_key: peer.public_key,
      resource_id: peer.resource_id
    });
  }
  return hubState;
}

async function deactivateOrganizationMemberDevices(
  organizationId,
  userId,
  reason,
  { permanent = false } = {}
) {
  const changedAt = nowIso();
  const devices = statements.listOrganizationDevicesForUser.all(organizationId, userId)
    .filter((device) => device.status !== "revoked");
  let hubSynchronized = 0;
  for (const device of devices) {
    if (device.peer_id) {
      statements.markOrganizationVpnPeerPending.run("disabled", changedAt, device.id);
    }
    if (permanent) {
      statements.revokeOrganizationDevice.run(changedAt, changedAt, organizationId, device.id);
    }
    if (!device.peer_id) continue;
    try {
      await vpnHubRequest("/v1/peers", {
        account_id: organizationId,
        action: permanent ? "revoke" : "disable",
        name: device.name,
        peer_type: "operator",
        public_key: device.public_key,
        resource_id: `device:${device.id}`
      });
      if (permanent) {
        statements.markOrganizationVpnPeerDisabled.run(changedAt, nowIso(), device.id);
      } else {
        statements.markOrganizationVpnPeerSuspended.run(nowIso(), device.id);
      }
      hubSynchronized += 1;
    } catch (error) {
      // La base devient immédiatement fail-closed. La réconciliation reprendra
      // la désactivation si le hub est temporairement indisponible.
      statements.markOrganizationVpnPeerError.run(
        "VPN_MEMBER_ACCESS_REVOCATION_FAILED",
        nowIso(),
        device.id
      );
      if (process.env.NODE_ENV !== "test") {
        console.error(`Révocation VPN impossible pour ${device.id} (${reason}):`, error);
      }
    }
  }
  return { changed_device_count: devices.length, hub_synchronized_count: hubSynchronized };
}

async function reconcileOrganizationVpnPeers() {
  if (vpnReconciliationRunning) return;
  vpnReconciliationRunning = true;
  try {
    const peers = statements.listOrganizationVpnPeersForReconciliation.all();
    const organizationIds = new Set();
    for (const peer of peers) {
      organizationIds.add(peer.organization_id);
      const subscription = currentOrganizationSubscription(peer.organization_id);
      const subscriptionActive = organizationSubscriptionLifecycle(subscription).isActive;
      const membershipActive = peer.membership_status === "active"
        && peer.membership_invitation_status === "accepted";
      const shouldEnable = peer.device_status === "active" && membershipActive && subscriptionActive;
      const desiredState = shouldEnable ? "enabled" : "disabled";
      if (peer.desired_state !== desiredState || peer.applied_state === "error") {
        statements.markOrganizationVpnPeerPending.run(desiredState, nowIso(), peer.device_id);
      }
      try {
        if (shouldEnable) {
          await vpnHubRequest("/v1/tenants", {
            account_id: peer.organization_id,
            operator_limit: organizationOperatorLimitForHub(peer.organization_id, subscription),
            router_limit: Number(subscription.router_limit)
          });
          const provisioned = await vpnHubRequest("/v1/peers", {
            account_id: peer.organization_id,
            action: "upsert",
            name: peer.device_name,
            peer_type: "operator",
            persistent_keepalive: 25,
            public_key: peer.public_key,
            resource_id: `device:${peer.device_id}`
          });
          statements.markOrganizationVpnPeerEnabled.run(
            provisioned.assigned_address ?? peer.vpn_ip,
            nowIso(),
            peer.device_id
          );
        } else {
          await vpnHubRequest("/v1/peers", {
            account_id: peer.organization_id,
            action: peer.device_status === "revoked" ? "revoke" : "disable",
            name: peer.device_name,
            peer_type: "operator",
            public_key: peer.public_key,
            resource_id: `device:${peer.device_id}`
          });
          if (peer.device_status === "revoked") {
            statements.markOrganizationVpnPeerDisabled.run(
              peer.revoked_at ?? nowIso(), nowIso(), peer.device_id
            );
          } else {
            statements.markOrganizationVpnPeerSuspended.run(nowIso(), peer.device_id);
          }
        }
      } catch (error) {
        const errorCode = shouldEnable
          ? "VPN_RECONCILIATION_ENABLE_FAILED"
          : "VPN_RECONCILIATION_DISABLE_FAILED";
        statements.markOrganizationVpnPeerError.run(errorCode, nowIso(), peer.device_id);
        if (process.env.NODE_ENV !== "test") {
          console.error(`Réconciliation VPN impossible pour ${peer.device_id}:`, error);
        }
      }
    }
    for (const organizationId of organizationIds) {
      try {
        const actual = await vpnHubRequest("/v1/peers/list", {
          account_id: organizationId
        });
        await revokeUnmanagedOrganizationOperatorPeers(organizationId, actual);
        const actualByResource = new Map(
          (Array.isArray(actual.peers) ? actual.peers : []).map((peer) => [peer.resource_id, peer])
        );
        for (const peer of peers.filter((item) => item.organization_id === organizationId)) {
          const runtime = actualByResource.get(`device:${peer.device_id}`);
          statements.updateOrganizationVpnPeerHandshake.run(
            runtime?.last_handshake_at ?? null,
            nowIso(),
            peer.device_id
          );
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "test") {
          console.error(`Lecture de l'état VPN impossible pour ${organizationId}:`, error);
        }
      }
    }
  } finally {
    vpnReconciliationRunning = false;
  }
}

async function initiateIpayPayment(order) {
  assertIpayConfigured();
  const payload = await ipayRequest("/api/sdk/v1/payments", {
    method: "POST",
    headers: {
      authorization: `Bearer ${IPAY_PUBLIC_KEY}`,
      "content-type": "application/json",
      "ipay-target-environment": IPAY_ENV,
      "ipay-payment-type": order.payment_type
    },
    body: JSON.stringify({
      amount: Number(order.amount),
      country: "NE",
      currency: "XOF",
      transaction_id: order.transaction_id,
      msisdn: order.msisdn,
      customer_name: order.customer_name
    })
  });
  if (!payload?.reference || !payload?.public_reference) {
    throw new HttpError(502, "Réponse d'initialisation iPay incomplète.");
  }
  return payload;
}

async function getIpayPaymentStatus(order) {
  assertIpayConfigured();
  const reference = encodeURIComponent(String(order.provider_reference ?? ""));
  if (!reference) throw new HttpError(409, "La commande ne possède pas de référence iPay.");
  return ipayRequest(`/api/v1/payments/${reference}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${IPAY_PRIVATE_KEY}`,
      "content-type": "application/json",
      "ipay-target-environment": IPAY_ENV,
      "ipay-payment-type": order.payment_type
    }
  });
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameHash(value, expectedHash) {
  return sameSecret(hash(value), expectedHash);
}

function requireLicensedDevice(body) {
  const licenseId = requireText(body, "license_id", 128);
  const activationToken = requireText(body, "activation_token", 512);
  const accountId = requireText(body, "account_id", 128);
  const deviceId = requireText(body, "device_id", 256);
  const deviceProof = requireText(body, "device_proof", 512);
  const installId = requireText(body, "install_id", 256);
  const license = statements.findLicenseById.get(licenseId);
  const activation = statements.findActivationByToken.get(licenseId, hash(activationToken));

  if (!license || !activation || activation.status !== "active"
    || activation.account_id !== accountId || activation.install_id !== installId
    || !sameHash(deviceId, activation.device_id_hash)
    || !sameHash(deviceProof, activation.device_proof_hash)) {
    throw new HttpError(401, "Licence ou appareil non reconnu.");
  }
  if (license.status === "revoked") throw new HttpError(403, "Cette licence a été révoquée.");
  if (!license.expires_at || Date.parse(license.expires_at) <= Date.now()) {
    throw new HttpError(403, "Cette licence a expiré.");
  }
  statements.touchActivation.run(nowIso(), activation.id);
  return { activation, accountId, license };
}

function deviceLimitMode(record) {
  return record?.device_limit_mode === "unlimited" ? "unlimited" : "limited";
}

function deviceLimitValue(record) {
  return deviceLimitMode(record) === "unlimited"
    ? null
    : Math.max(1, Number(record?.max_devices ?? 1));
}

function deviceLimitForHub(record) {
  return deviceLimitValue(record);
}

// Le forfait appartient au propriétaire de l'organisation. Un collaborateur
// invité n'achète pas un deuxième abonnement lorsqu'il ouvre TicketPro : son
// poste reçoit un accès VPN auditable et révocable, distinct de la capacité
// commerciale du propriétaire.
function organizationDeviceAccessScope(context) {
  return context.membership.authority_role === "owner" ? "owner" : "collaborator";
}

function organizationDeviceLimitForContext(context) {
  return organizationDeviceAccessScope(context) === "owner"
    ? deviceLimitValue(context.subscription)
    : null;
}

function organizationDeviceLimitModeForContext(context) {
  return organizationDeviceLimitForContext(context) === null ? "unlimited" : "limited";
}

function organizationDeviceCountForContext(context) {
  if (organizationDeviceAccessScope(context) === "owner") {
    return Number(statements.countOrganizationOwnerDevices.get(context.organization.id).count);
  }
  return Number(
    statements.countOrganizationDevicesForUser.get(context.organization.id, context.user.id).count
  );
}

// WireGuard Hub applique un plafond technique. Le plafond commercial ne doit
// jamais empêcher un collaborateur déjà autorisé d'atteindre les routeurs qui
// lui ont été attribués. Les postes invités sont donc ajoutés au plafond du hub
// tout en restant des appareils indépendants, journalisés et révocables.
function organizationOperatorLimitForHub(organizationId, subscription) {
  const ownerLimit = deviceLimitForHub(subscription);
  if (ownerLimit === null) return null;
  return ownerLimit + Number(statements.countOrganizationMemberDevices.get(organizationId).count);
}

function planResponse(plan) {
  const limitMode = deviceLimitMode(plan);
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    router_limit: Number(plan.router_limit),
    device_limit_mode: limitMode,
    max_devices: limitMode === "unlimited" ? null : Number(plan.max_devices),
    duration_days: Number(plan.duration_days),
    price_cfa: plan.price_cfa === null ? null : Number(plan.price_cfa),
    billing_period: plan.billing_period,
    offer_code: plan.offer_code || plan.code,
    purchase_mode: plan.purchase_mode === "contact" ? "contact" : "online",
    is_recommended: Boolean(plan.is_recommended),
    is_active: Boolean(plan.is_active),
    is_reseller: Boolean(plan.is_reseller)
  };
}

function licensePlanResponse(license) {
  return {
    id: license.plan_id ?? `custom-${license.id}`,
    code: license.plan_code ?? "CUSTOM",
    name: license.plan_name ?? `Pack ${license.router_limit} routeur(s)`,
    description: license.plan_description ?? "",
    router_limit: Number(license.router_limit),
    max_devices: Number(license.max_devices ?? 1),
    duration_days: Number(license.duration_days),
    price_cfa: license.price_cfa === null ? null : Number(license.price_cfa),
    billing_period: license.billing_period ?? "custom",
    is_recommended: false,
    is_active: license.status !== "revoked"
  };
}

function effectiveLicenseStatus(license) {
  if (license.status === "revoked") return "revoked";
  if (license.status === "issued"
    && license.activation_deadline_at
    && Date.parse(license.activation_deadline_at) <= Date.now()) return "expired";
  if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) return "expired";
  return license.status;
}

function responseForLicense(license, activationId, routerCount, deviceCount) {
  const expiresAt = license.expires_at ?? null;
  const remaining = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000))
    : null;
  const effectiveStatus = license.status === "active" && remaining === 0 ? "expired" : license.status;
  return {
    valid: effectiveStatus === "active"
      && routerCount <= license.router_limit
      && deviceCount <= Number(license.max_devices ?? 1),
    license_id: license.id,
    activation_id: activationId,
    status: effectiveStatus,
    expires_at: expiresAt,
    duration_days: Number(license.duration_days),
    router_limit: Number(license.router_limit),
    router_count: routerCount,
    max_devices: Number(license.max_devices ?? 1),
    device_count: deviceCount,
    days_remaining: remaining,
    plan: licensePlanResponse(license)
  };
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",")[0].trim();
}

function isRateLimited(request) {
  const key = requestIp(request);
  const current = rateLimits.get(key);
  const now = Date.now();
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX;
}

function logEvent(request, licenseId, type, accountId, deviceIdHash, details = {}) {
  statements.insertEvent.run(
    licenseId ?? null,
    type,
    accountId ?? null,
    deviceIdHash ?? null,
    requestIp(request),
    JSON.stringify(details),
    nowIso()
  );
}

function syncRouterIds(licenseId, activationId, routerIds, routerLimit) {
  if (!Array.isArray(routerIds)) return Number(statements.countRouters.get(licenseId).count);
  const ids = [...new Set(routerIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 10_000);
  const incomingHashes = new Set(ids.map(hash));
  const allHashes = new Set(statements.otherRouterSources.all(licenseId, activationId).map((item) => item.router_fingerprint_hash));
  for (const value of incomingHashes) allHashes.add(value);
  if (allHashes.size > routerLimit) return allHashes.size;

  const timestampValue = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    statements.deleteRouterSourcesForActivation.run(activationId);
    for (const routerHash of incomingHashes) {
      statements.upsertRouterSource.run(licenseId, activationId, routerHash, timestampValue, timestampValue);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return Number(statements.countRouters.get(licenseId).count);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function sessionActor(request, actorType) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = statements.findSessionByToken.get(hash(token));
  if (!session || session.actor_type !== actorType) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    statements.revokeSession.run(nowIso(), session.id);
    return null;
  }
  statements.touchSession.run(nowIso(), session.id);
  return session;
}

function createSession(request, actorType, actorId, durationHours) {
  const token = randomToken(40);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();
  statements.insertSession.run(
    crypto.randomUUID(),
    actorType,
    actorId,
    hash(token),
    createdAt,
    expiresAt,
    createdAt,
    requestIp(request),
    String(request.headers["user-agent"] ?? "").slice(0, 500)
  );
  return { token, expires_at: expiresAt };
}

function organizationSession(request) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = statements.findOrganizationSessionByToken.get(hash(token));
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    statements.revokeOrganizationSession.run(nowIso(), session.id);
    return null;
  }
  statements.touchOrganizationSession.run(nowIso(), session.id);
  return session;
}

function createOrganizationSession(request, userId, membershipId = null, durationHours = 24 * 30) {
  const selectedMembership = membershipId
    ? statements.findOrganizationMembershipById.get(membershipId)
    : statements.listAcceptedMembershipsByUser.all(userId)[0];
  if (!selectedMembership || selectedMembership.user_id !== userId) {
    throw new HttpError(403, "Aucune organisation active n'est associée à ce compte.");
  }
  const token = randomToken(40);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();
  statements.insertOrganizationSession.run(
    crypto.randomUUID(),
    userId,
    hash(token),
    createdAt,
    expiresAt,
    createdAt,
    requestIp(request),
    String(request.headers["user-agent"] ?? "").slice(0, 500),
    selectedMembership.id
  );
  statements.touchOrganizationMembership.run(createdAt, createdAt, selectedMembership.id);
  return { token, expires_at: expiresAt, active_membership_id: selectedMembership.id };
}

function currentOrganizationSubscription(organizationId) {
  const timestamp = nowIso();
  statements.releaseStaleSubscriptionNotifications.run(
    new Date(Date.now() - 60 * 60_000).toISOString()
  );
  const paidExpirationThreshold = new Date(Date.now() - SAAS_PAID_GRACE_DAYS * DAY_MS).toISOString();
  statements.expireOrganizationSubscriptions.run(
    timestamp,
    organizationId,
    SAAS_TRIAL_PLAN_ID,
    timestamp,
    SAAS_TRIAL_PLAN_ID,
    paidExpirationThreshold
  );
  return statements.findActiveOrganizationSubscription.get(organizationId)
    ?? statements.findLatestOrganizationSubscription.get(organizationId)
    ?? null;
}

function organizationSubscriptionLifecycle(subscription, nowMs = Date.now()) {
  if (!subscription) {
    return {
      accessEndsAt: null,
      graceEndsAt: null,
      inGrace: false,
      isActive: false,
      isTrial: false
    };
  }
  const periodEndMs = Date.parse(subscription.current_period_end);
  const isTrial = subscription.plan_id === SAAS_TRIAL_PLAN_ID
    || subscription.plan_code === SAAS_TRIAL_PLAN_CODE;
  const graceEndsMs = isTrial
    ? periodEndMs
    : periodEndMs + SAAS_PAID_GRACE_DAYS * DAY_MS;
  const persistedActive = subscription.status === "active";
  return {
    accessEndsAt: Number.isFinite(graceEndsMs) ? new Date(graceEndsMs).toISOString() : null,
    graceEndsAt: !isTrial && Number.isFinite(graceEndsMs)
      ? new Date(graceEndsMs).toISOString()
      : null,
    inGrace: persistedActive && !isTrial && periodEndMs <= nowMs && nowMs < graceEndsMs,
    isActive: persistedActive && nowMs < graceEndsMs,
    isTrial
  };
}

function organizationSubscriptionResponse(subscription) {
  if (!subscription) {
    return {
      status: "none",
      is_active: false,
      router_limit: 0,
      device_limit_mode: "limited",
      max_devices: 0,
      current_period_start: null,
      current_period_end: null,
      access_ends_at: null,
      grace_period_end: null,
      grace_days_remaining: 0,
      is_trial: false,
      plan: null
    };
  }
  const lifecycle = organizationSubscriptionLifecycle(subscription);
  const graceDaysRemaining = lifecycle.inGrace && lifecycle.graceEndsAt
    ? Math.max(1, Math.ceil((Date.parse(lifecycle.graceEndsAt) - Date.now()) / DAY_MS))
    : 0;
  const limitMode = deviceLimitMode(subscription);
  return {
    id: subscription.id,
    status: lifecycle.inGrace
      ? "grace_period"
      : lifecycle.isActive
        ? lifecycle.isTrial ? "trial" : "active"
        : subscription.status === "cancelled" ? "cancelled" : "expired",
    is_active: lifecycle.isActive,
    router_limit: Number(subscription.router_limit),
    device_limit_mode: limitMode,
    max_devices: limitMode === "unlimited" ? null : Number(subscription.max_devices ?? 1),
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    access_ends_at: lifecycle.accessEndsAt,
    grace_period_end: lifecycle.graceEndsAt,
    grace_days_remaining: graceDaysRemaining,
    is_trial: lifecycle.isTrial,
    plan: {
      id: subscription.plan_id,
      code: subscription.plan_code,
      name: subscription.plan_name,
      price_cfa: Number(subscription.amount)
    }
  };
}

function normalizeOrganizationAppRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  if (!ORGANIZATION_APP_ROLES.has(role)) {
    throw new HttpError(400, "Rôle employé invalide.");
  }
  return role;
}

function createOwnerMembership(organizationId, userId, createdAt) {
  const membershipId = `membership:${organizationId}:${userId}`;
  statements.insertOrganizationMembership.run(
    membershipId,
    organizationId,
    userId,
    "owner",
    "admin",
    "all",
    "accepted",
    null,
    createdAt,
    createdAt,
    createdAt
  );
  return membershipId;
}

function organizationUserRouterAccess(membership) {
  const mode = membership.authority_role === "owner" || membership.router_access_mode === "all"
    ? "all"
    : "selected";
  return {
    mode,
    router_ids: mode === "all"
      ? []
      : statements.listMembershipRouterAccess.all(membership.id).map((item) => item.router_id)
  };
}

function organizationUserResponse(user, membership) {
  const appRole = membership.authority_role === "owner"
    ? "admin"
    : normalizeOrganizationAppRole(membership.app_role);
  return {
    id: user.id,
    membership_id: membership.id,
    organization_id: membership.organization_id,
    email: user.email,
    name: user.name,
    phone: user.phone ?? null,
    role: membership.authority_role,
    app_role: appRole,
    permissions: [
      ...ORGANIZATION_ROLE_PERMISSIONS[appRole],
      ...(membership.authority_role === "owner" ? ["global.subscription", "global.invoices"] : [])
    ],
    router_access: organizationUserRouterAccess(membership),
    invitation_pending: membership.invitation_status === "pending",
    status: membership.status,
    created_at: user.created_at,
    last_login_at: user.last_login_at ?? null
  };
}

function organizationAuthResponse(user, session = null, selectedMembership = null, requireSelection = false) {
  const membership = selectedMembership
    ?? (session?.active_membership_id
      ? statements.findOrganizationMembershipById.get(session.active_membership_id)
      : statements.listAcceptedMembershipsByUser.all(user.id)[0]);
  if (!membership || membership.user_id !== user.id) {
    throw new HttpError(403, "Aucune organisation active n'est disponible.");
  }
  const organization = statements.findOrganizationById.get(membership.organization_id);
  const subscription = currentOrganizationSubscription(membership.organization_id);
  const memberships = statements.listAcceptedMembershipsByUser.all(user.id);
  return {
    ...(session ? { session } : {}),
    user: organizationUserResponse(user, membership),
    organization: {
      id: organization.id,
      name: organization.name,
      status: organization.status
    },
    organizations: memberships.map((item) => ({
      membership_id: item.id,
      organization_id: item.organization_id,
      organization_name: item.organization_name,
      app_role: item.authority_role === "owner" ? "admin" : item.app_role,
      authority_role: item.authority_role,
      is_current: item.id === membership.id
    })),
    requires_organization_selection: requireSelection && memberships.length > 1,
    subscription: organizationSubscriptionResponse(subscription),
    access: {
      can_manage_billing: membership.authority_role === "owner",
      can_manage_team: membership.authority_role === "owner" || membership.app_role === "admin",
      can_manage_routers: organizationSubscriptionLifecycle(subscription).isActive
    }
  };
}

function requireOrganizationUser(request, { requireActiveSubscription = false } = {}) {
  const session = organizationSession(request);
  const user = session ? statements.findOrganizationUserById.get(session.user_id) : null;
  if (!user || user.status !== "active") {
    throw new HttpError(401, "Session TicketPro invalide.");
  }
  const membership = session.active_membership_id
    ? statements.findOrganizationMembershipById.get(session.active_membership_id)
    : null;
  if (!membership || membership.user_id !== user.id || membership.status !== "active"
    || membership.invitation_status !== "accepted") {
    throw new HttpError(403, "Cette appartenance à l'organisation n'est pas active.");
  }
  const organization = statements.findOrganizationById.get(membership.organization_id);
  if (!organization || organization.status === "suspended") {
    throw new HttpError(403, "Cette organisation est suspendue.");
  }
  const subscription = currentOrganizationSubscription(membership.organization_id);
  const active = organizationSubscriptionLifecycle(subscription).isActive;
  if (requireActiveSubscription && !active) {
    throw new HttpError(402, "Votre abonnement a expiré. Renouvelez-le pour utiliser les services TicketPro.", {
      code: "SUBSCRIPTION_REQUIRED",
      subscription: organizationSubscriptionResponse(subscription)
    });
  }
  return { session, user, membership, organization, subscription, active };
}

function requireTeamManager(request) {
  const context = requireOrganizationUser(request);
  if (context.membership.authority_role !== "owner" && context.membership.app_role !== "admin") {
    throw new HttpError(403, "Seuls le propriétaire et les administrateurs peuvent gérer l'équipe.");
  }
  return context;
}

function organizationContextHasPermission(context, permission) {
  const appRole = context.membership.authority_role === "owner"
    ? "admin"
    : normalizeOrganizationAppRole(context.membership.app_role);
  return (ORGANIZATION_ROLE_PERMISSIONS[appRole] ?? []).includes(permission);
}

function requireOrganizationPermission(request, permission, options = {}) {
  const context = requireOrganizationUser(request, options);
  const appRole = context.membership.authority_role === "owner"
    ? "admin"
    : normalizeOrganizationAppRole(context.membership.app_role);
  const permissions = ORGANIZATION_ROLE_PERMISSIONS[appRole] ?? [];
  if (!permissions.includes(permission)) {
    throw new HttpError(403, "Votre rôle n'autorise pas cette action.");
  }
  return context;
}

function requireOrganizationRouterPermission(request, permission, routerId) {
  const context = requireOrganizationPermission(
    request,
    permission,
    { requireActiveSubscription: true }
  );
  const access = organizationUserRouterAccess(context.membership);
  if (access.mode !== "all" && !access.router_ids.includes(routerId)) {
    throw new HttpError(403, "Ce profil n'est pas autorisé à gérer ce routeur.");
  }
  return context;
}

function requireOrganizationRouterAnyPermission(request, permissions, routerId) {
  const context = requireOrganizationUser(request, { requireActiveSubscription: true });
  if (!permissions.some((permission) => organizationContextHasPermission(context, permission))) {
    throw new HttpError(403, "Votre rôle n'autorise pas cette action.");
  }
  const access = organizationUserRouterAccess(context.membership);
  if (access.mode !== "all" && !access.router_ids.includes(routerId)) {
    throw new HttpError(403, "Ce profil n'est pas autorisé à gérer ce routeur.");
  }
  return context;
}

function normalizeRouterAccessPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Politique réseau invalide.");
  }
  const antiSharingMode = String(value.antiSharingMode ?? "");
  if (!["disabled", "observe", "strict"].includes(antiSharingMode)) {
    throw new HttpError(400, "Mode anti-partage invalide.");
  }
  if (!Array.isArray(value.infrastructureDevices) || value.infrastructureDevices.length > 100) {
    throw new HttpError(400, "La liste des équipements d'infrastructure est invalide.");
  }
  const seenIds = new Set();
  const seenMacs = new Set();
  const seenIps = new Set();
  const infrastructureDevices = value.infrastructureDevices.map((rawDevice) => {
    if (!rawDevice || typeof rawDevice !== "object" || Array.isArray(rawDevice)) {
      throw new HttpError(400, "Équipement d'infrastructure invalide.");
    }
    const id = String(rawDevice.id ?? "").trim();
    const name = String(rawDevice.name ?? "").trim();
    const macAddress = String(rawDevice.macAddress ?? "")
      .trim()
      .replaceAll("-", ":")
      .toUpperCase();
    const ipAddress = String(rawDevice.ipAddress ?? "").trim();
    const mode = String(rawDevice.mode ?? "");
    const type = String(rawDevice.type ?? "");
    const internetBypass = rawDevice.internetBypass === true;
    if (!id || id.length > 200 || seenIds.has(id)) {
      throw new HttpError(400, "Identifiant d'équipement invalide ou dupliqué.");
    }
    if (!name || name.length > 200) {
      throw new HttpError(400, "Nom d'équipement invalide.");
    }
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress) || seenMacs.has(macAddress)) {
      throw new HttpError(400, "Adresse MAC invalide ou dupliquée.");
    }
    if (!isIpv4Address(ipAddress) || seenIps.has(ipAddress)) {
      throw new HttpError(400, "Adresse IP invalide ou dupliquée.");
    }
    if (!["bridge", "router_nat", "unknown"].includes(mode)) {
      throw new HttpError(400, "Mode réseau d'équipement invalide.");
    }
    if (!["access_point", "antenna", "other", "repeater"].includes(type)) {
      throw new HttpError(400, "Type d'équipement invalide.");
    }
    if (internetBypass && mode !== "bridge") {
      throw new HttpError(400, "Le bypass Internet exige un équipement en bridge transparent.");
    }
    seenIds.add(id);
    seenMacs.add(macAddress);
    seenIps.add(ipAddress);
    return { id, internetBypass, ipAddress, macAddress, mode, name, type };
  });
  if (
    value.blockedDevices !== undefined
    && (!Array.isArray(value.blockedDevices) || value.blockedDevices.length > 100)
  ) {
    throw new HttpError(400, "La liste des appareils bloqués est invalide.");
  }
  const seenBlockedIds = new Set();
  const seenBlockedMacs = new Set();
  const seenBlockedIps = new Set();
  const blockedDevices = (value.blockedDevices ?? []).map((rawDevice) => {
    if (!rawDevice || typeof rawDevice !== "object" || Array.isArray(rawDevice)) {
      throw new HttpError(400, "Appareil bloqué invalide.");
    }
    const id = String(rawDevice.id ?? "").trim();
    const name = String(rawDevice.name ?? "").trim();
    const ipAddress = String(rawDevice.ipAddress ?? "").trim();
    const macAddress = String(rawDevice.macAddress ?? "")
      .trim()
      .replaceAll("-", ":")
      .toUpperCase();
    if (!id || id.length > 200 || seenBlockedIds.has(id)) {
      throw new HttpError(400, "Identifiant d'appareil bloqué invalide ou dupliqué.");
    }
    if (!name || name.length > 200) throw new HttpError(400, "Nom d'appareil bloqué invalide.");
    if (!ipAddress && !macAddress) throw new HttpError(400, "Une adresse IP ou MAC est requise.");
    if (ipAddress && !isIpv4Address(ipAddress)) throw new HttpError(400, "Adresse IP bloquée invalide.");
    if (macAddress && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress)) {
      throw new HttpError(400, "Adresse MAC bloquée invalide.");
    }
    if (macAddress && (seenMacs.has(macAddress) || seenBlockedMacs.has(macAddress))) {
      throw new HttpError(400, "Adresse MAC déjà présente dans un autre IP Binding.");
    }
    if (ipAddress && (seenIps.has(ipAddress) || seenBlockedIps.has(ipAddress))) {
      throw new HttpError(400, "Adresse IP déjà présente dans un autre IP Binding.");
    }
    seenBlockedIds.add(id);
    if (macAddress) seenBlockedMacs.add(macAddress);
    if (ipAddress) seenBlockedIps.add(ipAddress);
    return { id, ipAddress, macAddress, name };
  });
  return {
    antiSharingMode,
    blockedDevices,
    infrastructureDevices,
    lockVoucherToFirstMac: value.lockVoucherToFirstMac === true,
    monitorIpv4Ttl: value.monitorIpv4Ttl === true,
    monitorIpv6HopLimit: value.monitorIpv6HopLimit === true
  };
}

function isIpv4Address(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => {
    const number = Number(part);
    return /^\d{1,3}$/.test(part) && number >= 0 && number <= 255;
  });
}

function routerAccessPolicyResponse(record) {
  if (!record) return null;
  return {
    organization_id: record.organization_id,
    router_id: record.router_id,
    policy: normalizeRouterAccessPolicy(JSON.parse(record.policy_json)),
    revision: Number(record.revision),
    updated_at: record.updated_at
  };
}

function routerAccessPolicyHistoryResponse(record) {
  return {
    organization_id: record.organization_id,
    router_id: record.router_id,
    policy: normalizeRouterAccessPolicy(JSON.parse(record.policy_json)),
    revision: Number(record.revision),
    changed_by_user_id: record.changed_by_user_id,
    changed_at: record.changed_at
  };
}

function decodeRouterVaultKey(value) {
  let decoded;
  try {
    decoded = Buffer.from(String(value), "base64");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== 32) {
    throw new Error("ROUTER_VAULT_KEY doit être une clé aléatoire de 32 octets encodée en base64.");
  }
  return decoded;
}

function decodeOptionalTicketArchiveKey(value) {
  if (!String(value).trim()) return null;
  let decoded;
  try {
    decoded = Buffer.from(String(value), "base64");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== 32) {
    throw new Error("TICKET_ARCHIVE_KEY doit être une clé aléatoire de 32 octets encodée en base64.");
  }
  return decoded;
}

function requireTicketArchiveKey() {
  if (!ticketArchiveKey) {
    throw new HttpError(503, "L'archive sécurisée des vouchers n'est pas encore configurée.", {
      code: "TICKET_ARCHIVE_UNAVAILABLE"
    });
  }
  return ticketArchiveKey;
}

function encryptTicketPrintArchive(organizationId, routerId, fileId, archive) {
  const key = requireTicketArchiveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(
    `ticketpro-print-archive-v1:${organizationId}:${routerId}:${fileId}`,
    "utf8"
  ));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(archive), "utf8"),
    cipher.final()
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1
  };
}

function decryptTicketPrintArchive(record) {
  const key = requireTicketArchiveKey();
  if (
    Number(record.print_archive_version) !== 1
    || !record.print_archive_ciphertext
    || !record.print_archive_iv
    || !record.print_archive_tag
  ) {
    throw new HttpError(404, "Aucune archive d'impression sécurisée n'est disponible pour ce lot.", {
      code: "TICKET_ARCHIVE_NOT_FOUND"
    });
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.print_archive_iv, "base64")
    );
    decipher.setAAD(Buffer.from(
      `ticketpro-print-archive-v1:${record.organization_id}:${record.router_id}:${record.id}`,
      "utf8"
    ));
    decipher.setAuthTag(Buffer.from(record.print_archive_tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.print_archive_ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    return normalizeTicketPrintArchive(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "L'archive d'impression sécurisée est illisible.", {
      code: "TICKET_ARCHIVE_CORRUPTED"
    });
  }
}

function encryptRouterCredential(organizationId, routerId, credential) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", routerVaultKey, iv);
  cipher.setAAD(Buffer.from(`ticketpro-router-v1:${organizationId}:${routerId}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(String(credential), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

function decryptRouterCredential(record) {
  const [version, ivValue, tagValue, ciphertextValue] = String(record.credential_ciphertext).split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new HttpError(500, "Le coffre RouterOS contient une donnée illisible.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      routerVaultKey,
      Buffer.from(ivValue, "base64")
    );
    decipher.setAAD(Buffer.from(
      `ticketpro-router-v1:${record.organization_id}:${record.id}`,
      "utf8"
    ));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new HttpError(500, "Le coffre RouterOS n'a pas pu ouvrir les identifiants de ce routeur.");
  }
}

function normalizeOrganizationRouterSnapshot(value, { requireCredential = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Sauvegarde routeur invalide.");
  }
  const id = requireSnapshotText(value, "id", 200);
  const stableIdentity = requireSnapshotText(value, "stable_identity", 200).toLowerCase();
  const connectionMode = String(value.connection_mode ?? "");
  if (!["local", "vpn", "distant_ip", "agent_future"].includes(connectionMode)) {
    throw new HttpError(400, "Mode de connexion routeur invalide.");
  }
  const status = String(value.status ?? "warning");
  if (!["active", "offline", "warning"].includes(status)) {
    throw new HttpError(400, "Statut routeur invalide.");
  }
  const connections = normalizeRouterConnections(value.connections);
  const plans = normalizeRouterPlans(value.plans);
  const credential = typeof value.credential === "string" ? value.credential : "";
  if (requireCredential && (!credential || credential.length > 512)) {
    throw new HttpError(400, "Identifiant secret RouterOS manquant ou invalide.");
  }
  return {
    api_port: normalizePort(value.api_port, 8728),
    api_ssl_port: normalizePort(value.api_ssl_port, 8729),
    board_name: optionalSnapshotText(value.board_name, 200),
    connection_mode: connectionMode,
    connections,
    credential,
    hotspot_address: optionalSnapshotText(value.hotspot_address, 255),
    id,
    label: requireSnapshotText(value, "label", 200),
    last_seen_at: normalizeOptionalIsoDate(value.last_seen_at),
    local_ip: requireSnapshotText(value, "local_ip", 255),
    model: optionalSnapshotText(value.model, 200),
    name: requireSnapshotText(value, "name", 200),
    notes: optionalSnapshotText(value.notes, 2_000),
    plans,
    routeros_version: optionalSnapshotText(value.routeros_version, 100),
    serial_number: optionalSnapshotText(value.serial_number, 200),
    stable_identity: stableIdentity,
    status,
    username: requireSnapshotText(value, "username", 200),
    vpn: normalizeRouterVpn(value.vpn)
  };
}

function normalizeRouterConnections(value) {
  if (!Array.isArray(value) || value.length > 8) {
    throw new HttpError(400, "Connexions routeur invalides.");
  }
  return value.map((connection) => {
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
      throw new HttpError(400, "Connexion routeur invalide.");
    }
    const mode = String(connection.mode ?? "");
    if (!["local", "vpn", "distant_ip", "agent_future"].includes(mode)) {
      throw new HttpError(400, "Mode de connexion sauvegardé invalide.");
    }
    return {
      host: requireSnapshotText(connection, "host", 255),
      mode,
      port: normalizePort(connection.port, mode === "vpn" ? 8728 : 8728),
      status: String(connection.status ?? "inactive") === "active" ? "active" : "inactive",
      use_ssl: connection.use_ssl === true || connection.use_ssl === 1
    };
  });
}

function normalizeRouterPlans(value) {
  if (!Array.isArray(value) || value.length > 250) {
    throw new HttpError(400, "Liste des plans Hotspot invalide.");
  }
  return value.map((plan) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      throw new HttpError(400, "Plan Hotspot invalide.");
    }
    const planId = requireSnapshotText(plan, "id", 200);
    const currency = normalizeSnapshotCurrency(plan.currency);
    return {
      created_at: normalizeOptionalIsoDate(plan.created_at) ?? nowIso(),
      created_by_profile_id: optionalSnapshotText(plan.created_by_profile_id, 200),
      currency,
      data_limit_mb: normalizeOptionalNonNegativeInteger(plan.data_limit_mb),
      download_limit: optionalSnapshotText(plan.download_limit, 100),
      duration_minutes: normalizeNonNegativeInteger(plan.duration_minutes),
      history: normalizeRouterPlanHistory(plan.history, planId, currency),
      id: planId,
      last_synced_at: normalizeOptionalIsoDate(plan.last_synced_at),
      mikrotik_id: optionalSnapshotText(plan.mikrotik_id, 200),
      mikrotik_profile_name: optionalSnapshotText(plan.mikrotik_profile_name, 200),
      name: requireSnapshotText(plan, "name", 200),
      price_hint: normalizeOptionalNonNegativeInteger(plan.price_hint),
      revision: Math.max(1, normalizeNonNegativeInteger(plan.revision ?? 1)),
      shared_users: Math.max(1, normalizeNonNegativeInteger(plan.shared_users ?? 1)),
      status: optionalSnapshotText(plan.status, 50) ?? "active",
      upload_limit: optionalSnapshotText(plan.upload_limit, 100),
      updated_at: normalizeOptionalIsoDate(plan.updated_at) ?? nowIso(),
      updated_by_profile_id: optionalSnapshotText(plan.updated_by_profile_id, 200),
      validity_minutes: normalizeOptionalNonNegativeInteger(plan.validity_minutes)
    };
  });
}

function normalizeRouterPlanHistory(value, planId, fallbackCurrency) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) {
    throw new HttpError(400, "Historique du plan Hotspot invalide.");
  }
  const allowedActions = new Set(["created", "updated", "deleted", "restored", "synchronized"]);
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "Entrée d'historique du plan invalide.");
    }
    const action = String(entry.action ?? "");
    if (!allowedActions.has(action)) {
      throw new HttpError(400, "Action d'historique du plan invalide.");
    }
    const snapshotJson = requireSnapshotText(entry, "snapshot_json", 20_000);
    try {
      JSON.parse(snapshotJson);
    } catch {
      throw new HttpError(400, "Instantané d'historique du plan invalide.");
    }
    return {
      action,
      actor_profile_id: optionalSnapshotText(entry.actor_profile_id, 200),
      created_at: normalizeOptionalIsoDate(entry.created_at) ?? nowIso(),
      currency: normalizeSnapshotCurrency(entry.currency ?? fallbackCurrency),
      id: requireSnapshotText(entry, "id", 200),
      mikrotik_id: optionalSnapshotText(entry.mikrotik_id, 200),
      mikrotik_profile_name: optionalSnapshotText(entry.mikrotik_profile_name, 200),
      name: requireSnapshotText(entry, "name", 200),
      plan_id: planId,
      price_hint: normalizeOptionalNonNegativeInteger(entry.price_hint),
      revision: Math.max(1, normalizeNonNegativeInteger(entry.revision ?? 1)),
      router_id: optionalSnapshotText(entry.router_id, 200) ?? "cloud",
      snapshot_json: snapshotJson,
      source: optionalSnapshotText(entry.source, 100) ?? "ticketpro"
    };
  });
}

function normalizeSnapshotCurrency(value) {
  const currency = String(value ?? "CFA").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new HttpError(400, "Devise du plan Hotspot invalide.");
  }
  return currency;
}

function normalizeOrganizationTicketCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Catalogue de vouchers invalide.");
  }
  const batches = Array.isArray(value.batches) ? value.batches : [];
  const tickets = Array.isArray(value.tickets) ? value.tickets : [];
  if (batches.length > 100 || tickets.length > 1_000) {
    throw new HttpError(400, "Le catalogue de vouchers dépasse la taille autorisée.");
  }
  return {
    batches: batches.map(normalizeOrganizationTicketBatch),
    tickets: tickets.map(normalizeOrganizationTicket)
  };
}

function normalizeOrganizationTicketBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    throw new HttpError(400, "Lot de vouchers invalide.");
  }
  return {
    code_length: Math.max(1, normalizeNonNegativeInteger(batch.code_length)),
    created_at: normalizeOptionalIsoDate(batch.created_at) ?? nowIso(),
    currency: normalizeSnapshotCurrency(batch.currency),
    hotspot_server_name: optionalSnapshotText(batch.hotspot_server_name, 200) ?? "all",
    id: requireSnapshotText(batch, "id", 200),
    plan_id: requireSnapshotText(batch, "plan_id", 200),
    prefix: optionalSnapshotText(batch.prefix, 50),
    price_snapshot: normalizeOptionalNonNegativeInteger(batch.price_snapshot),
    quantity: Math.max(1, normalizeNonNegativeInteger(batch.quantity)),
    status: requireSnapshotText(batch, "status", 50),
    sync_status: optionalSnapshotText(batch.sync_status, 50) ?? "synced",
    updated_at: normalizeOptionalIsoDate(batch.updated_at) ?? nowIso()
  };
}

function normalizeOrganizationTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw new HttpError(400, "Voucher invalide.");
  }
  return {
    activated_at: normalizeOptionalIsoDate(ticket.activated_at),
    archived_at: normalizeOptionalIsoDate(ticket.archived_at),
    batch_id: requireSnapshotText(ticket, "batch_id", 200),
    completed_at: normalizeOptionalIsoDate(ticket.completed_at),
    created_at: normalizeOptionalIsoDate(ticket.created_at) ?? nowIso(),
    data_limit_mb_snapshot: normalizeOptionalNonNegativeInteger(ticket.data_limit_mb_snapshot),
    data_remaining_bytes: normalizeOptionalNonNegativeInteger(ticket.data_remaining_bytes),
    deleted_at: normalizeOptionalIsoDate(ticket.deleted_at),
    downloaded_bytes: normalizeNonNegativeInteger(ticket.downloaded_bytes),
    download_limit_snapshot: optionalSnapshotText(ticket.download_limit_snapshot, 100),
    duration_minutes_snapshot: normalizeOptionalNonNegativeInteger(ticket.duration_minutes_snapshot),
    expires_at: normalizeOptionalIsoDate(ticket.expires_at),
    exported_at: normalizeOptionalIsoDate(ticket.exported_at),
    hotspot_server_name: optionalSnapshotText(ticket.hotspot_server_name, 200) ?? "all",
    id: requireSnapshotText(ticket, "id", 240),
    ip_address: optionalSnapshotText(ticket.ip_address, 100),
    last_router_sync_at: normalizeOptionalIsoDate(ticket.last_router_sync_at),
    mac_address: optionalSnapshotText(ticket.mac_address, 100),
    mikrotik_id: optionalSnapshotText(ticket.mikrotik_id, 200),
    mikrotik_profile_name: optionalSnapshotText(ticket.mikrotik_profile_name, 200),
    password_is_username: ticket.password_is_username === true || ticket.password_is_username === 1,
    plan_id: requireSnapshotText(ticket, "plan_id", 200),
    printed_count: normalizeNonNegativeInteger(ticket.printed_count),
    remaining_seconds: normalizeOptionalNonNegativeInteger(ticket.remaining_seconds),
    router_deleted_at: normalizeOptionalIsoDate(ticket.router_deleted_at),
    shared_users_snapshot: normalizeOptionalNonNegativeInteger(ticket.shared_users_snapshot),
    status: requireSnapshotText(ticket, "status", 50),
    sync_status: optionalSnapshotText(ticket.sync_status, 50) ?? "synced",
    updated_at: normalizeOptionalIsoDate(ticket.updated_at) ?? nowIso(),
    uploaded_bytes: normalizeNonNegativeInteger(ticket.uploaded_bytes),
    upload_limit_snapshot: optionalSnapshotText(ticket.upload_limit_snapshot, 100),
    uptime_seconds: normalizeNonNegativeInteger(ticket.uptime_seconds),
    username: requireSnapshotText(ticket, "username", 200),
    validity_minutes_snapshot: normalizeOptionalNonNegativeInteger(ticket.validity_minutes_snapshot)
  };
}

function mergeOrganizationTicket(existing, incoming) {
  if (!existing) return incoming;

  const currentRank = organizationTicketLifecycleRank(existing.status);
  const incomingRank = organizationTicketLifecycleRank(incoming.status);
  const currentStatus = normalizeOrganizationTicketStatus(existing.status);
  const statusRegression = (
    (currentRank >= 2 && incomingRank < currentRank)
    || (
      currentRank === 1
      && incomingRank === 0
      && !isOrganizationTicketDisabledStatus(currentStatus)
    )
  );
  const commercialSnapshotMutable = currentRank < 2
    && !existing.activated_at
    && !existing.completed_at
    && !existing.expires_at
    && !existing.exported_at
    && Number(existing.printed_count) === 0
    && Number(existing.downloaded_bytes) === 0
    && Number(existing.uploaded_bytes) === 0
    && Number(existing.uptime_seconds) === 0;
  const snapshotValue = (field) => {
    if (commercialSnapshotMutable) return incoming[field];
    return existing[field] ?? incoming[field] ?? null;
  };

  return {
    ...incoming,
    activated_at: existing.activated_at ?? incoming.activated_at,
    archived_at: existing.archived_at ?? incoming.archived_at,
    batch_id: existing.batch_id,
    completed_at: existing.completed_at ?? incoming.completed_at,
    created_at: existing.created_at,
    data_limit_mb_snapshot: snapshotValue("data_limit_mb_snapshot"),
    data_remaining_bytes: minimumKnownCounter(existing.data_remaining_bytes, incoming.data_remaining_bytes),
    deleted_at: existing.deleted_at ?? incoming.deleted_at,
    downloaded_bytes: Math.max(Number(existing.downloaded_bytes), incoming.downloaded_bytes),
    download_limit_snapshot: snapshotValue("download_limit_snapshot"),
    duration_minutes_snapshot: snapshotValue("duration_minutes_snapshot"),
    expires_at: existing.expires_at ?? incoming.expires_at,
    exported_at: existing.exported_at ?? incoming.exported_at,
    last_router_sync_at: latestKnownIso(existing.last_router_sync_at, incoming.last_router_sync_at),
    mikrotik_id: existing.mikrotik_id ?? incoming.mikrotik_id,
    mikrotik_profile_name: commercialSnapshotMutable
      ? incoming.mikrotik_profile_name
      : existing.mikrotik_profile_name ?? incoming.mikrotik_profile_name,
    password_is_username: Number(existing.password_is_username) === 1,
    plan_id: commercialSnapshotMutable ? incoming.plan_id : existing.plan_id,
    printed_count: Math.max(Number(existing.printed_count), incoming.printed_count),
    remaining_seconds: minimumKnownCounter(existing.remaining_seconds, incoming.remaining_seconds),
    router_deleted_at: existing.router_deleted_at ?? incoming.router_deleted_at,
    shared_users_snapshot: snapshotValue("shared_users_snapshot"),
    status: statusRegression ? existing.status : incoming.status,
    sync_status: statusRegression ? "conflict" : incoming.sync_status,
    uploaded_bytes: Math.max(Number(existing.uploaded_bytes), incoming.uploaded_bytes),
    upload_limit_snapshot: snapshotValue("upload_limit_snapshot"),
    uptime_seconds: Math.max(Number(existing.uptime_seconds), incoming.uptime_seconds),
    username: existing.username,
    validity_minutes_snapshot: snapshotValue("validity_minutes_snapshot")
  };
}

function normalizeOrganizationTicketStatus(status) {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function organizationTicketLifecycleRank(status) {
  const normalized = normalizeOrganizationTicketStatus(status);
  if (normalized.includes("router_deleted") || (normalized.includes("supprim") && normalized.includes("routeur"))) return 4;
  if (normalized.includes("archiv") || normalized === "deleted" || normalized.includes("supprim")) return 5;
  if (normalized.includes("expir")) return 3;
  if (normalized.includes("consomm") || normalized.includes("puis") || normalized.includes("exhaust")) return 2;
  if (
    normalized.includes("en_cours")
    || normalized.includes("complet")
    || normalized.includes("activ")
    || normalized.includes("disabled")
  ) return 1;
  return 0;
}

function isOrganizationTicketDisabledStatus(normalized) {
  return normalized.includes("disabled")
    || normalized.includes("desactiv")
    || normalized.includes("sactiv");
}

function minimumKnownCounter(left, right) {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return Number(left);
  return Math.min(Number(left), Number(right));
}

function latestKnownIso(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function organizationTicketBatchResponse(record) {
  return {
    code_length: Number(record.code_length),
    created_at: record.created_at,
    created_by_email: record.created_by_email,
    created_by_name: record.created_by_name,
    created_by_user_id: record.created_by_user_id,
    currency: record.currency,
    hotspot_server_name: record.hotspot_server_name,
    id: record.id,
    operator_profile: record.operator_profile,
    plan_id: record.plan_id,
    prefix: record.prefix,
    price_snapshot: record.price_snapshot === null ? null : Number(record.price_snapshot),
    quantity: Number(record.quantity),
    status: record.status,
    sync_status: record.sync_status,
    updated_at: record.updated_at
  };
}

function organizationTicketResponse(record) {
  return {
    activated_at: record.activated_at,
    archived_at: record.archived_at,
    batch_id: record.batch_id,
    completed_at: record.completed_at,
    created_at: record.created_at,
    created_by_email: record.created_by_email,
    created_by_name: record.created_by_name,
    created_by_role: record.created_by_role,
    created_by_user_id: record.created_by_user_id,
    data_limit_mb_snapshot: record.data_limit_mb_snapshot === null ? null : Number(record.data_limit_mb_snapshot),
    data_remaining_bytes: record.data_remaining_bytes === null ? null : Number(record.data_remaining_bytes),
    deleted_at: record.deleted_at,
    downloaded_bytes: Number(record.downloaded_bytes),
    download_limit_snapshot: record.download_limit_snapshot,
    duration_minutes_snapshot: record.duration_minutes_snapshot === null ? null : Number(record.duration_minutes_snapshot),
    expires_at: record.expires_at,
    exported_at: record.exported_at,
    hotspot_server_name: record.hotspot_server_name,
    id: record.id,
    ip_address: record.ip_address,
    last_router_sync_at: record.last_router_sync_at,
    mac_address: record.mac_address,
    mikrotik_id: record.mikrotik_id,
    mikrotik_profile_name: record.mikrotik_profile_name,
    password_is_username: Number(record.password_is_username) === 1,
    plan_id: record.plan_id,
    printed_count: Number(record.printed_count),
    remaining_seconds: record.remaining_seconds === null ? null : Number(record.remaining_seconds),
    router_deleted_at: record.router_deleted_at,
    shared_users_snapshot: record.shared_users_snapshot === null ? null : Number(record.shared_users_snapshot),
    status: record.status,
    sync_status: record.sync_status,
    updated_at: record.updated_at,
    uploaded_bytes: Number(record.uploaded_bytes),
    upload_limit_snapshot: record.upload_limit_snapshot,
    uptime_seconds: Number(record.uptime_seconds),
    username: record.username,
    validity_minutes_snapshot: record.validity_minutes_snapshot === null ? null : Number(record.validity_minutes_snapshot)
  };
}

function normalizeOrganizationGeneratedFile(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new HttpError(400, "Fichier généré invalide.");
  }
  const metadataJson = optionalSnapshotText(file.metadata_json, 16_000);
  if (metadataJson) {
    try {
      JSON.parse(metadataJson);
    } catch {
      throw new HttpError(400, "Métadonnées du fichier invalides.");
    }
  }
  return {
    batch_id: optionalSnapshotText(file.batch_id, 240),
    created_at: normalizeOptionalIsoDate(file.created_at) ?? nowIso(),
    deleted_at: normalizeOptionalIsoDate(file.deleted_at),
    file_name: requireSnapshotText(file, "file_name", 300),
    format: requireSnapshotText(file, "format", 50),
    id: requireSnapshotText(file, "id", 240),
    metadata_json: metadataJson,
    sync_status: optionalSnapshotText(file.sync_status, 50) ?? "synced",
    type: requireSnapshotText(file, "type", 100),
    updated_at: normalizeOptionalIsoDate(file.updated_at) ?? nowIso()
  };
}

function normalizeTicketPrintArchive(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Number(value.version) !== 1) {
    throw new HttpError(400, "Archive d'impression invalide.");
  }
  if (!Array.isArray(value.tickets) || value.tickets.length < 1 || value.tickets.length > 500) {
    throw new HttpError(400, "L'archive doit contenir entre 1 et 500 vouchers.");
  }
  const seenUsernames = new Set();
  const tickets = value.tickets.map((rawTicket) => {
    if (!rawTicket || typeof rawTicket !== "object" || Array.isArray(rawTicket)) {
      throw new HttpError(400, "Voucher archivé invalide.");
    }
    const username = requireArchiveString(rawTicket.username, "username", 128);
    const password = requireArchiveString(rawTicket.password, "password", 256, false);
    if (seenUsernames.has(username)) {
      throw new HttpError(400, "L'archive contient plusieurs fois le même voucher.");
    }
    seenUsernames.add(username);
    return { password, username };
  });
  const format = requireArchiveString(value.format, "format", 20);
  if (!new Set(["a4", "a5", "thermal58", "thermal80"]).has(format)) {
    throw new HttpError(400, "Format d'archive invalide.");
  }
  const template = requireArchiveString(value.template, "template", 20);
  if (!new Set(["economy", "premium", "qr", "simple"]).has(template)) {
    throw new HttpError(400, "Modèle d'archive invalide.");
  }
  const displaySettings = value.displaySettings && typeof value.displaySettings === "object"
    && !Array.isArray(value.displaySettings)
    ? JSON.parse(JSON.stringify(value.displaySettings))
    : undefined;
  if (displaySettings && Buffer.byteLength(JSON.stringify(displaySettings), "utf8") > 8_000) {
    throw new HttpError(400, "Paramètres d'affichage de l'archive trop volumineux.");
  }
  return {
    batchId: requireArchiveString(value.batchId, "batchId", 240),
    currency: optionalArchiveString(value.currency, 12),
    dataLimitLabel: optionalArchiveString(value.dataLimitLabel, 80),
    displaySettings,
    durationLabel: requireArchiveString(value.durationLabel, "durationLabel", 80),
    format,
    hotspotAddress: requireArchiveString(value.hotspotAddress, "hotspotAddress", 255),
    ownerPhone: optionalArchiveString(value.ownerPhone, 40) ?? "",
    planName: requireArchiveString(value.planName, "planName", 200),
    priceLabel: optionalArchiveString(value.priceLabel, 100),
    qrCodeEnabled: value.qrCodeEnabled === true,
    template,
    tickets,
    titleLabel: requireArchiveString(value.titleLabel, "titleLabel", 200),
    validityLabel: requireArchiveString(value.validityLabel, "validityLabel", 80),
    version: 1,
    zoneName: requireArchiveString(value.zoneName, "zoneName", 200)
  };
}

function requireArchiveString(value, field, maxLength, trim = true) {
  const raw = String(value ?? "");
  const result = trim ? raw.trim() : raw;
  if (!result || result.length > maxLength) {
    throw new HttpError(400, `Champ d'archive ${field} invalide.`);
  }
  return result;
}

function optionalArchiveString(value, maxLength) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const result = String(value).trim();
  if (result.length > maxLength) throw new HttpError(400, "Champ d'archive trop long.");
  return result;
}

function organizationGeneratedFileResponse(record) {
  return {
    batch_id: record.batch_id,
    created_at: record.created_at,
    created_by_email: record.created_by_email,
    created_by_name: record.created_by_name,
    created_by_role: record.created_by_role,
    created_by_user_id: record.created_by_user_id,
    deleted_at: record.deleted_at,
    file_name: record.file_name,
    format: record.format,
    id: record.id,
    metadata_json: record.metadata_json,
    print_archive_available: Boolean(record.print_archive_ciphertext),
    router_id: record.router_id,
    sync_status: record.sync_status,
    type: record.type,
    updated_at: record.updated_at
  };
}

function normalizeOrganizationActivityLog(log) {
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new HttpError(400, "Journal d'activité invalide.");
  }
  const level = requireSnapshotText(log, "level", 20);
  if (!new Set(["critical", "error", "info", "warning"]).has(level)) {
    throw new HttpError(400, "Niveau de journal invalide.");
  }
  return {
    category: requireSnapshotText(log, "category", 100),
    created_at: normalizeOptionalIsoDate(log.created_at) ?? nowIso(),
    id: requireSnapshotText(log, "id", 240),
    level,
    technical_message: optionalSnapshotText(log.technical_message, 4_000),
    user_message: requireSnapshotText(log, "user_message", 1_000)
  };
}

function organizationActivityLogResponse(record) {
  return {
    category: record.category,
    created_at: record.created_at,
    created_by_email: record.created_by_email,
    created_by_name: record.created_by_name,
    created_by_role: record.created_by_role,
    created_by_user_id: record.created_by_user_id,
    id: record.id,
    level: record.level,
    router_id: record.router_id,
    technical_message: record.technical_message,
    user_message: record.user_message
  };
}

function normalizeRouterVpn(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "État VPN routeur invalide.");
  }
  return {
    assigned_address: requireSnapshotText(value, "assigned_address", 100),
    public_key: requireSnapshotText(value, "public_key", 128),
    status: ["active", "draft", "revoked"].includes(String(value.status))
      ? String(value.status)
      : "draft"
  };
}

function organizationRouterRecoveryResponse(record) {
  return {
    api_port: Number(record.api_port),
    api_ssl_port: Number(record.api_ssl_port),
    board_name: record.board_name,
    connection_mode: record.connection_mode,
    connections: JSON.parse(record.connections_json),
    credential: decryptRouterCredential(record),
    hotspot_address: record.hotspot_address,
    id: record.id,
    label: record.label,
    last_seen_at: record.last_seen_at,
    local_ip: record.local_ip,
    model: record.model,
    name: record.name,
    notes: record.notes,
    plans: JSON.parse(record.plans_json),
    routeros_version: record.routeros_version,
    serial_number: record.serial_number,
    stable_identity: record.stable_identity,
    status: record.status,
    updated_at: record.updated_at,
    username: record.username,
    vpn: record.vpn_json ? JSON.parse(record.vpn_json) : null
  };
}

function requireSnapshotText(value, field, maxLength) {
  const result = String(value?.[field] ?? "").trim();
  if (!result || result.length > maxLength) {
    throw new HttpError(400, `Champ routeur ${field} invalide.`);
  }
  return result;
}

function optionalSnapshotText(value, maxLength) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return String(value).trim().slice(0, maxLength);
}

function normalizePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HttpError(400, "Port routeur invalide.");
  }
  return port;
}

function normalizeNonNegativeInteger(value) {
  const result = Number(value ?? 0);
  if (!Number.isInteger(result) || result < 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, "Valeur numérique routeur invalide.");
  }
  return result;
}

function normalizeOptionalNonNegativeInteger(value) {
  return value === null || value === undefined || value === ""
    ? null
    : normalizeNonNegativeInteger(value);
}

function normalizeOptionalIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Date routeur invalide.");
  return date.toISOString();
}

function requireOrganizationMember(context, body) {
  const userId = requireText(body, "user_id", 128);
  const membership = statements.findOrganizationMembership.get(context.organization.id, userId);
  const user = membership ? statements.findOrganizationUserById.get(membership.user_id) : null;
  if (!membership || !user) {
    throw new HttpError(404, "Employé introuvable.");
  }
  return { membership, user };
}

function normalizeRouterAccess(body, appRole) {
  const requestedMode = String(body.router_access_mode ?? "selected");
  const mode = appRole === "admin" || requestedMode === "all" ? "all" : "selected";
  const routerIds = mode === "all"
    ? []
    : Array.from(new Set(
        (Array.isArray(body.router_ids) ? body.router_ids : [])
          .map((value) => String(value).trim())
          .filter(Boolean)
      )).slice(0, 10_000);
  if (routerIds.some((routerId) => routerId.length > 200)) {
    throw new HttpError(400, "Identifiant de routeur invalide.");
  }
  return { mode, routerIds };
}

function replaceOrganizationRouterAccess(membershipId, routerIds, createdAt = nowIso()) {
  statements.clearMembershipRouterAccess.run(membershipId);
  for (const routerId of routerIds) {
    statements.insertMembershipRouterAccess.run(membershipId, routerId, createdAt);
  }
}

function organizationTeamResponse(organizationId) {
  return statements.listOrganizationMemberships.all(organizationId).map((row) => organizationUserResponse(
    {
      id: row.user_id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      status: row.status,
      created_at: row.user_created_at,
      last_login_at: row.last_login_at
    },
    row
  ));
}

function adminResponse(admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    status: admin.status,
    must_change_password: Boolean(admin.must_change_password),
    created_at: admin.created_at,
    last_login_at: admin.last_login_at ?? null
  };
}

function requireAdmin(request, roles = ["owner", "admin", "support"], allowPasswordChange = false) {
  const token = bearerToken(request);
  if (MASTER_TOKEN && token && sameSecret(token, MASTER_TOKEN)) {
    return { id: null, email: "master-token", name: "Bootstrap", role: "owner", via_master: true };
  }
  const session = sessionActor(request, "admin");
  const admin = session ? statements.findAdminById.get(session.actor_id) : null;
  if (!admin || admin.status !== "active") throw new HttpError(401, "Session administrateur invalide.");
  if (!roles.includes(admin.role)) throw new HttpError(403, "Permission administrateur insuffisante.");
  if (admin.must_change_password && !allowPasswordChange) {
    throw new HttpError(428, "Le mot de passe initial doit être remplacé.");
  }
  return admin;
}

function requireMaster(request) {
  return requireAdmin(request, ["owner", "admin"]);
}

function resellerStatus(reseller) {
  if (reseller.status === "revoked") return "revoked";
  if (reseller.expires_at && Date.parse(reseller.expires_at) <= Date.now()) return "expired";
  return "active";
}

function requireReseller(request, allowPasswordChange = false) {
  const session = sessionActor(request, "reseller");
  let reseller = session ? statements.findResellerById.get(session.actor_id) : null;
  if (!reseller) {
    const token = bearerToken(request);
    reseller = token ? statements.findResellerByToken.get(hash(token)) : null;
  }
  if (!reseller) throw new HttpError(401, "Session revendeur invalide.");
  const status = resellerStatus(reseller);
  statements.touchReseller.run(nowIso(), status, reseller.id);
  if (status !== "active") {
    throw new HttpError(403, status === "expired"
      ? "Le compte revendeur a expiré. Les sous-licences déjà actives restent valides."
      : "Le compte revendeur a été révoqué.");
  }
  if (reseller.must_change_password && !allowPasswordChange && session) {
    throw new HttpError(428, "Le mot de passe initial doit être remplacé.");
  }
  return { ...reseller, status };
}

function resellerConsumedCapacity(resellerId) {
  return Number(statements.consumedResellerCapacity.get(resellerId).consumed);
}

function resellerResponse(reseller) {
  const consumed = resellerConsumedCapacity(reseller.id);
  return {
    id: reseller.id,
    plan_id: reseller.plan_id,
    email: reseller.email ?? null,
    name: reseller.name,
    status: resellerStatus(reseller),
    router_capacity: Number(reseller.router_capacity),
    router_consumed: consumed,
    router_reserved: consumed,
    router_available: Math.max(0, Number(reseller.router_capacity) - consumed),
    max_child_devices: Number(reseller.max_child_devices),
    max_child_duration_days: Number(reseller.max_child_duration_days),
    must_change_password: Boolean(reseller.must_change_password),
    issued_at: reseller.issued_at,
    expires_at: reseller.expires_at
  };
}

function createStandardLicenseFromPlan(plan, label, notes) {
  const plaintextKey = generateLicenseKey();
  const licenseId = crypto.randomUUID();
  statements.insertLicense.run(
    licenseId,
    hash(normalizeKey(plaintextKey)),
    plan.id,
    plan.code,
    plan.name,
    plan.description ?? "",
    Number(plan.duration_days),
    Number(plan.router_limit),
    Number(plan.max_devices),
    plan.price_cfa === null ? null : Number(plan.price_cfa),
    plan.billing_period ?? "custom",
    label ?? null,
    notes ?? null,
    nowIso(),
    "standard",
    null,
    null
  );
  return { license_id: licenseId, key: plaintextKey };
}

function paymentOrderResponse(order, includeLicenseKey = false) {
  const limitMode = deviceLimitMode(order);
  return {
    order_id: order.id,
    transaction_id: order.transaction_id,
    purchaser_type: order.purchaser_type,
    plan: {
      id: order.plan_id,
      code: order.plan_code,
      name: order.plan_name,
      router_limit: Number(order.router_limit),
      device_limit_mode: limitMode,
      max_devices: limitMode === "unlimited" ? null : Number(order.max_devices),
      duration_days: Number(order.duration_days),
      price_cfa: Number(order.amount)
    },
    amount: Number(order.amount),
    currency: order.currency,
    country: order.country,
    msisdn: order.msisdn.replace(/^227(\d{2})\d{4}(\d{2})$/, "227$1****$2"),
    payment_type: order.payment_type,
    status: order.status,
    fulfillment_status: order.fulfillment_status,
    provider_public_reference: order.provider_public_reference,
    license_id: order.license_id ?? null,
    ...(includeLicenseKey && order.license_key_encrypted
      ? { license_key: decryptSensitive(order.license_key_encrypted) }
      : {}),
    created_at: order.created_at,
    paid_at: order.paid_at,
    fulfilled_at: order.fulfilled_at,
    failure_reason: order.failure_reason
  };
}

function authorizePaymentOrder(request, body) {
  const order = statements.findPaymentOrderById.get(requireText(body, "order_id", 128));
  if (!order) throw new HttpError(404, "Commande introuvable.");
  const accessToken = String(body.order_token ?? "");
  if (accessToken && sameHash(accessToken, order.access_token_hash)) return order;
  const session = sessionActor(request, "reseller");
  if (session && order.reseller_id === session.actor_id) {
    requireReseller(request);
    return order;
  }
  throw new HttpError(401, "Accès à la commande refusé.");
}

function validateVerifiedIpayPayment(order, payment) {
  if (!payment || !["pending", "succeeded", "failed"].includes(payment.status)) {
    throw new HttpError(502, "Statut iPay invalide.");
  }
  if (String(payment.external_reference ?? "") !== order.transaction_id
    || String(payment.reference ?? "") !== String(order.provider_reference)
    || Number(payment.amount) !== Number(order.amount)
    || normalizeNigerMsisdn(payment.msisdn) !== order.msisdn) {
    throw new HttpError(409, "Les informations retournées par iPay ne correspondent pas à la commande.");
  }
}

function processVerifiedPayment(request, order, payment) {
  validateVerifiedIpayPayment(order, payment);
  const checkedAt = nowIso();
  if (payment.status !== "succeeded") {
    statements.markPaymentChecked.run(
      payment.status,
      checkedAt,
      checkedAt,
      payment.status === "failed" ? "Paiement refusé ou échoué chez iPay." : null,
      order.id
    );
    return statements.findPaymentOrderById.get(order.id);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const current = statements.findPaymentOrderById.get(order.id);
    if (current.fulfillment_status === "fulfilled") {
      db.exec("COMMIT");
      return current;
    }
    if (current.status === "cancelled") {
      statements.markLatePayment.run(
        checkedAt,
        checkedAt,
        checkedAt,
        "Paiement reçu après abandon de la tentative. Réconciliation administrateur requise.",
        current.id
      );
      db.exec("COMMIT");
      logEvent(request, null, "payment_received_after_abandon", null, null, {
        order_id: current.id,
        transaction_id: current.transaction_id
      });
      return statements.findPaymentOrderById.get(current.id);
    }
    if (current.purchaser_type === "organization") {
      if (current.organization_id) {
        const existing = statements.findActiveOrganizationSubscription.get(
          current.organization_id
        );
        const replacingTrial = existing?.plan_code === SAAS_TRIAL_PLAN_CODE;
        const startsAtMs = existing
          && !replacingTrial
          && Date.parse(existing.current_period_end) > Date.now()
            ? Date.parse(existing.current_period_end)
            : Date.now();
        if (existing) {
          statements.expireOrganizationSubscriptionById.run(checkedAt, existing.id);
        }
        const startsAt = new Date(startsAtMs).toISOString();
        const endsAt = new Date(
          startsAtMs + Number(current.duration_days) * 86_400_000
        ).toISOString();
        statements.insertOrganizationSubscription.run(
          crypto.randomUUID(),
          current.organization_id,
          current.plan_id,
          current.plan_code,
          current.plan_name,
          Number(current.router_limit),
          Number(current.max_devices),
          deviceLimitMode(current),
          Number(current.amount),
          startsAt,
          endsAt,
          current.id,
          checkedAt,
          checkedAt
        );
        statements.activateOrganization.run(checkedAt, current.organization_id);
        statements.fulfillSaasPayment.run(
          checkedAt,
          checkedAt,
          checkedAt,
          checkedAt,
          current.id
        );
      } else {
        const planSnapshot = {
          id: current.plan_id,
          code: current.plan_code,
          name: current.plan_name,
          description: "Licence achetée dans TicketPro.",
          router_limit: Number(current.router_limit),
          max_devices: Number(current.max_devices),
          duration_days: Number(current.duration_days),
          price_cfa: Number(current.amount),
          billing_period: "custom"
        };
        const license = createStandardLicenseFromPlan(
          planSnapshot,
          current.customer_name,
          `Paiement iPay ${current.transaction_id}`
        );
        statements.fulfillOrganizationPayment.run(
          license.license_id,
          encryptSensitive(license.key),
          checkedAt,
          checkedAt,
          checkedAt,
          checkedAt,
          current.id
        );
      }
    } else {
      let reseller = current.reseller_id ? statements.findResellerById.get(current.reseller_id) : null;
      if (!reseller && current.reseller_registration_id) {
        const registration = statements.findResellerRegistrationById.get(current.reseller_registration_id);
        if (!registration || registration.status !== "pending") {
          throw new Error("Inscription revendeur introuvable pendant l'activation.");
        }
        if (statements.findResellerByEmail.get(registration.email)) {
          throw new Error("Un compte revendeur utilise déjà cet email.");
        }
        const resellerId = crypto.randomUUID();
        const legacyToken = randomToken(40);
        statements.insertReseller.run(
          resellerId,
          current.plan_id,
          registration.name,
          registration.email,
          registration.password_hash,
          hash(legacyToken),
          Number(current.router_limit),
          Number(current.max_devices),
          Number(current.duration_days),
          checkedAt,
          null,
          checkedAt,
          checkedAt,
          "Compte créé automatiquement après paiement iPay."
        );
        statements.updateResellerPassword.run(registration.password_hash, 0, checkedAt, resellerId);
        statements.completeResellerRegistration.run(resellerId, checkedAt, registration.id);
        statements.linkPaymentOrderReseller.run(resellerId, checkedAt, current.id);
        reseller = statements.findResellerById.get(resellerId);
      } else if (reseller) {
        statements.topUpReseller.run(
          null,
          Number(current.router_limit),
          Math.max(Number(reseller.max_child_devices), Number(current.max_devices)),
          Math.max(Number(reseller.max_child_duration_days), Number(current.duration_days)),
          checkedAt,
          reseller.id
        );
      }
      if (!reseller) throw new Error("Compte revendeur introuvable pendant la recharge.");
      statements.fulfillResellerPayment.run(
        checkedAt,
        checkedAt,
        checkedAt,
        checkedAt,
        current.id
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    statements.failPaymentFulfillment.run(
      String(error.message ?? "Échec de livraison.").slice(0, 500),
      checkedAt,
      checkedAt,
      order.id
    );
    throw error;
  }

  const fulfilled = statements.findPaymentOrderById.get(order.id);
  logEvent(request, fulfilled.license_id, "payment_fulfilled", null, null, {
    order_id: fulfilled.id,
    transaction_id: fulfilled.transaction_id,
    purchaser_type: fulfilled.purchaser_type,
    reseller_id: fulfilled.reseller_id
  });
  return fulfilled;
}

function requireText(body, field, max = 256) {
  const value = String(body?.[field] ?? "").trim();
  if (!value || value.length > max) throw new HttpError(400, `Champ ${field} invalide.`);
  return value;
}

function requireInteger(body, field, minimum, maximum) {
  const value = Number(body?.[field]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `Champ ${field} invalide.`);
  }
  return value;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Payload trop volumineux.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON invalide.");
  }
}

class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const NO_CONTENT = Symbol("NO_CONTENT");

function route(method, pathname, handler) {
  return async (request, response) => {
    if (request.method !== method || request.url.split("?")[0] !== pathname) return false;
    try {
      const body = method === "GET" ? {} : await readJson(request);
      const payload = await handler(request, body);
      if (payload === NO_CONTENT) {
        response.writeHead(204, {
          "cache-control": "no-store",
          "access-control-allow-origin": allowedCorsOrigin(request)
        });
        response.end();
      } else {
        sendJson(response, 200, payload, request);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(response, status, {
        error: error.message ?? "Erreur interne.",
        ...(error.details ? { details: error.details } : {})
      }, request);
      if (status === 500) console.error(error);
    }
    return true;
  };
}

function parseSemver(value, fieldName) {
  const match = String(value ?? "").trim().match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) throw new HttpError(400, `${fieldName} n'est pas une version SemVer valide.`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue, "version");
  const right = parseSemver(rightValue, "version");
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function readAppUpdateManifest() {
  let raw;
  try {
    const stats = fs.statSync(APP_UPDATE_MANIFEST_PATH);
    if (!stats.isFile() || stats.size > 1024 * 1024) {
      throw new Error("Le manifeste de mise à jour est invalide.");
    }
    raw = fs.readFileSync(APP_UPDATE_MANIFEST_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const manifest = JSON.parse(raw);
  parseSemver(manifest.version, "version publiée");
  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    throw new Error("Le manifeste de mise à jour ne contient aucune plateforme.");
  }
  return manifest;
}

function sendJson(response, status, payload, request) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": allowedCorsOrigin(request)
  });
  response.end(JSON.stringify(payload));
}

function allowedCorsOrigin(request) {
  const configured = String(process.env.LICENSE_CORS_ORIGIN ?? "http://tauri.localhost")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = String(request?.headers?.origin ?? "");
  if (!origin) return configured[0] ?? "null";
  return configured.includes("*") || configured.includes(origin) ? origin : "null";
}

function recordFailedLogin(actorType, actor) {
  const failedCount = Number(actor.failed_login_count ?? 0) + 1;
  const lockedUntil = failedCount >= 5
    ? new Date(Date.now() + 15 * 60_000).toISOString()
    : null;
  const statement = actorType === "admin"
    ? statements.adminLoginFailed
    : actorType === "organization"
      ? statements.organizationLoginFailed
      : statements.resellerLoginFailed;
  statement.run(failedCount, lockedUntil, nowIso(), actor.id);
}

function assertLoginAllowed(actor) {
  if (actor.locked_until && Date.parse(actor.locked_until) > Date.now()) {
    throw new HttpError(429, "Compte temporairement verrouillé après plusieurs échecs.");
  }
}

function seedDefaultAdmins() {
  const defaultPassword = process.env.LICENSE_DEFAULT_ADMIN_PASSWORD ?? "admin123";
  const createdAt = nowIso();
  [
    ["alitimbo.pro11@gmail.com", "Cofondateur Alitimbo"],
    ["maitredoudos54@gmail.com", "Cofondateur Maitredoudos"]
  ].forEach(([email, name]) => {
    if (!statements.findAdminByEmail.get(email)) {
      statements.insertAdmin.run(
        crypto.randomUUID(),
        email,
        name,
        hashPassword(defaultPassword),
        "owner",
        1,
        createdAt,
        createdAt
      );
    }
  });
}

function createPasswordReset(actorType, actorId, createdByAdminId) {
  const token = randomToken(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  statements.insertPasswordReset.run(
    crypto.randomUUID(),
    actorType,
    actorId,
    hash(token),
    expiresAt,
    createdAt,
    createdByAdminId ?? null
  );
  return { reset_token: token, expires_at: expiresAt };
}

function generateTemporaryPassword() {
  return `Tp!9aA${randomToken(12)}`;
}

async function deliverOrganizationPasswordReset(user, resetToken, expiresAt) {
  const transporter = getSmtpTransporter();
  if (!transporter) return false;
  const resetUrl = `${SAAS_PASSWORD_RESET_URL}?token=${encodeURIComponent(resetToken)}`;
  const safeName = escapeHtml(user.name);
  const safeResetUrl = escapeHtml(resetUrl);
  const expiresLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Niamey"
  }).format(new Date(expiresAt));
  await transporter.sendMail({
    from: { name: SMTP_FROM_NAME, address: SMTP_FROM_EMAIL },
    to: user.email,
    subject: "Réinitialisez votre mot de passe TicketPro",
    text: [
      `Bonjour ${user.name},`,
      "",
      "Une demande de réinitialisation a été reçue pour votre compte TicketPro.",
      `Ouvrez ce lien : ${resetUrl}`,
      `Ce lien expire le ${expiresLabel}.`,
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#18202a">
        <h1 style="font-size:24px">Réinitialisation TicketPro</h1>
        <p>Bonjour ${safeName},</p>
        <p>Une demande de réinitialisation a été reçue pour votre compte TicketPro.</p>
        <p style="margin:28px 0">
          <a href="${safeResetUrl}" style="background:#0b6bcb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">
            Choisir un nouveau mot de passe
          </a>
        </p>
        <p>Ce lien expire le ${escapeHtml(expiresLabel)}.</p>
        <p style="color:#5f6b76">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>
    `,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return true;
}

async function deliverOrganizationInvitation(user, organization, invitationToken, expiresAt, requiresPassword) {
  const transporter = getSmtpTransporter();
  if (!transporter) return false;
  const invitationUrl = `${SAAS_INVITATION_URL}?token=${encodeURIComponent(invitationToken)}`;
  const expiresLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Niamey"
  }).format(new Date(expiresAt));
  const action = requiresPassword
    ? "Accepter et créer mon mot de passe"
    : "Accepter l'invitation";
  await transporter.sendMail({
    from: { name: SMTP_FROM_NAME, address: SMTP_FROM_EMAIL },
    to: user.email,
    subject: `${organization.name} vous invite sur TicketPro`,
    text: [
      `Bonjour ${user.name},`,
      "",
      `${organization.name} vous invite à rejoindre son espace TicketPro.`,
      requiresPassword
        ? "Vous créerez votre mot de passe personnel après avoir ouvert le lien."
        : "Votre mot de passe TicketPro actuel reste inchangé.",
      `${action} : ${invitationUrl}`,
      `Cette invitation expire le ${expiresLabel}.`
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#18202a">
        <h1 style="font-size:24px">Invitation TicketPro</h1>
        <p>Bonjour ${escapeHtml(user.name)},</p>
        <p><strong>${escapeHtml(organization.name)}</strong> vous invite à rejoindre son espace TicketPro.</p>
        <p>${requiresPassword
          ? "Vous créerez votre mot de passe personnel après avoir ouvert ce lien."
          : "Votre mot de passe TicketPro actuel reste inchangé."}</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(invitationUrl)}" style="background:#0b6bcb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">
            ${action}
          </a>
        </p>
        <p>Cette invitation expire le ${escapeHtml(expiresLabel)}.</p>
      </div>
    `,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return true;
}

async function processSubscriptionNotifications() {
  const transporter = getSmtpTransporter();
  if (!transporter) return { sent: 0, skipped: "smtp_not_configured" };

  const timestamp = nowIso();
  const paidExpirationThreshold = new Date(Date.now() - SAAS_PAID_GRACE_DAYS * DAY_MS).toISOString();
  statements.expireDueOrganizationSubscriptions.run(
    timestamp,
    SAAS_TRIAL_PLAN_ID,
    timestamp,
    SAAS_TRIAL_PLAN_ID,
    paidExpirationThreshold
  );

  let sent = 0;
  for (const subscription of statements.listActiveOrganizationSubscriptions.all(
    SAAS_TRIAL_PLAN_ID
  )) {
    const event = subscriptionNotificationEvent({
      graceDays: SAAS_PAID_GRACE_DAYS,
      hasPaidSubscription: Boolean(
        statements.hasPaidOrganizationSubscription.get(
          subscription.organization_id,
          SAAS_TRIAL_PLAN_ID
        )
      ),
      nowMs: Date.now(),
      subscription,
      trialPlanCode: SAAS_TRIAL_PLAN_CODE,
      trialPlanId: SAAS_TRIAL_PLAN_ID
    });
    if (!event) continue;
    const recipients = statements.listOrganizationOwnerRecipients.all(
      subscription.organization_id
    );
    for (const recipient of recipients) {
      const claimed = statements.claimSubscriptionNotification.run(
        subscription.id,
        event.eventKey,
        recipient.email,
        timestamp
      );
      if (Number(claimed.changes) !== 1) continue;
      try {
        await deliverSubscriptionNotification(
          transporter,
          recipient,
          subscription,
          event
        );
        statements.markSubscriptionNotificationSent.run(
          nowIso(),
          subscription.id,
          event.eventKey,
          recipient.email
        );
        sent += 1;
      } catch (error) {
        statements.releaseSubscriptionNotification.run(
          subscription.id,
          event.eventKey,
          recipient.email
        );
        console.error(
          `Impossible d'envoyer la relance ${event.eventKey} à ${recipient.email}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }
  return { sent };
}

async function deliverSubscriptionNotification(
  transporter,
  recipient,
  subscription,
  event
) {
  const isGrace = event.kind === "paid_grace";
  const isTrialEnded = event.kind === "trial_ended";
  const endLabel = formatEmailDate(subscription.current_period_end);
  const graceEnd = new Date(
    Date.parse(subscription.current_period_end) + SAAS_PAID_GRACE_DAYS * DAY_MS
  ).toISOString();
  const graceEndLabel = formatEmailDate(graceEnd);
  const title = isGrace
    ? event.remainingDays === 1
      ? "Dernier jour avant la suspension de vos services"
      : `${event.remainingDays} jours avant la suspension de vos services`
    : isTrialEnded
      ? "Votre essai TicketPro est terminé"
      : event.remainingDays === 1
        ? "Votre essai se termine demain"
        : "Plus que 3 jours pour profiter de TicketPro";
  const subject = isGrace
    ? `[Action requise] ${title}`
    : title;
  const message = isGrace
    ? `Votre abonnement ${subscription.plan_name} a pris fin le ${endLabel}. TicketPro maintient exceptionnellement vos services jusqu'au ${graceEndLabel}.`
    : isTrialEnded
      ? "Votre période d'essai est terminée depuis deux jours. Choisissez un forfait pour réactiver vos routeurs et vos services TicketPro."
      : `Votre essai gratuit se termine le ${endLabel}. Vos données restent conservées, mais les services seront suspendus à cette date sans abonnement.`;
  const safeUrl = escapeHtml(SAAS_SUBSCRIPTION_URL);
  const safeName = escapeHtml(recipient.name);
  const safeOrganization = escapeHtml(subscription.organization_name);
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  await transporter.sendMail({
    from: { name: SMTP_FROM_NAME, address: SMTP_FROM_EMAIL },
    to: recipient.email,
    subject,
    text: [
      `Bonjour ${recipient.name},`,
      "",
      message,
      `Organisation : ${subscription.organization_name}`,
      `Forfait : ${subscription.plan_name}`,
      "",
      `Choisir ou renouveler un forfait : ${SAAS_SUBSCRIPTION_URL}`,
      "",
      "L'équipe TicketPro"
    ].join("\n"),
    html: `
      <div style="margin:0;background:#f3f6fa;padding:32px 12px;font-family:Arial,sans-serif;color:#172033">
        <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 36px rgba(23,32,51,.10)">
          <div style="background:linear-gradient(135deg,#075985,#0ea5e9);padding:28px 32px;color:#ffffff">
            <div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">TicketPro</div>
            <h1 style="font-size:26px;line-height:1.25;margin:12px 0 0">${safeTitle}</h1>
          </div>
          <div style="padding:30px 32px">
            <p style="font-size:16px;margin-top:0">Bonjour ${safeName},</p>
            <p style="font-size:16px;line-height:1.65">${safeMessage}</p>
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:16px 18px;margin:24px 0">
              <div style="color:#475569;font-size:13px">Organisation</div>
              <strong>${safeOrganization}</strong>
              <div style="color:#475569;font-size:13px;margin-top:10px">Forfait</div>
              <strong>${escapeHtml(subscription.plan_name)}</strong>
            </div>
            <p style="margin:28px 0">
              <a href="${safeUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:700">
                ${isGrace ? "Renouveler mon abonnement" : "Choisir mon forfait"}
              </a>
            </p>
            <p style="color:#64748b;font-size:13px;line-height:1.5">
              Ce message est envoyé uniquement au propriétaire de l'organisation. Aucun mot de passe ne vous sera demandé par email.
            </p>
          </div>
        </div>
      </div>
    `,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

function formatEmailDate(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: "Africa/Niamey"
  }).format(new Date(value));
}

function smtpConfigured() {
  return Boolean(
    SMTP_HOST
    && Number.isInteger(SMTP_PORT)
    && SMTP_PORT > 0
    && SMTP_USER
    && SMTP_PASSWORD
    && SMTP_FROM_EMAIL
  );
}

function getSmtpTransporter() {
  if (!smtpConfigured()) return null;
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      requireTLS: !SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD
      },
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return smtpTransporter;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function createIpayOrder(
  request,
  body,
  purchaserType,
  reseller = null,
  registration = null,
  organizationRegistration = null
) {
  if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
  const plan = statements.findPlanById.get(requireText(body, "plan_id", 128));
  if (!plan || !Boolean(plan.is_active)) throw new HttpError(404, "Forfait introuvable ou inactif.");
  if (purchaserType === "organization" && Boolean(plan.is_reseller)) {
    throw new HttpError(400, "Une organisation ne peut pas acheter un pack revendeur.");
  }
  if (purchaserType === "organization" && plan.purchase_mode === "contact") {
    throw new HttpError(409, "Ce forfait est disponible uniquement sur devis.", {
      code: "PLAN_CONTACT_REQUIRED"
    });
  }
  if (purchaserType === "reseller") {
    if (!Boolean(plan.is_reseller)) throw new HttpError(400, "Un pack revendeur est requis.");
    if (reseller && reseller.plan_id !== plan.id) {
      throw new HttpError(409, "Le revendeur doit recharger avec son pack actuel.");
    }
    if (!reseller && (!registration || registration.plan_id !== plan.id)) {
      throw new HttpError(409, "Inscription revendeur invalide.");
    }
  }
  const amount = Number(plan.price_cfa);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(409, "Ce forfait ne possède pas de prix payable en ligne.");
  }
  const orderId = crypto.randomUUID();
  const transactionId = `TP-${purchaserType === "organization" ? "ORG" : "RES"}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const orderToken = randomToken(40);
  const createdAt = nowIso();
  statements.insertPaymentOrder.run(
    orderId,
    transactionId,
    purchaserType,
    reseller?.id ?? null,
    registration?.id ?? null,
    organizationRegistration?.organization_id ?? null,
    organizationRegistration?.user_id ?? null,
    plan.id,
    plan.code,
    plan.name,
    Number(plan.router_limit),
    Number(plan.max_devices),
    deviceLimitMode(plan),
    Number(plan.duration_days),
    amount,
    normalizeNigerMsisdn(body.msisdn),
    purchaserType === "reseller"
      ? reseller?.name ?? registration.name
      : organizationRegistration?.organization_name ?? requireText(body, "customer_name", 200),
    requirePaymentType(body),
    hash(orderToken),
    createdAt,
    createdAt
  );
  const order = statements.findPaymentOrderById.get(orderId);
  if (registration) statements.linkResellerRegistrationOrder.run(orderId, registration.id);
  const provider = await initiateIpayPayment(order);
  statements.setPaymentProviderReferences.run(
    provider.reference,
    provider.public_reference,
    nowIso(),
    orderId
  );
  logEvent(request, null, "payment_initiated", null, null, {
    order_id: orderId,
    transaction_id: transactionId,
    purchaser_type: purchaserType,
    reseller_id: reseller?.id ?? null
  });
  return {
    order: paymentOrderResponse(statements.findPaymentOrderById.get(orderId)),
    order_token: orderToken,
    payment: {
      reference: provider.reference,
      public_reference: provider.public_reference,
      meta_data: provider.meta_data ?? null
    }
  };
}

seedDefaultAdmins();

const handlers = [
  route("GET", "/health", async () => {
    db.prepare("SELECT 1").get();
    return {
      ok: true,
      service: "ticketpro-license-api",
      database: "ok",
      email: smtpConfigured() ? "configured" : "not_configured",
      time: nowIso()
    };
  }),
  route("GET", "/v1/app-updates/check", async (request) => {
    const searchParams = new URL(request.url, "http://ticketpro.local").searchParams;
    const target = String(searchParams.get("target") ?? "").trim().toLowerCase();
    const arch = String(searchParams.get("arch") ?? "").trim().toLowerCase();
    const currentVersion = String(searchParams.get("current_version") ?? "").trim();
    if (!/^[a-z0-9_.-]{2,80}$/.test(target) || !/^[a-z0-9_.-]{2,40}$/.test(arch)) {
      throw new HttpError(400, "Plateforme de mise à jour invalide.");
    }
    parseSemver(currentVersion, "version installée");

    const manifest = readAppUpdateManifest();
    if (!manifest || compareSemver(manifest.version, currentVersion) <= 0) {
      return NO_CONTENT;
    }

    const normalizedTarget = target.includes("windows")
      ? "windows"
      : target.includes("darwin") || target.includes("macos")
        ? "darwin"
        : target.includes("linux")
          ? "linux"
          : target;
    const platform = [
      `${target}-${arch}`,
      `${normalizedTarget}-${arch}`,
      target,
      normalizedTarget
    ].map((key) => manifest.platforms[key]).find(Boolean);
    if (!platform) return NO_CONTENT;

    const downloadUrl = String(platform.url ?? "");
    const signature = String(platform.signature ?? "").trim();
    if (!downloadUrl.startsWith("https://") || signature.length < 40) {
      throw new Error("L'artefact de mise à jour publié est incomplet ou non sécurisé.");
    }

    return {
      version: manifest.version,
      url: downloadUrl,
      signature,
      notes: String(manifest.notes ?? ""),
      ...(manifest.pub_date ? { pub_date: manifest.pub_date } : {})
    };
  }),
  route("GET", "/v1/plans", async () => ({ plans: statements.listPlans.all().map(planResponse) })),
  route("GET", "/v1/plans/catalog", async () => ({
    plans: statements.listPublicCatalogPlans.all().map((plan) => ({
      ...planResponse(plan),
      sort_order: Number(plan.sort_order)
    }))
  })),

  route("POST", "/v1/saas/register-trial", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const email = requireEmail(body);
    const password = requireCustomerPassword(body);
    if (password !== String(body.confirm_password ?? "")) {
      throw new HttpError(400, "Les mots de passe ne correspondent pas.");
    }
    const organizationName = requireText(body, "organization_name", 200);
    const ownerName = requireText(body, "name", 200);
    const phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
    const existingUser = statements.findOrganizationUserByEmail.get(email);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + SAAS_TRIAL_DAYS * 86_400_000).toISOString();
    let organizationId;
    let userId;

    if (existingUser) {
      const existingOrganization = statements.findOrganizationById.get(existingUser.organization_id);
      if (!existingOrganization || existingOrganization.status !== "pending_payment") {
        throw new HttpError(409, "Un compte existe déjà avec cet email. Connectez-vous.");
      }
      if (!verifyPassword(password, existingUser.password_hash)) {
        throw new HttpError(409, "Une inscription inachevée existe déjà avec cet email.");
      }
      if (statements.findLatestOrganizationSubscription.get(existingOrganization.id)) {
        throw new HttpError(409, "L'essai gratuit a déjà été utilisé pour ce compte.");
      }
      organizationId = existingOrganization.id;
      userId = existingUser.id;
    } else {
      organizationId = crypto.randomUUID();
      userId = crypto.randomUUID();
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      if (!existingUser) {
        statements.insertOrganization.run(
          organizationId,
          organizationName,
          createdAt,
          createdAt
        );
        statements.insertOrganizationUser.run(
          userId,
          organizationId,
          email,
          ownerName,
          phone,
          hashPassword(password),
          createdAt,
          createdAt
        );
        createOwnerMembership(organizationId, userId, createdAt);
      }
      statements.insertOrganizationSubscription.run(
        crypto.randomUUID(),
        organizationId,
        SAAS_TRIAL_PLAN_ID,
        SAAS_TRIAL_PLAN_CODE,
        "Essai gratuit 7 jours",
        SAAS_TRIAL_ROUTER_LIMIT,
        1,
        "limited",
        0,
        createdAt,
        expiresAt,
        `trial:${organizationId}`,
        createdAt,
        createdAt
      );
      statements.activateOrganization.run(createdAt, organizationId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) {
        throw new HttpError(409, "L'essai gratuit a déjà été utilisé pour ce compte.");
      }
      throw error;
    }

    const user = statements.findOrganizationUserById.get(userId);
    const membership = statements.findOrganizationMembership.get(organizationId, userId);
    const session = createOrganizationSession(request, userId, membership.id);
    logEvent(request, null, "saas_trial_started", organizationId, null, {
      organization_user_id: userId,
      duration_days: SAAS_TRIAL_DAYS,
      router_limit: SAAS_TRIAL_ROUTER_LIMIT
    });
    return organizationAuthResponse(user, session, membership);
  }),

  route("POST", "/v1/saas/register-and-pay", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const email = requireEmail(body);
    const password = requireCustomerPassword(body);
    if (password !== String(body.confirm_password ?? "")) {
      throw new HttpError(400, "Les mots de passe ne correspondent pas.");
    }
    const organizationName = requireText(body, "organization_name", 200);
    const ownerName = requireText(body, "name", 200);
    const phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
    const existingUser = statements.findOrganizationUserByEmail.get(email);
    let organizationId;
    let userId;

    if (existingUser) {
      const existingOrganization = statements.findOrganizationById.get(existingUser.organization_id);
      if (!existingOrganization || existingOrganization.status !== "pending_payment") {
        throw new HttpError(409, "Un compte existe déjà avec cet email. Connectez-vous.");
      }
      if (!verifyPassword(password, existingUser.password_hash)) {
        throw new HttpError(409, "Une inscription inachevée existe déjà avec cet email.");
      }
      organizationId = existingOrganization.id;
      userId = existingUser.id;
    } else {
      organizationId = crypto.randomUUID();
      userId = crypto.randomUUID();
      const createdAt = nowIso();
      db.exec("BEGIN IMMEDIATE");
      try {
        statements.insertOrganization.run(
          organizationId,
          organizationName,
          createdAt,
          createdAt
        );
        statements.insertOrganizationUser.run(
          userId,
          organizationId,
          email,
          ownerName,
          phone,
          hashPassword(password),
          createdAt,
          createdAt
        );
        createOwnerMembership(organizationId, userId, createdAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error.message).includes("UNIQUE")) {
          throw new HttpError(409, "Un compte existe déjà avec cet email.");
        }
        throw error;
      }
    }

    const result = await createIpayOrder(
      request,
      body,
      "organization",
      null,
      null,
      {
        organization_id: organizationId,
        user_id: userId,
        organization_name: organizationName
      }
    );
    return {
      ...result,
      registration: {
        organization_id: organizationId,
        email,
        next_step: "confirm_payment"
      }
    };
  }),

  route("POST", "/v1/saas/migrate-license", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const { license } = requireLicensedDevice(body);
    if (!license.expires_at || Date.parse(license.expires_at) <= Date.now()) {
      throw new HttpError(402, "Cette ancienne licence a expiré. Créez un abonnement SaaS.");
    }
    const email = requireEmail(body);
    if (statements.findOrganizationUserByEmail.get(email)) {
      throw new HttpError(409, "Un compte SaaS existe déjà avec cet email. Connectez-vous.");
    }
    const password = requireCustomerPassword(body);
    if (password !== String(body.confirm_password ?? "")) {
      throw new HttpError(400, "Les mots de passe ne correspondent pas.");
    }
    const organizationName = requireText(body, "organization_name", 200);
    const ownerName = requireText(body, "name", 200);
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const createdAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.insertOrganization.run(
        organizationId,
        organizationName,
        createdAt,
        createdAt
      );
      statements.insertOrganizationUser.run(
        userId,
        organizationId,
        email,
        ownerName,
        body.phone ? String(body.phone).trim().slice(0, 40) : null,
        hashPassword(password),
        createdAt,
        createdAt
      );
      createOwnerMembership(organizationId, userId, createdAt);
      statements.insertOrganizationSubscription.run(
        crypto.randomUUID(),
        organizationId,
        license.plan_id ?? `legacy-${license.id}`,
        license.plan_code ?? "LEGACY",
        license.plan_name ?? "Abonnement migré",
        Number(license.router_limit),
        Number(license.max_devices ?? 1),
        Number(license.max_devices ?? 1) >= 100_000 ? "unlimited" : "limited",
        Number(license.price_cfa ?? 0),
        license.activated_at ?? createdAt,
        license.expires_at,
        `legacy-license:${license.id}`,
        createdAt,
        createdAt
      );
      statements.activateOrganization.run(createdAt, organizationId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) {
        throw new HttpError(409, "Cette licence ou cet email a déjà été migré.");
      }
      throw error;
    }
    const user = statements.findOrganizationUserById.get(userId);
    const membership = statements.findOrganizationMembership.get(organizationId, userId);
    const session = createOrganizationSession(request, userId, membership.id);
    logEvent(request, license.id, "license_migrated_to_saas", organizationId, null, {
      organization_user_id: userId
    });
    return organizationAuthResponse(user, session, membership);
  }),

  route("POST", "/v1/saas/registration/complete", async (request, body) => {
    const order = authorizePaymentOrder(request, body);
    if (!order.organization_id || !order.organization_user_id) {
      throw new HttpError(400, "Cette commande ne correspond pas à une inscription SaaS.");
    }
    if (order.status !== "succeeded" || order.fulfillment_status !== "fulfilled") {
      throw new HttpError(409, "Le paiement n'est pas encore confirmé.");
    }
    const user = statements.findOrganizationUserById.get(order.organization_user_id);
    if (!user || user.organization_id !== order.organization_id) {
      throw new HttpError(409, "Le compte lié au paiement est introuvable.");
    }
    const membership = statements.findOrganizationMembership.get(order.organization_id, user.id);
    if (!membership) {
      throw new HttpError(409, "L'appartenance liée au paiement est introuvable.");
    }
    const session = createOrganizationSession(request, user.id, membership.id);
    return organizationAuthResponse(user, session, membership);
  }),

  route("POST", "/v1/saas/auth/login", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const email = requireEmail(body);
    const password = requirePasswordInput(body);
    const user = statements.findOrganizationUserByEmail.get(email);
    if (!user) throw new HttpError(401, "Email ou mot de passe incorrect.");
    assertLoginAllowed(user);
    if (!verifyPassword(password, user.password_hash)) {
      recordFailedLogin("organization", user);
      throw new HttpError(401, "Email ou mot de passe incorrect.");
    }
    if (user.status !== "active") throw new HttpError(403, "Ce compte est désactivé.");
    const memberships = statements.listAcceptedMembershipsByUser.all(user.id);
    const selectedMembership = memberships.find((item) => item.organization_status === "active")
      ?? memberships[0];
    if (!selectedMembership || selectedMembership.organization_status === "pending_payment") {
      throw new HttpError(
        403,
        "Cette inscription n'est pas terminée. Reprenez l'inscription pour choisir l'essai gratuit ou payer un forfait."
      );
    }
    const loggedAt = nowIso();
    statements.organizationLoginSucceeded.run(loggedAt, loggedAt, user.id);
    const session = createOrganizationSession(request, user.id, selectedMembership.id);
    return organizationAuthResponse(
      statements.findOrganizationUserById.get(user.id),
      session,
      selectedMembership,
      memberships.length > 1
    );
  }),

  route("GET", "/v1/saas/auth/me", async (request) => {
    const { session, user, membership } = requireOrganizationUser(request);
    return organizationAuthResponse(user, session, membership);
  }),

  route("POST", "/v1/saas/account/profile", async (request, body) => {
    const { user, membership, organization } = requireOrganizationUser(request);
    const name = requireText(body, "name", 200);
    const phone = normalizeInternationalContactPhone(body.phone);
    const updatedAt = nowIso();
    statements.updateOrganizationUserProfile.run(name, phone, updatedAt, user.id);
    const updatedUser = statements.findOrganizationUserById.get(user.id);
    logEvent(request, null, "organization_profile_updated", organization.id, null, {
      organization_user_id: user.id
    });
    return { user: organizationUserResponse(updatedUser, membership) };
  }),

  route("POST", "/v1/saas/auth/switch-organization", async (request, body) => {
    const session = organizationSession(request);
    const user = session ? statements.findOrganizationUserById.get(session.user_id) : null;
    if (!session || !user || user.status !== "active") {
      throw new HttpError(401, "Session TicketPro invalide.");
    }
    const membershipId = requireText(body, "membership_id", 128);
    const membership = statements.findOrganizationMembershipById.get(membershipId);
    if (!membership || membership.user_id !== user.id || membership.status !== "active"
      || membership.invitation_status !== "accepted") {
      throw new HttpError(403, "Cette organisation n'est pas accessible.");
    }
    const switchedAt = nowIso();
    const nextSession = createOrganizationSession(request, user.id, membership.id);
    statements.revokeOrganizationSession.run(switchedAt, session.id);
    return organizationAuthResponse(
      user,
      nextSession,
      membership
    );
  }),

  route("GET", "/v1/saas/team", async (request) => {
    const { organization } = requireTeamManager(request);
    return { members: organizationTeamResponse(organization.id) };
  }),

  route("POST", "/v1/saas/team/members", async (request, body) => {
    const context = requireTeamManager(request);
    const email = requireEmail(body);
    const name = requireText(body, "name", 200);
    const appRole = normalizeOrganizationAppRole(body.app_role);
    if (appRole === "admin" && context.membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut créer un administrateur.");
    }
    const access = normalizeRouterAccess(body, appRole);
    const createdAt = nowIso();
    const existingUser = statements.findOrganizationUserByEmail.get(email);
    const userId = existingUser?.id ?? crypto.randomUUID();
    const requiresPassword = !existingUser
      || (!existingUser.last_login_at && Boolean(existingUser.invitation_pending));
    if (statements.findOrganizationMembership.get(context.organization.id, userId)) {
      throw new HttpError(409, "Cette personne est déjà membre ou invitée dans cette organisation.");
    }
    const membershipId = crypto.randomUUID();
    const invitationToken = randomToken(32);
    const invitationExpiresAt = new Date(
      Date.now() + SAAS_INVITATION_TTL_HOURS * 3_600_000
    ).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!existingUser) {
        statements.insertOrganizationMember.run(
          userId,
          context.organization.id,
          email,
          name,
          body.phone ? String(body.phone).trim().slice(0, 40) : null,
          hashPassword(generateTemporaryPassword()),
          appRole,
          access.mode,
          context.user.id,
          createdAt,
          createdAt
        );
      }
      statements.insertOrganizationMembership.run(
        membershipId,
        context.organization.id,
        userId,
        "member",
        appRole,
        access.mode,
        "pending",
        context.user.id,
        createdAt,
        createdAt,
        null
      );
      replaceOrganizationRouterAccess(membershipId, access.routerIds, createdAt);
      statements.insertOrganizationInvitationToken.run(
        crypto.randomUUID(),
        membershipId,
        hash(invitationToken),
        requiresPassword ? 1 : 0,
        invitationExpiresAt,
        createdAt
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) {
        throw new HttpError(409, "Cette personne est déjà membre ou invitée dans cette organisation.");
      }
      throw error;
    }
    const member = statements.findOrganizationUserById.get(userId);
    const membership = statements.findOrganizationMembershipById.get(membershipId);
    let invitationDelivered = false;
    try {
      invitationDelivered = await deliverOrganizationInvitation(
        member,
        context.organization,
        invitationToken,
        invitationExpiresAt,
        requiresPassword
      );
    } catch (error) {
      console.error("Impossible d'envoyer l'invitation employé:", error.message);
    }
    logEvent(request, null, "organization_member_invited", context.organization.id, null, {
      member_id: userId,
      app_role: appRole,
      invitation_delivery: invitationDelivered ? "sent" : "not_sent",
      router_access_mode: access.mode,
      router_count: access.routerIds.length
    });
    return {
      member: organizationUserResponse(member, membership),
      invitation_delivery: invitationDelivered ? "sent" : "not_sent",
      message: invitationDelivered
        ? requiresPassword
          ? "Invitation envoyée. Cette personne créera son mot de passe en l'acceptant."
          : "Invitation envoyée. Le mot de passe actuel de cette personne reste inchangé."
        : "Le membre a été créé, mais l'email n'a pas pu être envoyé. Utilisez « Renvoyer l'invitation » après avoir vérifié le SMTP.",
      ...(SAAS_EXPOSE_RESET_TOKEN ? { invitation_token: invitationToken } : {})
    };
  }),

  route("POST", "/v1/saas/team/members/update", async (request, body) => {
    const context = requireTeamManager(request);
    const { membership, user: member } = requireOrganizationMember(context, body);
    if (membership.authority_role === "owner") {
      throw new HttpError(400, "Le compte propriétaire ne peut pas être modifié ici.");
    }
    if (membership.app_role === "admin" && context.membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut modifier un administrateur.");
    }
    const appRole = normalizeOrganizationAppRole(body.app_role ?? membership.app_role);
    if (appRole === "admin" && context.membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut attribuer le rôle administrateur.");
    }
    const status = String(body.status ?? membership.status);
    if (!["active", "disabled"].includes(status)) {
      throw new HttpError(400, "Statut employé invalide.");
    }
    const access = normalizeRouterAccess(body, appRole);
    const updatedAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.updateOrganizationMembership.run(
        appRole,
        access.mode,
        status,
        updatedAt,
        membership.id,
        context.organization.id
      );
      replaceOrganizationRouterAccess(membership.id, access.routerIds, updatedAt);
      statements.revokeOrganizationMembershipSessions.run(updatedAt, membership.id);
      if (status === "disabled" && membership.invitation_status === "pending") {
        statements.consumePendingOrganizationInvitationTokens.run(updatedAt, membership.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const vpnAccess = status === "disabled"
      ? await deactivateOrganizationMemberDevices(
        context.organization.id,
        member.id,
        "membership_disabled"
      )
      : { changed_device_count: 0, hub_synchronized_count: 0 };
    logEvent(request, null, "organization_member_updated", context.organization.id, null, {
      member_id: member.id,
      app_role: appRole,
      router_access_mode: access.mode,
      router_count: access.routerIds.length,
      sessions_revoked: true,
      status,
      affected_device_count: vpnAccess.changed_device_count
    });
    return {
      member: organizationUserResponse(
        statements.findOrganizationUserById.get(member.id),
        statements.findOrganizationMembershipById.get(membership.id)
      ),
      sessions_revoked: true,
      vpn_access_revoked: status === "disabled",
      affected_device_count: vpnAccess.changed_device_count
    };
  }),

  route("POST", "/v1/saas/team/members/resend-invitation", async (request, body) => {
    const context = requireTeamManager(request);
    const { membership, user: member } = requireOrganizationMember(context, body);
    if (membership.authority_role === "owner" || membership.invitation_status !== "pending") {
      throw new HttpError(400, "Cette invitation n'est plus en attente.");
    }
    const invitationToken = randomToken(32);
    const createdAt = nowIso();
    if (membership.status !== "active") {
      throw new HttpError(400, "Réactivez ce membre avant de renvoyer son invitation.");
    }
    const expiresAt = new Date(
      Date.now() + SAAS_INVITATION_TTL_HOURS * 3_600_000
    ).toISOString();
    const requiresPassword = !member.last_login_at && member.invitation_pending;
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.consumePendingOrganizationInvitationTokens.run(createdAt, membership.id);
      statements.insertOrganizationInvitationToken.run(
        crypto.randomUUID(),
        membership.id,
        hash(invitationToken),
        requiresPassword ? 1 : 0,
        expiresAt,
        createdAt
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    let invitationDelivered = false;
    try {
      invitationDelivered = await deliverOrganizationInvitation(
        member,
        context.organization,
        invitationToken,
        expiresAt,
        requiresPassword
      );
    } catch (error) {
      console.error("Impossible de renvoyer l'invitation employé:", error.message);
    }
    logEvent(request, null, "organization_invitation_resent", context.organization.id, null, {
      invitation_delivery: invitationDelivered ? "sent" : "not_sent",
      member_id: member.id
    });
    return {
      ok: invitationDelivered,
      invitation_delivery: invitationDelivered ? "sent" : "not_sent",
      message: invitationDelivered
        ? "Invitation renvoyée. L'ancien lien est maintenant inutilisable."
        : "Un nouveau lien a été créé, mais l'email n'a pas pu être envoyé. Vérifiez la configuration SMTP puis réessayez.",
      ...(SAAS_EXPOSE_RESET_TOKEN ? { invitation_token: invitationToken } : {})
    };
  }),

  route("POST", "/v1/saas/team/members/remove", async (request, body) => {
    const context = requireTeamManager(request);
    const { membership, user: member } = requireOrganizationMember(context, body);
    if (membership.authority_role === "owner") {
      throw new HttpError(400, "Le propriétaire ne peut pas être supprimé.");
    }
    if (membership.app_role === "admin" && context.membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut supprimer un administrateur.");
    }
    const removedAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.revokeOrganizationMembershipSessions.run(removedAt, membership.id);
      statements.consumePendingOrganizationInvitationTokens.run(removedAt, membership.id);
      statements.deleteOrganizationMembership.run(membership.id, context.organization.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const vpnAccess = await deactivateOrganizationMemberDevices(
      context.organization.id,
      member.id,
      "membership_removed",
      { permanent: true }
    );
    logEvent(request, null, "organization_member_removed", context.organization.id, null, {
      invitation_pending: membership.invitation_status === "pending",
      member_id: member.id,
      sessions_revoked: true,
      revoked_device_count: vpnAccess.changed_device_count
    });
    return {
      ok: true,
      vpn_access_revoked: true,
      revoked_device_count: vpnAccess.changed_device_count
    };
  }),

  route("POST", "/v1/saas/invitations/inspect", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const token = requireText(body, "invitation_token", 512);
    const invitation = statements.findOrganizationInvitationToken.get(hash(token));
    if (!invitation || invitation.invitation_status !== "pending"
      || invitation.membership_status !== "active"
      || Date.parse(invitation.expires_at) <= Date.now()) {
      throw new HttpError(400, "Cette invitation est invalide ou expirée.");
    }
    return {
      valid: true,
      email: invitation.email,
      name: invitation.name,
      organization_name: invitation.organization_name,
      requires_password: Boolean(invitation.requires_password),
      expires_at: invitation.expires_at
    };
  }),

  route("POST", "/v1/saas/invitations/accept", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const token = requireText(body, "invitation_token", 512);
    const invitation = statements.findOrganizationInvitationToken.get(hash(token));
    if (!invitation || invitation.invitation_status !== "pending"
      || invitation.membership_status !== "active"
      || Date.parse(invitation.expires_at) <= Date.now()) {
      throw new HttpError(400, "Cette invitation est invalide ou expirée.");
    }
    let password = null;
    if (invitation.requires_password) {
      password = requireCustomerPassword(body, "new_password");
      if (password !== String(body.confirm_password ?? "")) {
        throw new HttpError(400, "Les mots de passe ne correspondent pas.");
      }
    }
    const acceptedAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (password) {
        statements.updateOrganizationPassword.run(
          hashPassword(password),
          acceptedAt,
          invitation.user_id
        );
        statements.revokeOrganizationUserSessions.run(acceptedAt, invitation.user_id);
      }
      statements.acceptOrganizationMembership.run(
        acceptedAt,
        acceptedAt,
        invitation.membership_id
      );
      statements.consumePendingOrganizationInvitationTokens.run(
        acceptedAt,
        invitation.membership_id
      );
      statements.markOrganizationInvitationAccepted.run(acceptedAt, invitation.user_id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    logEvent(request, null, "organization_invitation_accepted", invitation.organization_id, null, {
      membership_id: invitation.membership_id,
      user_id: invitation.user_id
    });
    return {
      ok: true,
      email: invitation.email,
      organization_name: invitation.organization_name,
      message: "Invitation acceptée. Vous pouvez maintenant vous connecter à TicketPro."
    };
  }),

  route("POST", "/v1/saas/auth/logout", async (request) => {
    const { session } = requireOrganizationUser(request);
    statements.revokeOrganizationSession.run(nowIso(), session.id);
    return { ok: true };
  }),

  route("POST", "/v1/saas/auth/forgot-password", async (request, body) => {
    if (isRateLimited(request)) {
      throw new HttpError(429, "Trop de tentatives. Réessayez dans quelques instants.");
    }
    const email = requireEmail(body);
    const user = statements.findOrganizationUserByEmail.get(email);
    let exposedToken = null;
    if (user && user.status === "active") {
      const resetToken = randomToken(32);
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      statements.insertOrganizationPasswordReset.run(
        crypto.randomUUID(),
        user.id,
        hash(resetToken),
        expiresAt,
        createdAt
      );
      try {
        await deliverOrganizationPasswordReset(user, resetToken, expiresAt);
      } catch (error) {
        console.error("Impossible d'envoyer l'email de réinitialisation:", error.message);
      }
      if (SAAS_EXPOSE_RESET_TOKEN) exposedToken = resetToken;
    }
    return {
      accepted: true,
      message: "Si ce compte existe, un lien de réinitialisation vient d'être envoyé.",
      ...(exposedToken ? { reset_token: exposedToken } : {})
    };
  }),

  route("POST", "/v1/saas/auth/reset-password", async (request, body) => {
    const resetToken = requireText(body, "reset_token", 512);
    const password = requireCustomerPassword(body, "new_password");
    if (password !== String(body.confirm_password ?? "")) {
      throw new HttpError(400, "Les mots de passe ne correspondent pas.");
    }
    const reset = statements.findOrganizationPasswordReset.get(hash(resetToken));
    if (!reset || Date.parse(reset.expires_at) <= Date.now()) {
      throw new HttpError(400, "Ce lien de réinitialisation est invalide ou expiré.");
    }
    const updatedAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.updateOrganizationPassword.run(hashPassword(password), updatedAt, reset.user_id);
      statements.markOrganizationInvitationAccepted.run(updatedAt, reset.user_id);
      statements.consumeOrganizationPasswordReset.run(updatedAt, reset.id);
      statements.revokeOrganizationUserSessions.run(updatedAt, reset.user_id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, message: "Mot de passe modifié. Vous pouvez vous connecter." };
  }),

  route("POST", "/v1/saas/subscriptions/purchase", async (request, body) => {
    const { user, membership, organization } = requireOrganizationUser(request);
    if (membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut gérer l'abonnement.");
    }
    return createIpayOrder(
      request,
      body,
      "organization",
      null,
      null,
      {
        organization_id: organization.id,
        user_id: user.id,
        organization_name: organization.name
      }
    );
  }),

  route("GET", "/v1/saas/services/access", async (request) => {
    const context = requireOrganizationUser(request, { requireActiveSubscription: true });
    return {
      allowed: true,
      organization_id: context.organization.id,
      router_limit: Number(context.subscription.router_limit),
      expires_at: context.subscription.current_period_end
    };
  }),

  route("GET", "/v1/saas/routers/recovery", async (request) => {
    const context = requireOrganizationPermission(request, "global.routers.select", {
      requireActiveSubscription: true
    });
    const access = organizationUserRouterAccess(context.membership);
    const routers = statements.listOrganizationRouters
      .all(context.organization.id)
      .filter((router) => access.mode === "all" || access.router_ids.includes(router.id))
      .map(organizationRouterRecoveryResponse);
    logEvent(request, null, "organization_router_recovery_downloaded", context.organization.id, null, {
      organization_user_id: context.user.id,
      router_count: routers.length
    });
    return { routers };
  }),

  route("POST", "/v1/saas/routers/snapshot", async (request, body) => {
    const context = requireOrganizationPermission(request, "global.routers.manage", {
      requireActiveSubscription: true
    });
    const snapshot = normalizeOrganizationRouterSnapshot(body.router);
    const byId = statements.findAnyOrganizationRouterById.get(
      context.organization.id,
      snapshot.id
    );
    const byStableIdentity = statements.findAnyOrganizationRouterByStableIdentity.get(
      context.organization.id,
      snapshot.stable_identity
    );
    if (byId && byStableIdentity && byId.id !== byStableIdentity.id) {
      throw new HttpError(409, "L'identité physique de ce routeur appartient déjà à un autre enregistrement.");
    }
    const existing = byStableIdentity ?? byId ?? null;
    if (!existing) {
      const routerCount = statements.listOrganizationRouters.all(context.organization.id).length;
      if (routerCount >= Number(context.subscription.router_limit)) {
        throw new HttpError(409, "La limite de routeurs de l'abonnement est atteinte.");
      }
    }
    const routerId = existing?.id ?? snapshot.id;
    const encryptedCredential = encryptRouterCredential(
      context.organization.id,
      routerId,
      snapshot.credential
    );
    const updatedAt = nowIso();
    if (existing) {
      statements.updateOrganizationRouter.run(
        snapshot.stable_identity,
        snapshot.name,
        snapshot.label,
        snapshot.model,
        snapshot.board_name,
        snapshot.serial_number,
        snapshot.routeros_version,
        snapshot.local_ip,
        snapshot.hotspot_address,
        snapshot.notes,
        snapshot.api_port,
        snapshot.api_ssl_port,
        snapshot.username,
        encryptedCredential,
        snapshot.connection_mode,
        JSON.stringify(snapshot.connections),
        JSON.stringify(snapshot.plans),
        snapshot.vpn ? JSON.stringify(snapshot.vpn) : null,
        snapshot.status,
        snapshot.last_seen_at,
        context.user.id,
        updatedAt,
        context.organization.id,
        routerId
      );
    } else {
      statements.insertOrganizationRouter.run(
        routerId,
        context.organization.id,
        snapshot.stable_identity,
        snapshot.name,
        snapshot.label,
        snapshot.model,
        snapshot.board_name,
        snapshot.serial_number,
        snapshot.routeros_version,
        snapshot.local_ip,
        snapshot.hotspot_address,
        snapshot.notes,
        snapshot.api_port,
        snapshot.api_ssl_port,
        snapshot.username,
        encryptedCredential,
        snapshot.connection_mode,
        JSON.stringify(snapshot.connections),
        JSON.stringify(snapshot.plans),
        snapshot.vpn ? JSON.stringify(snapshot.vpn) : null,
        snapshot.status,
        snapshot.last_seen_at,
        context.user.id,
        context.user.id,
        updatedAt,
        updatedAt
      );
    }
    const saved = statements.findOrganizationRouterById.get(
      context.organization.id,
      routerId
    );
    logEvent(request, null, "organization_router_snapshot_saved", context.organization.id, null, {
      organization_user_id: context.user.id,
      router_id: routerId,
      stable_identity_hash: hash(snapshot.stable_identity),
      plan_count: snapshot.plans.length,
      vpn_configured: Boolean(snapshot.vpn)
    });
    return { router: organizationRouterRecoveryResponse(saved) };
  }),

  route("POST", "/v1/saas/routers/remove", async (request, body) => {
    const context = requireOrganizationPermission(request, "global.routers.delete", {
      requireActiveSubscription: true
    });
    const routerId = requireText(body, "router_id", 200);
    const removedAt = nowIso();
    const result = statements.softDeleteOrganizationRouter.run(
      removedAt,
      removedAt,
      context.user.id,
      context.organization.id,
      routerId
    );
    if (Number(result.changes) !== 1) {
      throw new HttpError(404, "Routeur cloud introuvable.");
    }
    logEvent(request, null, "organization_router_snapshot_removed", context.organization.id, null, {
      organization_user_id: context.user.id,
      router_id: routerId
    });
    return { ok: true, router_id: routerId };
  }),

  route("GET", "/v1/saas/router-ticket-catalog", async (request) => {
    const routerId = String(
      new URL(request.url, "http://ticketpro.local").searchParams.get("router_id") ?? ""
    ).trim();
    if (!routerId || routerId.length > 200) {
      throw new HttpError(400, "Identifiant de routeur invalide.");
    }
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.tickets.read", "router.tickets.own"],
      routerId
    );
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    const canReadAll = organizationContextHasPermission(context, "router.tickets.read");
    const tickets = statements.listOrganizationTickets
      .all(context.organization.id, routerId)
      .filter((ticket) => canReadAll || ticket.created_by_user_id === context.user.id);
    const visibleBatchIds = new Set(tickets.map((ticket) => ticket.batch_id));
    const batches = statements.listOrganizationTicketBatches
      .all(context.organization.id, routerId)
      .filter((batch) => canReadAll || visibleBatchIds.has(batch.id));
    return {
      batches: batches.map(organizationTicketBatchResponse),
      router_id: routerId,
      tickets: tickets.map(organizationTicketResponse)
    };
  }),

  route("POST", "/v1/saas/router-ticket-catalog", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.tickets.generate", "router.tickets.sync", "router.tickets.disable", "router.tickets.delete"],
      routerId
    );
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    const catalog = normalizeOrganizationTicketCatalog(body);
    const creatorRole = context.membership.authority_role === "owner"
      ? "admin"
      : normalizeOrganizationAppRole(context.membership.app_role);

    for (const batch of catalog.batches) {
      const existing = statements.findOrganizationTicketBatchById.get(
        context.organization.id,
        routerId,
        batch.id
      );
      statements.upsertOrganizationTicketBatch.run(
        batch.id,
        context.organization.id,
        routerId,
        batch.plan_id,
        existing?.operator_profile ?? creatorRole,
        batch.quantity,
        batch.prefix,
        batch.code_length,
        batch.status,
        batch.hotspot_server_name,
        batch.currency,
        batch.price_snapshot,
        batch.sync_status,
        existing?.created_by_user_id ?? context.user.id,
        existing?.created_by_name ?? context.user.name,
        existing?.created_by_email ?? context.user.email,
        existing?.created_at ?? batch.created_at,
        batch.updated_at
      );
    }

    for (const ticket of catalog.tickets) {
      const existingById = statements.findOrganizationTicketById.get(
        context.organization.id,
        routerId,
        ticket.id
      );
      const existingByUsername = statements.findOrganizationTicketByUsername.get(
        context.organization.id,
        routerId,
        ticket.username
      );
      if (existingById && existingByUsername && existingById.id !== existingByUsername.id) {
        throw new HttpError(409, `Le voucher ${ticket.username} possède deux identités cloud incompatibles.`);
      }
      const existing = existingByUsername ?? existingById ?? null;
      const ticketId = existing?.id ?? ticket.id;
      const batch = statements.findOrganizationTicketBatchById.get(
        context.organization.id,
        routerId,
        ticket.batch_id
      );
      if (!batch) {
        throw new HttpError(409, `Le lot du voucher ${ticket.username} est introuvable.`);
      }
      const merged = mergeOrganizationTicket(existing, ticket);
      statements.upsertOrganizationTicket.run(
        ticketId,
        context.organization.id,
        routerId,
        merged.batch_id,
        merged.plan_id,
        merged.username,
        merged.password_is_username ? 1 : 0,
        merged.status,
        merged.mac_address,
        merged.ip_address,
        merged.activated_at,
        merged.completed_at,
        merged.expires_at,
        merged.deleted_at,
        merged.printed_count,
        merged.downloaded_bytes,
        merged.uploaded_bytes,
        merged.mikrotik_id,
        merged.hotspot_server_name,
        merged.mikrotik_profile_name,
        merged.exported_at,
        merged.archived_at,
        merged.router_deleted_at,
        merged.last_router_sync_at,
        merged.uptime_seconds,
        merged.remaining_seconds,
        merged.data_remaining_bytes,
        merged.duration_minutes_snapshot,
        merged.validity_minutes_snapshot,
        merged.data_limit_mb_snapshot,
        merged.download_limit_snapshot,
        merged.upload_limit_snapshot,
        merged.shared_users_snapshot,
        merged.sync_status,
        existing?.created_by_user_id ?? context.user.id,
        existing?.created_by_name ?? context.user.name,
        existing?.created_by_email ?? context.user.email,
        existing?.created_by_role ?? creatorRole,
        existing?.created_at ?? merged.created_at,
        merged.updated_at
      );
    }

    logEvent(request, null, "organization_ticket_catalog_synchronized", context.organization.id, null, {
      batch_count: catalog.batches.length,
      organization_user_id: context.user.id,
      router_id: routerId,
      ticket_count: catalog.tickets.length
    });
    const canReadAll = organizationContextHasPermission(context, "router.tickets.read");
    const visibleTickets = statements.listOrganizationTickets
      .all(context.organization.id, routerId)
      .filter((ticket) => canReadAll || ticket.created_by_user_id === context.user.id);
    const visibleBatchIds = new Set(visibleTickets.map((ticket) => ticket.batch_id));
    return {
      batches: statements.listOrganizationTicketBatches
        .all(context.organization.id, routerId)
        .filter((batch) => canReadAll || visibleBatchIds.has(batch.id))
        .map(organizationTicketBatchResponse),
      router_id: routerId,
      tickets: visibleTickets.map(organizationTicketResponse)
    };
  }),

  route("GET", "/v1/saas/router-files", async (request) => {
    const routerId = String(
      new URL(request.url, "http://ticketpro.local").searchParams.get("router_id") ?? ""
    ).trim();
    if (!routerId || routerId.length > 200) {
      throw new HttpError(400, "Identifiant de routeur invalide.");
    }
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.files.read", "router.files.own"],
      routerId
    );
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    const canReadAll = organizationContextHasPermission(context, "router.files.read");
    const files = statements.listOrganizationGeneratedFiles
      .all(context.organization.id, routerId)
      .filter((file) => canReadAll || file.created_by_user_id === context.user.id);
    return { files: files.map(organizationGeneratedFileResponse), router_id: routerId };
  }),

  route("POST", "/v1/saas/router-files", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.tickets.generate", "router.tickets.reprint", "router.files.read", "router.files.own"],
      routerId
    );
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length > 100) throw new HttpError(400, "Trop de fichiers à synchroniser.");
    const creatorRole = context.membership.authority_role === "owner"
      ? "admin"
      : normalizeOrganizationAppRole(context.membership.app_role);
    for (const rawFile of files) {
      const file = normalizeOrganizationGeneratedFile(rawFile);
      const existing = statements.findOrganizationGeneratedFileById.get(
        context.organization.id,
        routerId,
        file.id
      );
      statements.upsertOrganizationGeneratedFile.run(
        file.id,
        context.organization.id,
        routerId,
        file.batch_id,
        file.type,
        file.file_name,
        file.format,
        file.metadata_json,
        file.sync_status,
        existing?.created_by_user_id ?? context.user.id,
        existing?.created_by_name ?? context.user.name,
        existing?.created_by_email ?? context.user.email,
        existing?.created_by_role ?? creatorRole,
        existing?.created_at ?? file.created_at,
        file.updated_at,
        file.deleted_at
      );
    }
    const canReadAll = organizationContextHasPermission(context, "router.files.read");
    const visibleFiles = statements.listOrganizationGeneratedFiles
      .all(context.organization.id, routerId)
      .filter((file) => canReadAll || file.created_by_user_id === context.user.id);
    return { files: visibleFiles.map(organizationGeneratedFileResponse), router_id: routerId };
  }),

  route("POST", "/v1/saas/router-file-print-archive", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const fileId = requireText(body, "file_id", 240);
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.tickets.generate", "router.tickets.reprint"],
      routerId
    );
    const file = statements.findOrganizationGeneratedFileById.get(
      context.organization.id,
      routerId,
      fileId
    );
    if (!file || file.deleted_at) {
      throw new HttpError(404, "Fichier organisationnel introuvable.");
    }
    const canManageAll = organizationContextHasPermission(context, "router.tickets.delete");
    if (file.created_by_user_id !== context.user.id && !canManageAll) {
      throw new HttpError(403, "Seul le créateur du lot ou un administrateur peut publier son archive.");
    }
    const archive = normalizeTicketPrintArchive(body.archive);
    if (!file.batch_id || archive.batchId !== file.batch_id) {
      throw new HttpError(400, "L'archive ne correspond pas au lot de ce fichier.");
    }
    const encrypted = encryptTicketPrintArchive(
      context.organization.id,
      routerId,
      fileId,
      archive
    );
    const updatedAt = nowIso();
    statements.updateOrganizationGeneratedFilePrintArchive.run(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.version,
      updatedAt,
      context.organization.id,
      routerId,
      fileId
    );
    logEvent(request, null, "ticket_print_archive_saved", context.organization.id, null, {
      file_id: fileId,
      router_id: routerId,
      ticket_count: archive.tickets.length,
      version: encrypted.version
    });
    return { available: true, updated_at: updatedAt, version: encrypted.version };
  }),

  route("GET", "/v1/saas/router-file-print-archive", async (request) => {
    const url = new URL(request.url, "http://ticketpro.local");
    const routerId = String(url.searchParams.get("router_id") ?? "").trim();
    const fileId = String(url.searchParams.get("file_id") ?? "").trim();
    if (!routerId || routerId.length > 200 || !fileId || fileId.length > 240) {
      throw new HttpError(400, "Identifiant de routeur ou de fichier invalide.");
    }
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.tickets.reprint", "router.files.read", "router.files.own"],
      routerId
    );
    const file = statements.findOrganizationGeneratedFileById.get(
      context.organization.id,
      routerId,
      fileId
    );
    if (!file || file.deleted_at) {
      throw new HttpError(404, "Fichier organisationnel introuvable.");
    }
    const canReadAll = organizationContextHasPermission(context, "router.files.read");
    if (!canReadAll && file.created_by_user_id !== context.user.id) {
      throw new HttpError(403, "Ce fichier n'appartient pas au profil actif.");
    }
    const archive = decryptTicketPrintArchive(file);
    logEvent(request, null, "ticket_print_archive_opened", context.organization.id, null, {
      file_id: fileId,
      router_id: routerId,
      ticket_count: archive.tickets.length,
      version: archive.version
    });
    return { archive };
  }),

  route("GET", "/v1/saas/router-activity-logs", async (request) => {
    const routerId = String(
      new URL(request.url, "http://ticketpro.local").searchParams.get("router_id") ?? ""
    ).trim();
    if (!routerId || routerId.length > 200) {
      throw new HttpError(400, "Identifiant de routeur invalide.");
    }
    const context = requireOrganizationRouterPermission(request, "router.logs.read", routerId);
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    return {
      logs: statements.listOrganizationActivityLogs
        .all(context.organization.id, routerId)
        .map(organizationActivityLogResponse),
      router_id: routerId
    };
  }),

  route("POST", "/v1/saas/router-activity-logs", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const context = requireOrganizationRouterAnyPermission(
      request,
      ["router.home", "router.tickets.generate", "router.tickets.sync", "router.plans.write", "router.settings"],
      routerId
    );
    if (!statements.findOrganizationRouterById.get(context.organization.id, routerId)) {
      throw new HttpError(404, "Routeur organisationnel introuvable.");
    }
    const logs = Array.isArray(body.logs) ? body.logs : [];
    if (logs.length > 100) throw new HttpError(400, "Trop de journaux à synchroniser.");
    const creatorRole = context.membership.authority_role === "owner"
      ? "admin"
      : normalizeOrganizationAppRole(context.membership.app_role);
    for (const rawLog of logs) {
      const log = normalizeOrganizationActivityLog(rawLog);
      statements.insertOrganizationActivityLog.run(
        log.id,
        context.organization.id,
        routerId,
        log.level,
        log.category,
        log.user_message,
        log.technical_message,
        context.user.id,
        context.user.name,
        context.user.email,
        creatorRole,
        log.created_at
      );
    }
    return { accepted: logs.length, router_id: routerId };
  }),

  route("POST", "/v1/saas/router-activity-logs/clean", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const context = requireOrganizationRouterPermission(request, "router.logs.clean", routerId);
    const cutoff = normalizeOptionalIsoDate(body.before);
    if (
      !cutoff
      || new Date(cutoff).getTime() > Date.now() + CLIENT_CLOCK_SKEW_TOLERANCE_MS
    ) {
      throw new HttpError(400, "Date de nettoyage invalide.");
    }
    const result = statements.deleteOrganizationActivityLogsBefore.run(
      context.organization.id,
      routerId,
      cutoff
    );
    return { removed: Number(result.changes), router_id: routerId };
  }),

  route("GET", "/v1/saas/router-access-policy", async (request) => {
    const routerId = String(
      new URL(request.url, "http://ticketpro.local").searchParams.get("router_id") ?? ""
    ).trim();
    if (!routerId || routerId.length > 200) {
      throw new HttpError(400, "Identifiant de routeur invalide.");
    }
    const context = requireOrganizationRouterPermission(
      request,
      "router.settings",
      routerId
    );
    return {
      policy: routerAccessPolicyResponse(
        statements.findRouterAccessPolicy.get(context.organization.id, routerId)
      )
    };
  }),

  route("GET", "/v1/saas/router-access-policy/history", async (request) => {
    const routerId = String(
      new URL(request.url, "http://ticketpro.local").searchParams.get("router_id") ?? ""
    ).trim();
    if (!routerId || routerId.length > 200) {
      throw new HttpError(400, "Identifiant de routeur invalide.");
    }
    const context = requireOrganizationRouterPermission(
      request,
      "router.settings",
      routerId
    );
    return {
      history: statements.listRouterAccessPolicyHistory
        .all(context.organization.id, routerId)
        .map(routerAccessPolicyHistoryResponse)
    };
  }),

  route("POST", "/v1/saas/router-access-policy", async (request, body) => {
    const routerId = requireText(body, "router_id", 200);
    const context = requireOrganizationRouterPermission(
      request,
      "router.settings.manage",
      routerId
    );
    const policy = normalizeRouterAccessPolicy(body.policy);
    const baseRevision = Number(body.base_revision ?? 0);
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new HttpError(400, "Révision de synchronisation invalide.");
    }
    const updatedAt = nowIso();
    const serializedPolicy = JSON.stringify(policy);
    let saved;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = statements.findRouterAccessPolicy.get(
        context.organization.id,
        routerId
      );
      if (Number(existing?.revision ?? 0) !== baseRevision) {
        throw new HttpError(409, "La politique réseau a été modifiée depuis un autre appareil.", {
          code: "ROUTER_ACCESS_POLICY_CONFLICT",
          remote_policy: routerAccessPolicyResponse(existing)
        });
      }
      if (existing) {
        const result = statements.updateRouterAccessPolicy.run(
          serializedPolicy,
          context.user.id,
          updatedAt,
          context.organization.id,
          routerId,
          baseRevision
        );
        if (Number(result.changes) !== 1) {
          const latest = statements.findRouterAccessPolicy.get(
            context.organization.id,
            routerId
          );
          throw new HttpError(409, "La politique réseau a été modifiée depuis un autre appareil.", {
            code: "ROUTER_ACCESS_POLICY_CONFLICT",
            remote_policy: routerAccessPolicyResponse(latest)
          });
        }
      } else {
        statements.insertRouterAccessPolicy.run(
          context.organization.id,
          routerId,
          serializedPolicy,
          context.user.id,
          updatedAt,
          updatedAt
        );
      }
      saved = statements.findRouterAccessPolicy.get(
        context.organization.id,
        routerId
      );
      statements.insertRouterAccessPolicyHistory.run(
        context.organization.id,
        routerId,
        Number(saved.revision),
        serializedPolicy,
        context.user.id,
        updatedAt
      );
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // La transaction a déjà été terminée.
      }
      throw error;
    }
    logEvent(request, null, "router_access_policy_synced", context.organization.id, null, {
      router_id: routerId,
      revision: Number(saved.revision),
      anti_sharing_mode: policy.antiSharingMode,
      blocked_device_count: policy.blockedDevices.length,
      ipv4_ttl_enabled: policy.monitorIpv4Ttl,
      ipv6_block_enabled: policy.monitorIpv6HopLimit,
      infrastructure_device_count: policy.infrastructureDevices.length
    });
    return { policy: routerAccessPolicyResponse(saved) };
  }),

  route("POST", "/v1/payments/orders/organization", async (request, body) => {
    return createIpayOrder(request, body, "organization");
  }),

  route("POST", "/v1/reseller/register-and-pay", async (request, body) => {
    const email = requireEmail(body);
    if (statements.findResellerByEmail.get(email)) {
      throw new HttpError(409, "Un compte revendeur existe déjà avec cet email.");
    }
    const existingRegistration = statements.findResellerRegistrationByEmail.get(email);
    if (existingRegistration?.status === "pending") {
      throw new HttpError(409, "Une inscription avec paiement est déjà en attente pour cet email.");
    }
    const password = requireNewPassword(body, "password");
    if (password !== String(body.confirm_password ?? "")) {
      throw new HttpError(400, "Les mots de passe revendeur ne correspondent pas.");
    }
    const plan = statements.findPlanById.get(requireText(body, "plan_id", 128));
    if (!plan || !Boolean(plan.is_active) || !Boolean(plan.is_reseller)) {
      throw new HttpError(400, "Un pack revendeur actif est requis.");
    }
    const registrationId = existingRegistration?.status === "cancelled"
      ? existingRegistration.id
      : crypto.randomUUID();
    const registrationName = requireText(body, "name", 200);
    const passwordHash = hashPassword(password);
    const registrationCreatedAt = nowIso();
    if (existingRegistration?.status === "cancelled") {
      statements.restartResellerRegistration.run(
        registrationName,
        passwordHash,
        plan.id,
        registrationCreatedAt,
        registrationId
      );
    } else {
      statements.insertResellerRegistration.run(
        registrationId,
        email,
        registrationName,
        passwordHash,
        plan.id,
        registrationCreatedAt
      );
    }
    const registration = statements.findResellerRegistrationById.get(registrationId);
    return createIpayOrder(request, body, "reseller", null, registration);
  }),

  route("POST", "/v1/reseller/payments/orders", async (request, body) => {
    const reseller = requireReseller(request);
    return createIpayOrder(request, body, "reseller", reseller);
  }),

  route("POST", "/v1/payments/orders/status", async (request, body) => {
    const order = authorizePaymentOrder(request, body);
    let current = order;
    if (order.fulfillment_status !== "fulfilled" && !["failed", "cancelled"].includes(order.status)) {
      const payment = await getIpayPaymentStatus(order);
      current = processVerifiedPayment(request, order, payment);
    }
    return {
      order: paymentOrderResponse(
        current,
        current.purchaser_type === "organization" && current.fulfillment_status === "fulfilled"
      )
    };
  }),

  route("POST", "/v1/payments/orders/abandon", async (request, body) => {
    const order = authorizePaymentOrder(request, body);
    if (order.fulfillment_status === "fulfilled") {
      return { abandoned: false, order: paymentOrderResponse(order, order.purchaser_type === "organization") };
    }
    if (order.status === "cancelled") {
      return { abandoned: true, order: paymentOrderResponse(order) };
    }

    const payment = await getIpayPaymentStatus(order);
    const reconciled = processVerifiedPayment(request, order, payment);
    if (reconciled.status === "succeeded") {
      return {
        abandoned: false,
        order: paymentOrderResponse(
          reconciled,
          reconciled.purchaser_type === "organization" && reconciled.fulfillment_status === "fulfilled"
        )
      };
    }

    const abandonedAt = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.abandonPaymentOrder.run(
        abandonedAt,
        abandonedAt,
        "Tentative abandonnée par le client avant confirmation.",
        order.id
      );
      if (order.reseller_registration_id) {
        statements.cancelResellerRegistration.run(order.reseller_registration_id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    logEvent(request, null, "payment_abandoned", null, null, {
      order_id: order.id,
      transaction_id: order.transaction_id
    });
    return {
      abandoned: true,
      order: paymentOrderResponse(statements.findPaymentOrderById.get(order.id))
    };
  }),

  route("POST", "/v1/reseller/payments/list", async (request, body) => {
    const reseller = requireReseller(request);
    const limit = body.limit === undefined ? 100 : requireInteger(body, "limit", 1, 500);
    return {
      payments: statements.listResellerPayments.all(reseller.id, limit),
      reseller: resellerResponse(reseller)
    };
  }),

  route("POST", "/v1/payments/ipay/webhook", async (request, body) => {
    assertIpayConfigured();
    const receivedSecret = String(
      request.headers["secret-hash"] ?? request.headers["x-ipaymoney-secret"] ?? ""
    );
    if (!receivedSecret || !sameSecret(receivedSecret, IPAY_SECRET_HASH)) {
      throw new HttpError(401, "Secret-Hash iPay invalide.");
    }
    const data = body?.data;
    const transactionId = String(data?.external_reference ?? "");
    if (!transactionId || !data?.status) throw new HttpError(400, "Payload webhook iPay incomplet.");
    const order = statements.findPaymentOrderByTransaction.get(transactionId);
    if (!order) throw new HttpError(404, "Commande iPay inconnue.");
    const eventHash = hash(JSON.stringify(body));
    try {
      statements.insertWebhookEvent.run(
        crypto.randomUUID(),
        eventHash,
        transactionId,
        data.reference ? String(data.reference) : null,
        String(data.status),
        nowIso()
      );
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) throw error;
    }
    const payment = await getIpayPaymentStatus(order);
    const fulfilled = processVerifiedPayment(request, order, payment);
    statements.finishWebhookEvent.run(nowIso(), "processed", eventHash);
    return {
      ok: true,
      order_id: fulfilled.id,
      status: fulfilled.status,
      fulfillment_status: fulfilled.fulfillment_status
    };
  }),

  route("POST", "/v1/admin/auth/login", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const email = requireEmail(body);
    const password = requirePasswordInput(body);
    const admin = statements.findAdminByEmail.get(email);
    if (!admin) {
      crypto.scryptSync(password, crypto.randomBytes(16), 64);
      throw new HttpError(401, "Email ou mot de passe incorrect.");
    }
    assertLoginAllowed(admin);
    if (admin.status !== "active" || !verifyPassword(password, admin.password_hash)) {
      recordFailedLogin("admin", admin);
      throw new HttpError(401, "Email ou mot de passe incorrect.");
    }
    const timestampValue = nowIso();
    statements.adminLoginSucceeded.run(timestampValue, timestampValue, admin.id);
    const session = createSession(request, "admin", admin.id, 12);
    logEvent(request, null, "admin_login", null, null, { admin_id: admin.id });
    return {
      session_token: session.token,
      expires_at: session.expires_at,
      admin: adminResponse(statements.findAdminById.get(admin.id))
    };
  }),

  route("GET", "/v1/admin/auth/me", async (request) => {
    const admin = requireAdmin(request, ["owner", "admin", "support"], true);
    return { admin: adminResponse(admin) };
  }),

  route("POST", "/v1/admin/auth/logout", async (request) => {
    requireAdmin(request, ["owner", "admin", "support"], true);
    const session = sessionActor(request, "admin");
    if (session) statements.revokeSession.run(nowIso(), session.id);
    return { ok: true };
  }),

  route("POST", "/v1/admin/auth/change-password", async (request, body) => {
    const admin = requireAdmin(request, ["owner", "admin", "support"], true);
    if (admin.via_master) throw new HttpError(400, "Le master token ne possède pas de mot de passe.");
    const currentPassword = requirePasswordInput(body, "current_password");
    const newPassword = requireNewPassword(body);
    if (!verifyPassword(currentPassword, admin.password_hash)) {
      throw new HttpError(401, "Mot de passe actuel incorrect.");
    }
    statements.updateAdminPassword.run(hashPassword(newPassword), 0, nowIso(), admin.id);
    statements.revokeActorSessions.run(nowIso(), "admin", admin.id);
    const session = createSession(request, "admin", admin.id, 12);
    logEvent(request, null, "admin_password_changed", null, null, { admin_id: admin.id });
    return {
      session_token: session.token,
      expires_at: session.expires_at,
      admin: adminResponse(statements.findAdminById.get(admin.id))
    };
  }),

  route("POST", "/v1/admin/auth/reset-password", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const email = requireEmail(body);
    const resetToken = requireText(body, "reset_token", 512);
    const newPassword = requireNewPassword(body);
    const admin = statements.findAdminByEmail.get(email);
    const reset = admin
      ? statements.findPasswordReset.get(hash(resetToken), "admin")
      : null;
    if (!admin || !reset || reset.actor_id !== admin.id || Date.parse(reset.expires_at) <= Date.now()) {
      throw new HttpError(400, "Jeton de réinitialisation invalide ou expiré.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.updateAdminPassword.run(hashPassword(newPassword), 0, nowIso(), admin.id);
      statements.consumePasswordReset.run(nowIso(), reset.id);
      statements.revokeActorSessions.run(nowIso(), "admin", admin.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    logEvent(request, null, "admin_password_reset", null, null, { admin_id: admin.id });
    return { ok: true };
  }),

  route("POST", "/v1/reseller/auth/login", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const email = requireEmail(body);
    const password = requirePasswordInput(body);
    const reseller = statements.findResellerByEmail.get(email);
    if (!reseller) {
      crypto.scryptSync(password, crypto.randomBytes(16), 64);
      throw new HttpError(401, "Email ou mot de passe incorrect.");
    }
    assertLoginAllowed(reseller);
    if (resellerStatus(reseller) !== "active" || !verifyPassword(password, reseller.password_hash)) {
      recordFailedLogin("reseller", reseller);
      throw new HttpError(401, "Email ou mot de passe incorrect.");
    }
    const timestampValue = nowIso();
    statements.resellerLoginSucceeded.run(timestampValue, timestampValue, timestampValue, reseller.id);
    const session = createSession(request, "reseller", reseller.id, 24 * 7);
    logEvent(request, null, "reseller_login", null, null, { reseller_id: reseller.id });
    return {
      session_token: session.token,
      expires_at: session.expires_at,
      reseller: resellerResponse(statements.findResellerById.get(reseller.id))
    };
  }),

  route("GET", "/v1/reseller/auth/me", async (request) => {
    const reseller = requireReseller(request, true);
    return { reseller: resellerResponse(reseller) };
  }),

  route("POST", "/v1/reseller/auth/logout", async (request) => {
    requireReseller(request, true);
    const session = sessionActor(request, "reseller");
    if (session) statements.revokeSession.run(nowIso(), session.id);
    return { ok: true };
  }),

  route("POST", "/v1/reseller/auth/change-password", async (request, body) => {
    const reseller = requireReseller(request, true);
    const currentPassword = requirePasswordInput(body, "current_password");
    const newPassword = requireNewPassword(body);
    if (!reseller.password_hash || !verifyPassword(currentPassword, reseller.password_hash)) {
      throw new HttpError(401, "Mot de passe actuel incorrect.");
    }
    statements.updateResellerPassword.run(hashPassword(newPassword), 0, nowIso(), reseller.id);
    statements.revokeActorSessions.run(nowIso(), "reseller", reseller.id);
    const session = createSession(request, "reseller", reseller.id, 24 * 7);
    logEvent(request, null, "reseller_password_changed", null, null, { reseller_id: reseller.id });
    return {
      session_token: session.token,
      expires_at: session.expires_at,
      reseller: resellerResponse(statements.findResellerById.get(reseller.id))
    };
  }),

  route("POST", "/v1/reseller/auth/reset-password", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const email = requireEmail(body);
    const resetToken = requireText(body, "reset_token", 512);
    const newPassword = requireNewPassword(body);
    const reseller = statements.findResellerByEmail.get(email);
    const reset = reseller
      ? statements.findPasswordReset.get(hash(resetToken), "reseller")
      : null;
    if (!reseller || !reset || reset.actor_id !== reseller.id || Date.parse(reset.expires_at) <= Date.now()) {
      throw new HttpError(400, "Jeton de réinitialisation invalide ou expiré.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.updateResellerPassword.run(hashPassword(newPassword), 0, nowIso(), reseller.id);
      statements.consumePasswordReset.run(nowIso(), reset.id);
      statements.revokeActorSessions.run(nowIso(), "reseller", reseller.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    logEvent(request, null, "reseller_password_reset", null, null, { reseller_id: reseller.id });
    return { ok: true };
  }),

  route("POST", "/v1/admin/admins", async (request, body) => {
    const currentAdmin = requireAdmin(request, ["owner"]);
    const email = requireEmail(body);
    if (statements.findAdminByEmail.get(email)) throw new HttpError(409, "Cet administrateur existe déjà.");
    const role = String(body.role ?? "admin");
    if (!["owner", "admin", "support"].includes(role)) throw new HttpError(400, "Rôle invalide.");
    const temporaryPassword = body.temporary_password
      ? requirePasswordInput(body, "temporary_password")
      : generateTemporaryPassword();
    const adminId = crypto.randomUUID();
    const createdAt = nowIso();
    statements.insertAdmin.run(
      adminId,
      email,
      requireText(body, "name", 200),
      hashPassword(temporaryPassword),
      role,
      1,
      createdAt,
      createdAt
    );
    logEvent(request, null, "admin_created", null, null, {
      admin_id: adminId,
      created_by: currentAdmin.id,
      role
    });
    return {
      admin: adminResponse(statements.findAdminById.get(adminId)),
      temporary_password: temporaryPassword
    };
  }),

  route("POST", "/v1/admin/admins/list", async (request) => {
    requireAdmin(request, ["owner"]);
    return { admins: statements.listAdmins.all().map(adminResponse) };
  }),

  route("POST", "/v1/admin/admins/password-reset", async (request, body) => {
    const currentAdmin = requireAdmin(request, ["owner"]);
    const target = body.admin_id
      ? statements.findAdminById.get(String(body.admin_id))
      : statements.findAdminByEmail.get(requireEmail(body));
    if (!target) throw new HttpError(404, "Administrateur introuvable.");
    const reset = createPasswordReset("admin", target.id, currentAdmin.id);
    logEvent(request, null, "admin_password_reset_issued", null, null, {
      admin_id: target.id,
      created_by: currentAdmin.id
    });
    return { admin: adminResponse(target), ...reset };
  }),

  route("POST", "/v1/admin/resellers/password-reset", async (request, body) => {
    const currentAdmin = requireAdmin(request, ["owner", "admin"]);
    const reseller = body.reseller_id
      ? statements.findResellerById.get(String(body.reseller_id))
      : statements.findResellerByEmail.get(requireEmail(body));
    if (!reseller) throw new HttpError(404, "Revendeur introuvable.");
    const reset = createPasswordReset("reseller", reseller.id, currentAdmin.id);
    logEvent(request, null, "reseller_password_reset_issued", null, null, {
      reseller_id: reseller.id,
      created_by: currentAdmin.id
    });
    return { reseller: resellerResponse(reseller), ...reset };
  }),

  route("POST", "/v1/admin/licenses/list", async (request, body) => {
    requireAdmin(request, ["owner", "admin", "support"]);
    const limit = body.limit === undefined ? 200 : requireInteger(body, "limit", 1, 1000);
    const licenses = statements.listLicenses.all(limit).map((license) => ({
      ...license,
      status: effectiveLicenseStatus(license),
      duration_days: Number(license.duration_days),
      router_limit: Number(license.router_limit),
      max_devices: Number(license.max_devices),
      router_count: Number(license.router_count),
      device_count: Number(license.device_count)
    }));
    return { licenses };
  }),

  route("POST", "/v1/admin/licenses/detail", async (request, body) => {
    requireAdmin(request, ["owner", "admin", "support"]);
    const license = statements.findLicenseById.get(requireText(body, "license_id", 128));
    if (!license) throw new HttpError(404, "Licence introuvable.");
    return {
      license: {
        ...licensePlanResponse(license),
        license_id: license.id,
        status: effectiveLicenseStatus(license),
        license_type: license.license_type,
        reseller_id: license.reseller_id,
        label: license.label,
        issued_at: license.issued_at,
        activation_deadline_at: license.activation_deadline_at,
        activated_at: license.activated_at,
        expires_at: license.expires_at,
        router_count: Number(license.router_count),
        device_count: Number(license.device_count)
      },
      activations: statements.listActivations.all(license.id)
    };
  }),

  route("POST", "/v1/admin/payments/list", async (request, body) => {
    requireAdmin(request, ["owner", "admin", "support"]);
    const limit = body.limit === undefined ? 200 : requireInteger(body, "limit", 1, 1000);
    return { payments: statements.listPayments.all(limit) };
  }),

  route("POST", "/v1/admin/payments/reconcile", async (request, body) => {
    requireAdmin(request, ["owner", "admin"]);
    const order = statements.findPaymentOrderById.get(requireText(body, "order_id", 128));
    if (!order) throw new HttpError(404, "Commande introuvable.");
    const payment = await getIpayPaymentStatus(order);
    const reconciled = processVerifiedPayment(request, order, payment);
    return { order: paymentOrderResponse(reconciled, false) };
  }),

  route("POST", "/v1/licenses/activate", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const key = requireText(body, "key", 64);
    const accountId = requireText(body, "account_id", 128);
    const deviceId = requireText(body, "device_id", 256);
    const deviceProof = requireText(body, "device_proof", 512);
    const installId = requireText(body, "install_id", 256);
    const deviceIdHash = hash(deviceId);
    let license = statements.findLicenseByKey.get(hash(normalizeKey(key)));

    if (!license) throw new HttpError(404, "Clé d'activation invalide.");
    if (license.status === "revoked") throw new HttpError(403, "Cette licence a été révoquée.");
    if (license.status === "issued"
      && license.activation_deadline_at
      && Date.parse(license.activation_deadline_at) <= Date.now()) {
      statements.touchLicense.run("expired", nowIso(), license.router_count, license.device_count, license.id);
      throw new HttpError(403, "La date limite d'activation de cette clé est dépassée.");
    }
    if (license.status === "expired") throw new HttpError(403, "Cette licence a expiré.");
    if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) {
      statements.touchLicense.run("expired", nowIso(), license.router_count, license.device_count, license.id);
      throw new HttpError(403, "Cette licence a expiré.");
    }

    let activation = statements.findActivationByDevice.get(license.id, accountId, deviceIdHash, installId);
    const activationToken = randomToken();
    if (activation) {
      if (!sameHash(deviceProof, activation.device_proof_hash)) {
        logEvent(request, license.id, "activation_rejected_device_mismatch", accountId, deviceIdHash);
        throw new HttpError(409, "L'identité de cet appareil ne correspond pas à l'activation existante.");
      }
      if (activation.status !== "active"
        && Number(statements.countDevices.get(license.id).count) >= Number(license.max_devices ?? 1)) {
        throw new HttpError(409, "Le nombre maximal de PC autorisés par cette licence est atteint.");
      }
      statements.rotateActivationToken.run(hash(activationToken), hash(deviceProof), nowIso(), activation.id);
    } else {
      const deviceCountBefore = Number(statements.countDevices.get(license.id).count);
      if (deviceCountBefore >= Number(license.max_devices ?? 1)) {
        logEvent(request, license.id, "activation_rejected_device_limit", accountId, deviceIdHash);
        throw new HttpError(409, "Le nombre maximal de PC autorisés par cette licence est atteint.");
      }
      activation = { id: crypto.randomUUID() };
      const activatedAt = nowIso();
      statements.insertActivation.run(
        activation.id,
        license.id,
        accountId,
        deviceIdHash,
        hash(deviceProof),
        installId,
        hash(activationToken),
        activatedAt,
        activatedAt
      );
      logEvent(request, license.id, "device_activated", accountId, deviceIdHash);
    }

    if (license.status === "issued") {
      const activatedAt = nowIso();
      const expiresAt = new Date(Date.now() + Number(license.duration_days) * 86_400_000).toISOString();
      statements.startLicense.run(activatedAt, expiresAt, activatedAt, license.id);
      license = { ...license, status: "active", activated_at: activatedAt, expires_at: expiresAt };
    }

    const routerCount = syncRouterIds(license.id, activation.id, body.router_ids ?? [], Number(license.router_limit));
    const deviceCount = Number(statements.countDevices.get(license.id).count);
    statements.touchLicense.run("active", nowIso(), routerCount, deviceCount, license.id);
    const result = responseForLicense({ ...license, status: "active" }, activation.id, routerCount, deviceCount);
    if (!result.valid) throw new HttpError(403, "La limite globale de routeurs est dépassée.", result);
    return { ...result, activation_token: activationToken };
  }),

  route("POST", "/v1/licenses/validate", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const licenseId = requireText(body, "license_id", 128);
    const activationToken = requireText(body, "activation_token", 512);
    const accountId = requireText(body, "account_id", 128);
    const deviceId = requireText(body, "device_id", 256);
    const deviceProof = requireText(body, "device_proof", 512);
    const installId = requireText(body, "install_id", 256);
    const license = statements.findLicenseById.get(licenseId);
    const activation = statements.findActivationByToken.get(licenseId, hash(activationToken));

    if (!license || !activation || activation.status !== "active"
      || activation.account_id !== accountId || activation.install_id !== installId
      || !sameHash(deviceId, activation.device_id_hash)
      || !sameHash(deviceProof, activation.device_proof_hash)) {
      throw new HttpError(401, "Licence ou appareil non reconnu.");
    }
    if (license.status === "revoked") throw new HttpError(403, "Cette licence a été révoquée.");

    const expired = !license.expires_at || Date.parse(license.expires_at) <= Date.now();
    const routerCount = syncRouterIds(license.id, activation.id, body.router_ids, Number(license.router_limit));
    const deviceCount = Number(statements.countDevices.get(license.id).count);
    const status = expired ? "expired" : "active";
    statements.touchActivation.run(nowIso(), activation.id);
    statements.touchLicense.run(status, nowIso(), routerCount, deviceCount, license.id);
    const result = responseForLicense({ ...license, status }, activation.id, routerCount, deviceCount);
    if (!result.valid) {
      throw new HttpError(
        403,
        result.status === "expired" ? "Cette licence a expiré." : "La limite globale de routeurs est dépassée.",
        result
      );
    }
    logEvent(request, license.id, "validated", accountId, activation.device_id_hash, {
      activation_id: activation.id,
      router_count: routerCount
    });
    return result;
  }),

  route("POST", "/v1/vpn/bootstrap", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { activation, license } = requireLicensedDevice(body);
    const tenant = await vpnHubRequest("/v1/tenants", {
      account_id: license.id,
      operator_limit: Number(license.max_devices ?? 1),
      router_limit: Number(license.router_limit)
    });
    logEvent(request, license.id, "vpn_bootstrapped", activation.account_id, activation.device_id_hash);
    return {
      address_pool: tenant.address_pool,
      server_endpoint: tenant.server_endpoint,
      server_port: tenant.server_port,
      server_public_key: tenant.server_public_key
    };
  }),

  route("POST", "/v1/saas/vpn/bootstrap", async (request) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { organization, subscription, user } = requireOrganizationPermission(request, "global.routers.select", {
      requireActiveSubscription: true
    });
    const tenant = await vpnHubRequest("/v1/tenants", {
      account_id: organization.id,
      operator_limit: organizationOperatorLimitForHub(organization.id, subscription),
      router_limit: Number(subscription.router_limit)
    });
    logEvent(request, null, "saas_vpn_bootstrapped", organization.id, null, {
      organization_user_id: user.id
    });
    return {
      address_pool: tenant.address_pool,
      server_endpoint: tenant.server_endpoint,
      server_port: tenant.server_port,
      server_public_key: tenant.server_public_key
    };
  }),

  route("POST", "/v1/saas/devices/register", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const context = requireOrganizationPermission(request, "global.routers.select", {
      requireActiveSubscription: true
    });
    const { organization, subscription, user } = context;
    const installationId = requireInstallationId(body);
    const publicKey = requireVpnPublicKey(body);
    const name = String(body.name ?? "").trim();
    const platform = normalizeDevicePlatform(body.platform);
    const osVersion = String(body.os_version ?? body.osVersion ?? "").trim() || null;
    const appVersion = String(body.app_version ?? body.appVersion ?? "").trim();
    if (!name || name.length > 200 || !appVersion || appVersion.length > 64
      || (osVersion && osVersion.length > 200)) {
      throw new HttpError(400, "Informations de l'appareil invalides.", {
        code: "DEVICE_METADATA_INVALID"
      });
    }

    let device = statements.findOrganizationDeviceByInstallation.get(organization.id, installationId);
    const maxDevices = organizationDeviceLimitForContext(context);
    const deviceAccessScope = organizationDeviceAccessScope(context);
    const now = nowIso();
    let transferredFromUserId = null;
    if (device && device.registered_by_user_id !== user.id) {
      const existingPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
      // Une même machine peut avoir servi à un propriétaire puis à un membre
      // invité. Nous autorisons ce passage uniquement si elle prouve posséder
      // déjà la même identité WireGuard : aucun secret ni nouvel accès n'est
      // créé. Cela évite le blocage des installations historiques partagées.
      if (!existingPeer || existingPeer.public_key !== publicKey || device.status === "revoked") {
        throw new HttpError(409, "Cette installation TicketPro appartient déjà à un autre membre.", {
          code: "DEVICE_INSTALLATION_OWNED_BY_ANOTHER_USER"
        });
      }
      transferredFromUserId = device.registered_by_user_id;
      statements.transferOrganizationDeviceRegistration.run(
        user.id,
        now,
        now,
        organization.id,
        device.id
      );
      device = statements.findOrganizationDeviceById.get(organization.id, device.id);
    }
    if (!device) {
      const requestedReplacementDeviceId = typeof body.replacement_device_id === "string"
        ? body.replacement_device_id.trim()
        : "";
      if (requestedReplacementDeviceId) {
        const requestedReplacement = statements.findOrganizationDeviceById.get(
          organization.id,
          requestedReplacementDeviceId
        );
        if (
          requestedReplacement
          && requestedReplacement.status !== "revoked"
          && requestedReplacement.registered_by_user_id !== user.id
          && !organizationContextHasPermission(context, "global.vpn")
        ) {
          throw new HttpError(403, "Vous ne pouvez remplacer que l'un de vos propres appareils.", {
            code: "DEVICE_REPLACEMENT_FORBIDDEN"
          });
        }
      }
      const registeredCount = organizationDeviceCountForContext(context);
      if (maxDevices !== null && registeredCount >= maxDevices) {
        const replacementDeviceId = requestedReplacementDeviceId;
        if (!replacementDeviceId) {
          throw new HttpError(409, "La limite de postes sécurisés du propriétaire est atteinte.", {
            code: "DEVICE_LIMIT_REACHED",
            active_count: registeredCount,
            max_devices: maxDevices
          });
        }
        const replacedDevice = statements.findOrganizationDeviceById.get(
          organization.id,
          replacementDeviceId
        );
        if (!replacedDevice || replacedDevice.status === "revoked") {
          throw new HttpError(404, "L'appareil à remplacer est introuvable.", {
            code: "REPLACEMENT_DEVICE_NOT_FOUND"
          });
        }
        if (
          replacedDevice.registered_by_user_id !== user.id
          && !organizationContextHasPermission(context, "global.vpn")
        ) {
          throw new HttpError(403, "Vous ne pouvez remplacer que l'un de vos propres appareils.", {
            code: "DEVICE_REPLACEMENT_FORBIDDEN"
          });
        }
        const replacedPeer = statements.findOrganizationVpnPeerByDevice.get(
          organization.id,
          replacedDevice.id
        );
        if (replacedPeer) {
          await vpnHubRequest("/v1/peers", {
            account_id: organization.id,
            action: "revoke",
            name: replacedDevice.name,
            peer_type: "operator",
            public_key: replacedPeer.public_key,
            resource_id: `device:${replacedDevice.id}`
          });
          statements.markOrganizationVpnPeerDisabled.run(now, now, replacedDevice.id);
        }
        statements.revokeOrganizationDevice.run(now, now, organization.id, replacedDevice.id);
        logEvent(request, null, "saas_device_replaced", organization.id, null, {
          new_installation_id_hash: hash(installationId),
          replaced_device_id: replacedDevice.id,
          organization_user_id: user.id
        });
      }
      statements.insertOrganizationDevice.run(
        crypto.randomUUID(), organization.id, user.id, installationId, name,
        platform, osVersion, appVersion, now, now, now
      );
      device = statements.findOrganizationDeviceByInstallation.get(organization.id, installationId);
    }
    if (!device) throw new HttpError(500, "Impossible d'enregistrer cet appareil.");
    if (device.status === "revoked") {
      throw new HttpError(409, "Cet appareil a été révoqué.", {
        code: "DEVICE_REVOKED",
        device_id: device.id
      });
    }
    statements.touchOrganizationDevice.run(
      name, platform, osVersion, appVersion, now, now, organization.id, device.id
    );
    device = statements.findOrganizationDeviceById.get(organization.id, device.id);

    let vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    if (vpnPeer && vpnPeer.public_key !== publicKey) {
      throw new HttpError(409, "La clé VPN de cet appareil a changé. Une rotation explicite est requise.", {
        code: "DEVICE_KEY_ROTATION_REQUIRED",
        device_id: device.id,
        key_version: Number(vpnPeer.key_version)
      });
    }
    if (!vpnPeer) {
      statements.insertOrganizationVpnPeer.run(
        crypto.randomUUID(), device.id, publicKey, now, now
      );
      vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
      if (!vpnPeer) {
        throw new HttpError(409, "Cette clé VPN appartient déjà à un autre appareil.", {
          code: "VPN_PUBLIC_KEY_ALREADY_REGISTERED"
        });
      }
    }
    statements.markOrganizationVpnPeerPending.run("enabled", now, device.id);

    let tenant;
    let provisioned;
    try {
      tenant = await vpnHubRequest("/v1/tenants", {
        account_id: organization.id,
        operator_limit: organizationOperatorLimitForHub(organization.id, subscription),
        router_limit: Number(subscription.router_limit)
      });
      await revokeUnmanagedOrganizationOperatorPeers(organization.id);
      provisioned = await vpnHubRequest("/v1/peers", {
        account_id: organization.id,
        action: "upsert",
        name,
        peer_type: "operator",
        persistent_keepalive: 25,
        public_key: publicKey,
        resource_id: `device:${device.id}`
      });
    } catch (error) {
      statements.markOrganizationVpnPeerError.run("VPN_HUB_PROVISIONING_FAILED", nowIso(), device.id);
      throw error;
    }
    statements.markOrganizationVpnPeerEnabled.run(
      provisioned.assigned_address, nowIso(), device.id
    );
    vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    const joinedDevice = statements.listOrganizationDevices
      .all(organization.id)
      .find((item) => item.id === device.id);
    if (!joinedDevice) throw new HttpError(500, "Impossible de relire cet appareil.");
    logEvent(request, null, "saas_device_registered", organization.id, null, {
      device_id: device.id,
      installation_id_hash: hash(installationId),
      key_version: Number(vpnPeer.key_version),
      organization_user_id: user.id,
      transferred_from_user_id: transferredFromUserId
    });
    return {
      device: organizationDeviceResponse(joinedDevice),
      active_device_count: organizationDeviceCountForContext(context),
      device_limit_mode: organizationDeviceLimitModeForContext(context),
      max_devices: maxDevices,
      device_access_scope: deviceAccessScope,
      vpn: {
        address: provisioned.assigned_address,
        allowed_ips: VPN_CLIENT_ALLOWED_IPS,
        config_version: Number(vpnPeer.config_version),
        endpoint: tenant.server_endpoint,
        gateway_id: vpnPeer.gateway_id,
        gateway_public_key: tenant.server_public_key,
        persistent_keepalive: 25,
        port: tenant.server_port
      }
    };
  }),

  route("GET", "/v1/saas/devices", async (request) => {
    const context = requireOrganizationPermission(request, "global.vpn");
    const { organization, user } = context;
    const isOwner = organizationDeviceAccessScope(context) === "owner";
    return {
      devices: (isOwner
        ? statements.listOrganizationDevices.all(organization.id)
        : statements.listOrganizationDevicesForUser.all(organization.id, user.id)
      ).map(organizationDeviceResponse),
      active_count: organizationDeviceCountForContext(context),
      collaborator_device_count: isOwner
        ? Number(statements.countOrganizationMemberDevices.get(organization.id).count)
        : 0,
      device_access_scope: organizationDeviceAccessScope(context),
      device_limit_mode: organizationDeviceLimitModeForContext(context),
      max_devices: organizationDeviceLimitForContext(context)
    };
  }),

  route("POST", "/v1/saas/devices/heartbeat", async (request, body) => {
    const { organization, user } = requireOrganizationPermission(request, "global.routers.select");
    const installationId = requireInstallationId(body);
    const appVersion = String(body.app_version ?? body.appVersion ?? "").trim();
    if (!appVersion || appVersion.length > 64) {
      throw new HttpError(400, "Version d'application invalide.");
    }
    const device = statements.findOrganizationDeviceByInstallation.get(organization.id, installationId);
    if (!device) throw new HttpError(404, "Appareil introuvable.", { code: "DEVICE_NOT_FOUND" });
    if (device.registered_by_user_id !== user.id) {
      throw new HttpError(403, "Cet appareil n'appartient pas à votre accès TicketPro.", {
        code: "DEVICE_HEARTBEAT_FORBIDDEN"
      });
    }
    const now = nowIso();
    statements.heartbeatOrganizationDevice.run(appVersion, now, now, organization.id, device.id);
    const subscription = currentOrganizationSubscription(organization.id);
    return {
      ok: true,
      device_id: device.id,
      status: device.status,
      vpn_access: device.status !== "revoked"
        && organizationSubscriptionLifecycle(subscription).isActive
    };
  }),

  route("POST", "/v1/saas/devices/recover", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const context = requireOrganizationPermission(request, "global.vpn", {
      requireActiveSubscription: true
    });
    const { organization, subscription, user, membership } = context;
    if (membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut restaurer le dernier appareil.", {
        code: "DEVICE_RECOVERY_OWNER_REQUIRED"
      });
    }
    const password = requirePasswordInput(body, "password");
    if (!verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, "Mot de passe incorrect.", {
        code: "DEVICE_RECOVERY_PASSWORD_INVALID"
      });
    }
    const installationId = requireInstallationId(body);
    const previousPublicKey = requireVpnPublicKey({ public_key: body.previous_public_key });
    const newPublicKey = requireVpnPublicKey({ public_key: body.public_key });
    if (previousPublicKey === newPublicKey) {
      throw new HttpError(400, "La récupération exige une nouvelle clé VPN.", {
        code: "VPN_KEY_ROTATION_REQUIRES_NEW_KEY"
      });
    }
    let device = statements.findOrganizationDeviceByInstallation.get(
      organization.id,
      installationId
    );
    if (!device) {
      throw new HttpError(404, "Appareil introuvable.", { code: "DEVICE_NOT_FOUND" });
    }
    let vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    if (!vpnPeer) {
      throw new HttpError(404, "Pair VPN introuvable.", { code: "VPN_PEER_NOT_FOUND" });
    }
    const alreadyRecovered = device.status !== "revoked" && vpnPeer.public_key === newPublicKey;
    if (!alreadyRecovered) {
      if (device.status !== "revoked") {
        throw new HttpError(409, "Cet appareil est déjà actif.", {
          code: "DEVICE_ALREADY_ACTIVE"
        });
      }
      if (vpnPeer.public_key !== previousPublicKey) {
        throw new HttpError(409, "L'ancienne clé ne correspond plus à cet appareil.", {
          code: "VPN_KEY_VERSION_CONFLICT",
          key_version: Number(vpnPeer.key_version)
        });
      }
      const activeCount = Number(
        statements.countOrganizationOwnerDevices.get(organization.id).count
      );
      if (activeCount !== 0) {
        throw new HttpError(409, "Un autre appareil actif peut gérer cette révocation.", {
          code: "DEVICE_RECOVERY_REQUIRES_NO_ACTIVE_DEVICE",
          active_count: activeCount
        });
      }
      const conflictingPeer = statements.findOrganizationVpnPeerByPublicKey.get(
        newPublicKey,
        organization.id
      );
      if (conflictingPeer && conflictingPeer.device_id !== device.id) {
        throw new HttpError(409, "Cette clé VPN appartient déjà à un autre appareil.", {
          code: "VPN_PUBLIC_KEY_ALREADY_REGISTERED"
        });
      }
    }

    const maxDevices = organizationDeviceLimitForContext(context);
    const tenant = await vpnHubRequest("/v1/tenants", {
      account_id: organization.id,
      operator_limit: organizationOperatorLimitForHub(organization.id, subscription),
      router_limit: Number(subscription.router_limit)
    });
    const sharedPeers = alreadyRecovered
      ? []
      : statements.listSharedOrganizationVpnPeersByPublicKey.all(previousPublicKey);
    if (!sharedPeers.some((sharedPeer) => sharedPeer.device_id === device.id)) {
      sharedPeers.push({ ...vpnPeer, device_id: device.id, desired_state: "enabled" });
    }
    for (const sharedPeer of sharedPeers) {
      statements.markOrganizationVpnPeerPending.run(
        sharedPeer.device_id === device.id ? "enabled" : sharedPeer.desired_state,
        nowIso(),
        sharedPeer.device_id
      );
    }
    let provisioned;
    try {
      provisioned = await vpnHubRequest("/v1/peers", {
        account_id: organization.id,
        action: alreadyRecovered ? "upsert" : "rotate_shared",
        allow_revoked_current: !alreadyRecovered,
        name: device.name,
        peer_type: "operator",
        persistent_keepalive: 25,
        previous_public_key: alreadyRecovered ? undefined : previousPublicKey,
        public_key: newPublicKey,
        resource_id: `device:${device.id}`
      });
    } catch (error) {
      for (const sharedPeer of sharedPeers) {
        statements.markOrganizationVpnPeerError.run(
          "VPN_DEVICE_RECOVERY_FAILED",
          nowIso(),
          sharedPeer.device_id
        );
      }
      throw error;
    }

    const now = nowIso();
    if (!alreadyRecovered) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const restored = statements.restoreOrganizationDevice.run(
          now,
          now,
          organization.id,
          device.id
        );
        let rotatedCount = 0;
        for (const sharedPeer of sharedPeers) {
          const rotated = sharedPeer.device_id === device.id
            ? statements.rotateOrganizationVpnPeer.run(
                newPublicKey,
                now,
                sharedPeer.device_id,
                previousPublicKey
              )
            : statements.rotateOrganizationVpnPeerPreservingDesiredState.run(
                newPublicKey,
                now,
                sharedPeer.device_id,
                previousPublicKey
              );
          rotatedCount += Number(rotated.changes);
        }
        if (Number(restored.changes) !== 1 || rotatedCount !== sharedPeers.length) {
          throw new Error("Conflit pendant la récupération de l'appareil.");
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    statements.markOrganizationVpnPeerEnabled.run(
      provisioned.assigned_address ?? vpnPeer.vpn_ip,
      nowIso(),
      device.id
    );
    device = statements.findOrganizationDeviceById.get(organization.id, device.id);
    vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    const joinedDevice = statements.listOrganizationDevices
      .all(organization.id)
      .find((item) => item.id === device.id);
    logEvent(request, null, "saas_device_recovered", organization.id, null, {
      device_id: device.id,
      key_version: Number(vpnPeer.key_version),
      organization_user_id: user.id,
      previous_public_key_hash: hash(previousPublicKey),
      public_key_hash: hash(newPublicKey)
    });
    return {
      device: organizationDeviceResponse(joinedDevice),
      active_device_count: organizationDeviceCountForContext(context),
      device_limit_mode: organizationDeviceLimitModeForContext(context),
      max_devices: maxDevices,
      vpn: {
        address: provisioned.assigned_address ?? vpnPeer.vpn_ip,
        allowed_ips: VPN_CLIENT_ALLOWED_IPS,
        config_version: Number(vpnPeer.config_version),
        endpoint: tenant.server_endpoint,
        gateway_id: vpnPeer.gateway_id,
        gateway_public_key: tenant.server_public_key,
        persistent_keepalive: 25,
        port: tenant.server_port
      }
    };
  }),

  route("POST", "/v1/saas/devices/rotate-key", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const context = requireOrganizationPermission(request, "global.routers.select", {
      requireActiveSubscription: true
    });
    const { organization, subscription, user, membership } = context;
    const installationId = requireInstallationId(body);
    const previousPublicKey = requireVpnPublicKey({ public_key: body.previous_public_key });
    const newPublicKey = requireVpnPublicKey({ public_key: body.public_key });
    if (previousPublicKey === newPublicKey) {
      throw new HttpError(400, "La nouvelle clé doit être différente de l'ancienne.", {
        code: "VPN_KEY_ROTATION_REQUIRES_NEW_KEY"
      });
    }
    const device = statements.findOrganizationDeviceByInstallation.get(
      organization.id,
      installationId
    );
    if (!device || device.status === "revoked") {
      throw new HttpError(404, "Appareil actif introuvable.", { code: "DEVICE_NOT_FOUND" });
    }
    if (device.registered_by_user_id !== user.id && membership.authority_role !== "owner") {
      throw new HttpError(403, "Vous ne pouvez renouveler que la clé de votre propre appareil.", {
        code: "DEVICE_KEY_ROTATION_FORBIDDEN"
      });
    }
    let vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    if (!vpnPeer) throw new HttpError(404, "Pair VPN introuvable.", { code: "VPN_PEER_NOT_FOUND" });
    const alreadyRotated = vpnPeer.public_key === newPublicKey;
    if (!alreadyRotated && vpnPeer.public_key !== previousPublicKey) {
      throw new HttpError(409, "La clé VPN active a changé. Actualisez l'appareil avant de réessayer.", {
        code: "VPN_KEY_VERSION_CONFLICT",
        key_version: Number(vpnPeer.key_version)
      });
    }
    const conflictingPeer = statements.findOrganizationVpnPeerByPublicKey.get(
      newPublicKey,
      organization.id
    );
    if (conflictingPeer && conflictingPeer.device_id !== device.id) {
      throw new HttpError(409, "Cette clé VPN appartient déjà à un autre appareil.", {
        code: "VPN_PUBLIC_KEY_ALREADY_REGISTERED"
      });
    }

    const maxDevices = organizationDeviceLimitForContext(context);
    const tenant = await vpnHubRequest("/v1/tenants", {
      account_id: organization.id,
      operator_limit: organizationOperatorLimitForHub(organization.id, subscription),
      router_limit: Number(subscription.router_limit)
    });
    const sharedPeers = alreadyRotated
      ? []
      : statements.listSharedOrganizationVpnPeersByPublicKey.all(previousPublicKey);
    for (const sharedPeer of sharedPeers) {
      statements.markOrganizationVpnPeerPending.run(
        sharedPeer.desired_state,
        nowIso(),
        sharedPeer.device_id
      );
    }
    if (sharedPeers.length === 0) {
      statements.markOrganizationVpnPeerPending.run("enabled", nowIso(), device.id);
    }
    let provisioned;
    try {
      provisioned = await vpnHubRequest("/v1/peers", {
        account_id: organization.id,
        action: alreadyRotated ? "upsert" : "rotate_shared",
        name: device.name,
        peer_type: "operator",
        persistent_keepalive: 25,
        previous_public_key: alreadyRotated ? undefined : previousPublicKey,
        public_key: newPublicKey,
        resource_id: `device:${device.id}`
      });
    } catch (error) {
      for (const sharedPeer of sharedPeers) {
        statements.markOrganizationVpnPeerError.run(
          "VPN_KEY_ROTATION_FAILED",
          nowIso(),
          sharedPeer.device_id
        );
      }
      if (sharedPeers.length === 0) {
        statements.markOrganizationVpnPeerError.run("VPN_KEY_ROTATION_FAILED", nowIso(), device.id);
      }
      throw error;
    }
    if (!alreadyRotated) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sharedPeer of sharedPeers) {
          const rotated = statements.rotateOrganizationVpnPeerPreservingDesiredState.run(
            newPublicKey,
            nowIso(),
            sharedPeer.device_id,
            previousPublicKey
          );
          if (Number(rotated.changes) !== 1) {
            throw new Error("Conflit pendant la rotation VPN multi-organisation.");
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    statements.markOrganizationVpnPeerEnabled.run(
      provisioned.assigned_address ?? vpnPeer.vpn_ip,
      nowIso(),
      device.id
    );
    vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    const joinedDevice = statements.listOrganizationDevices
      .all(organization.id)
      .find((item) => item.id === device.id);
    logEvent(request, null, "saas_device_vpn_key_rotated", organization.id, null, {
      device_id: device.id,
      key_version: Number(vpnPeer.key_version),
      organization_user_id: user.id,
      previous_public_key_hash: hash(previousPublicKey),
      public_key_hash: hash(newPublicKey)
    });
    return {
      device: organizationDeviceResponse(joinedDevice),
      active_device_count: organizationDeviceCountForContext(context),
      device_limit_mode: organizationDeviceLimitModeForContext(context),
      max_devices: maxDevices,
      vpn: {
        address: provisioned.assigned_address ?? vpnPeer.vpn_ip,
        allowed_ips: VPN_CLIENT_ALLOWED_IPS,
        config_version: Number(vpnPeer.config_version),
        endpoint: tenant.server_endpoint,
        gateway_id: vpnPeer.gateway_id,
        gateway_public_key: tenant.server_public_key,
        persistent_keepalive: 25,
        port: tenant.server_port
      }
    };
  }),

  route("POST", "/v1/saas/devices/revoke", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const context = requireOrganizationPermission(request, "global.vpn");
    const { organization, user, membership } = context;
    const deviceId = requireText(body, "device_id", 200);
    const device = statements.findOrganizationDeviceById.get(organization.id, deviceId);
    if (!device) throw new HttpError(404, "Appareil introuvable.", { code: "DEVICE_NOT_FOUND" });
    if (device.registered_by_user_id !== user.id && membership.authority_role !== "owner") {
      throw new HttpError(403, "Seul le propriétaire peut révoquer l'appareil d'un autre membre.", {
        code: "DEVICE_REVOCATION_FORBIDDEN"
      });
    }
    const vpnPeer = statements.findOrganizationVpnPeerByDevice.get(organization.id, device.id);
    if (!vpnPeer) throw new HttpError(404, "Pair VPN introuvable.", { code: "VPN_PEER_NOT_FOUND" });
    const now = nowIso();
    statements.markOrganizationVpnPeerPending.run("disabled", now, device.id);
    try {
      await vpnHubRequest("/v1/peers", {
        account_id: organization.id,
        action: "revoke",
        name: device.name,
        peer_type: "operator",
        public_key: vpnPeer.public_key,
        resource_id: `device:${device.id}`
      });
    } catch (error) {
      statements.markOrganizationVpnPeerError.run("VPN_HUB_REVOCATION_FAILED", nowIso(), device.id);
      throw error;
    }
    statements.revokeOrganizationDevice.run(now, now, organization.id, device.id);
    statements.markOrganizationVpnPeerDisabled.run(now, now, device.id);
    logEvent(request, null, "saas_device_revoked", organization.id, null, {
      device_id: device.id,
      organization_user_id: user.id
    });
    return { ok: true, device_id: device.id, status: "revoked" };
  }),

  route("POST", "/v1/saas/vpn/peers", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { organization, user } = requireOrganizationPermission(request, "global.vpn", {
      requireActiveSubscription: true
    });
    const action = String(body.action ?? "");
    if (!["upsert", "revoke", "rotate"].includes(action)) throw new HttpError(400, "Action VPN invalide.");
    const publicKey = requireText(body, "public_key", 128);
    const resourceId = typeof body.resource_id === "string" && body.resource_id.trim()
      ? requireText(body, "resource_id", 200)
      : `legacy:${hash(publicKey)}`;
    const peer = await vpnHubRequest("/v1/peers", {
      account_id: organization.id,
      action,
      name: typeof body.name === "string" ? body.name.slice(0, 200) : "",
      peer_type: body.peer_type === "operator" ? "operator" : "router",
      persistent_keepalive: 25,
      previous_public_key: typeof body.previous_public_key === "string" ? body.previous_public_key : undefined,
      public_key: publicKey,
      resource_id: resourceId
    });
    logEvent(
      request,
      null,
      action === "revoke"
        ? "saas_vpn_peer_revoked"
        : action === "rotate" ? "saas_vpn_peer_rotated" : "saas_vpn_peer_upserted",
      organization.id,
      null,
      {
        organization_user_id: user.id,
        previous_public_key_hash: typeof body.previous_public_key === "string"
          ? hash(body.previous_public_key)
          : null,
        public_key_hash: hash(publicKey),
        resource_id: resourceId
      }
    );
    return {
      address_pool: peer.address_pool ?? null,
      assigned_address: peer.assigned_address ?? null,
      public_key: publicKey,
      replaced_public_keys: peer.replaced_public_keys ?? [],
      resource_id: peer.resource_id ?? resourceId,
      status: peer.status
    };
  }),

  route("GET", "/v1/saas/vpn/peers", async (request) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { organization, user } = requireOrganizationPermission(request, "global.vpn", {
      requireActiveSubscription: true
    });
    const result = await vpnHubRequest("/v1/peers/list", {
      account_id: organization.id
    });
    logEvent(request, null, "saas_vpn_peers_listed", organization.id, null, {
      organization_user_id: user.id
    });
    return {
      peers: Array.isArray(result.peers)
        ? result.peers
          .map((peer) => ({
            assigned_address: peer.assigned_address ?? null,
            connection_status: ["connected", "disconnected", "revoked"].includes(peer.connection_status)
              ? peer.connection_status
              : "configuration_error",
            last_handshake_at: peer.last_handshake_at ?? null,
            name: peer.name ?? "",
            peer_type: peer.peer_type === "operator" ? "operator" : "router",
            public_key: peer.public_key,
            resource_id: peer.resource_id ?? `legacy:${hash(peer.public_key)}`,
            revoked_at: peer.revoked_at ?? null,
            status: ["active", "disabled", "revoked"].includes(peer.status)
              ? peer.status
              : "disabled"
          }))
        : []
    };
  }),

  route("POST", "/v1/vpn/peers", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { activation, license } = requireLicensedDevice(body);
    const action = String(body.action ?? "");
    if (!["upsert", "revoke", "rotate"].includes(action)) throw new HttpError(400, "Action VPN invalide.");
    const publicKey = requireText(body, "public_key", 128);
    const resourceId = typeof body.resource_id === "string" && body.resource_id.trim()
      ? requireText(body, "resource_id", 200)
      : `legacy:${hash(publicKey)}`;
    const peer = await vpnHubRequest("/v1/peers", {
      account_id: license.id,
      action,
      name: typeof body.name === "string" ? body.name.slice(0, 200) : "",
      peer_type: body.peer_type === "operator" ? "operator" : "router",
      persistent_keepalive: 25,
      previous_public_key: typeof body.previous_public_key === "string" ? body.previous_public_key : undefined,
      public_key: publicKey,
      resource_id: resourceId
    });
    logEvent(request, license.id, action === "revoke"
      ? "vpn_peer_revoked"
      : action === "rotate" ? "vpn_peer_rotated" : "vpn_peer_upserted", activation.account_id, activation.device_id_hash, {
      public_key_hash: hash(publicKey),
      resource_id: resourceId
    });
    return {
      address_pool: peer.address_pool ?? null,
      assigned_address: peer.assigned_address ?? null,
      public_key: publicKey,
      replaced_public_keys: peer.replaced_public_keys ?? [],
      resource_id: peer.resource_id ?? resourceId,
      status: peer.status
    };
  }),

  route("POST", "/v1/admin/email/test", async (request, body) => {
    const admin = requireAdmin(request, ["owner", "admin"]);
    const transporter = getSmtpTransporter();
    if (!transporter) {
      throw new HttpError(503, "Le SMTP TicketPro n'est pas encore configuré.");
    }
    const recipient = body.email ? requireEmail(body) : admin.email;
    await transporter.verify();
    const result = await transporter.sendMail({
      from: { name: SMTP_FROM_NAME, address: SMTP_FROM_EMAIL },
      to: recipient,
      subject: "Test SMTP TicketPro réussi",
      text: `Le serveur TicketPro peut envoyer des emails via le SMTP LWS.\n\nTest effectué le ${nowIso()}.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h1>Test SMTP TicketPro réussi</h1>
          <p>Le serveur TicketPro peut envoyer des emails via le SMTP LWS.</p>
          <p>Test effectué le ${escapeHtml(nowIso())}.</p>
        </div>
      `,
      disableFileAccess: true,
      disableUrlAccess: true
    });
    logEvent(request, null, "smtp_test_sent", admin.id, null, {
      recipient_hash: hash(recipient),
      message_id_hash: hash(result.messageId ?? "")
    });
    return { ok: true, recipient };
  }),

  route("POST", "/v1/admin/subscription-notifications/run", async (request) => {
    requireAdmin(request, ["owner", "admin"]);
    return processSubscriptionNotifications();
  }),

  route("POST", "/v1/admin/plans", async (request, body) => {
    requireMaster(request);
    const planId = requireText(body, "id", 128);
    const code = requireText(body, "code", 64).toUpperCase();
    const name = requireText(body, "name", 200);
    const routerLimit = requireInteger(body, "router_limit", 1, 100_000);
    const durationDays = requireInteger(body, "duration_days", 1, 3650);
    const billingPeriod = String(body.billing_period ?? "monthly");
    if (!["monthly", "yearly", "custom"].includes(billingPeriod)) {
      throw new HttpError(400, "billing_period invalide.");
    }
    const isActive = body.is_active !== false;
    const isReseller = Boolean(body.is_reseller);
    const existing = statements.findPlanById.get(planId);
    const offerCode = String(body.offer_code ?? existing?.offer_code ?? code)
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(offerCode)) {
      throw new HttpError(400, "offer_code invalide.");
    }
    const purchaseMode = String(body.purchase_mode ?? existing?.purchase_mode ?? "online")
      .trim()
      .toLowerCase();
    if (!isReseller && !["online", "contact"].includes(purchaseMode)) {
      throw new HttpError(400, "purchase_mode invalide.");
    }
    const requestedLimitMode = String(
      body.device_limit_mode ?? existing?.device_limit_mode ?? "limited"
    ).trim().toLowerCase();
    if (!isReseller && !["limited", "unlimited"].includes(requestedLimitMode)) {
      throw new HttpError(400, "device_limit_mode invalide.");
    }
    const limitMode = isReseller ? "limited" : requestedLimitMode;
    const maxDevices = limitMode === "unlimited"
      ? Math.max(1, Number(existing?.max_devices ?? 1))
      : body.max_devices === undefined
        ? Math.max(1, Number(existing?.max_devices ?? 1))
        : requireInteger(body, "max_devices", 1, 100_000);
    const priceCfa = body.price_cfa === null || body.price_cfa === undefined
      ? null
      : requireInteger(body, "price_cfa", 1, 1_000_000_000);
    if (isActive && !isReseller && purchaseMode === "online" && priceCfa === null) {
      throw new HttpError(400, "Un forfait SaaS actif doit avoir un prix payable.");
    }
    const now = nowIso();
    if (body.is_recommended && !isReseller) {
      statements.clearRecommendedPlans.run(now, offerCode);
    }
    statements.upsertPlan.run(
      planId,
      code,
      name,
      body.description ? String(body.description).slice(0, 2000) : null,
      routerLimit,
      maxDevices,
      limitMode,
      durationDays,
      priceCfa,
      billingPeriod,
      offerCode,
      isReseller ? "online" : purchaseMode,
      body.is_recommended ? 1 : 0,
      isActive ? 1 : 0,
      isReseller ? 1 : 0,
      Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      existing?.created_at ?? now,
      now
    );
    if (!isReseller) {
      statements.setOfferRecommended.run(body.is_recommended ? 1 : 0, now, offerCode);
    }
    return { plan: planResponse(statements.findPlanById.get(planId)) };
  }),

  route("POST", "/v1/admin/plans/list", async (request) => {
    requireAdmin(request, ["owner", "admin", "support"]);
    return {
      plans: statements.listAllPlans.all().map((plan) => ({
        ...planResponse(plan),
        sort_order: Number(plan.sort_order)
      }))
    };
  }),

  route("POST", "/v1/admin/resellers", async (request, body) => {
    requireMaster(request);
    const plan = statements.findPlanById.get(requireText(body, "plan_id", 128));
    if (!plan || !Boolean(plan.is_reseller)) {
      throw new HttpError(400, "Une offre revendeur active est requise.");
    }
    if (!Boolean(plan.is_active)) throw new HttpError(400, "Cette offre revendeur est inactive.");
    const resellerId = crypto.randomUUID();
    const resellerToken = randomToken(40);
    const email = requireEmail(body);
    if (statements.findResellerByEmail.get(email)) throw new HttpError(409, "Cet email revendeur existe déjà.");
    const temporaryPassword = body.temporary_password
      ? requirePasswordInput(body, "temporary_password")
      : generateTemporaryPassword();
    const issuedAt = nowIso();
    const accountDurationDays = body.account_duration_days === undefined
      ? null
      : requireInteger(body, "account_duration_days", 1, 3650);
    const expiresAt = accountDurationDays === null
      ? null
      : new Date(Date.now() + accountDurationDays * 86_400_000).toISOString();
    const maxChildDevices = body.max_child_devices === undefined
      ? Number(plan.max_devices)
      : requireInteger(body, "max_child_devices", 1, 100_000);
    const maxChildDurationDays = body.max_child_duration_days === undefined
      ? Number(plan.duration_days)
      : requireInteger(body, "max_child_duration_days", 1, 3650);
    try {
      statements.insertReseller.run(
        resellerId,
        plan.id,
        requireText(body, "name", 200),
        email,
        hashPassword(temporaryPassword),
        hash(resellerToken),
        Number(plan.router_limit),
        maxChildDevices,
        maxChildDurationDays,
        issuedAt,
        expiresAt,
        issuedAt,
        issuedAt,
        body.notes ? String(body.notes).slice(0, 2000) : null
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new HttpError(409, "Cet email revendeur existe déjà.");
      throw error;
    }
    const reseller = statements.findResellerById.get(resellerId);
    logEvent(request, null, "reseller_issued", null, null, {
      reseller_id: resellerId,
      plan_id: plan.id,
      router_capacity: Number(plan.router_limit)
    });
    return {
      reseller: resellerResponse(reseller),
      temporary_password: temporaryPassword
    };
  }),

  route("POST", "/v1/admin/resellers/list", async (request) => {
    requireMaster(request);
    return { resellers: statements.listResellers.all().map(resellerResponse) };
  }),

  route("POST", "/v1/admin/resellers/renew", async (request, body) => {
    requireMaster(request);
    const resellerId = requireText(body, "reseller_id", 128);
    const reseller = statements.findResellerById.get(resellerId);
    if (!reseller) throw new HttpError(404, "Revendeur introuvable.");
    const durationDays = requireInteger(body, "duration_days", 1, 3650);
    const baseTime = reseller.expires_at && Date.parse(reseller.expires_at) > Date.now()
      ? Date.parse(reseller.expires_at)
      : Date.now();
    const expiresAt = new Date(baseTime + durationDays * 86_400_000).toISOString();
    const routerCapacity = body.router_capacity === undefined
      ? Number(reseller.router_capacity)
      : requireInteger(body, "router_capacity", 1, 100_000);
    const consumed = resellerConsumedCapacity(resellerId);
    if (routerCapacity < consumed) {
      throw new HttpError(409, "La nouvelle capacité est inférieure aux crédits déjà consommés.", {
        router_consumed: consumed
      });
    }
    const maxChildDevices = body.max_child_devices === undefined
      ? Number(reseller.max_child_devices)
      : requireInteger(body, "max_child_devices", 1, 100_000);
    const maxChildDurationDays = body.max_child_duration_days === undefined
      ? Number(reseller.max_child_duration_days)
      : requireInteger(body, "max_child_duration_days", 1, 3650);
    statements.renewReseller.run(
      expiresAt,
      routerCapacity,
      maxChildDevices,
      maxChildDurationDays,
      resellerId
    );
    logEvent(request, null, "reseller_renewed", null, null, { reseller_id: resellerId, expires_at: expiresAt });
    return { reseller: resellerResponse(statements.findResellerById.get(resellerId)) };
  }),

  route("POST", "/v1/admin/resellers/top-up", async (request, body) => {
    requireMaster(request);
    const resellerId = requireText(body, "reseller_id", 128);
    const reseller = statements.findResellerById.get(resellerId);
    if (!reseller) throw new HttpError(404, "Revendeur introuvable.");
    const plan = statements.findPlanById.get(requireText(body, "plan_id", 128));
    if (!plan || !Boolean(plan.is_reseller) || !Boolean(plan.is_active)) {
      throw new HttpError(400, "Une offre revendeur active est requise pour la recharge.");
    }
    if (plan.id !== reseller.plan_id) {
      throw new HttpError(409, "La recharge doit utiliser le même pack que le compte revendeur.");
    }
    const accountDurationDays = body.account_duration_days === undefined
      ? null
      : requireInteger(body, "account_duration_days", 1, 3650);
    const expiresAt = accountDurationDays === null
      ? null
      : new Date(Date.now() + accountDurationDays * 86_400_000).toISOString();
    const maxChildDevices = Math.max(Number(reseller.max_child_devices), Number(plan.max_devices));
    const maxChildDurationDays = Math.max(
      Number(reseller.max_child_duration_days),
      Number(plan.duration_days)
    );
    statements.topUpReseller.run(
      expiresAt,
      Number(plan.router_limit),
      maxChildDevices,
      maxChildDurationDays,
      nowIso(),
      resellerId
    );
    const updated = statements.findResellerById.get(resellerId);
    logEvent(request, null, "reseller_pack_purchased", null, null, {
      reseller_id: resellerId,
      plan_id: plan.id,
      credits_added: Number(plan.router_limit),
      router_capacity: Number(updated.router_capacity)
    });
    return {
      reseller: resellerResponse(updated),
      credits_added: Number(plan.router_limit),
      payment_required: true
    };
  }),

  route("POST", "/v1/admin/resellers/revoke", async (request, body) => {
    requireMaster(request);
    const resellerId = requireText(body, "reseller_id", 128);
    if (!statements.findResellerById.get(resellerId)) throw new HttpError(404, "Revendeur introuvable.");
    statements.revokeReseller.run(resellerId);
    logEvent(request, null, "reseller_revoked", null, null, { reseller_id: resellerId });
    return {
      ok: true,
      reseller: resellerResponse(statements.findResellerById.get(resellerId)),
      child_licenses_unchanged: true
    };
  }),

  route("GET", "/v1/reseller/overview", async (request) => {
    const reseller = requireReseller(request);
    return { reseller: resellerResponse(reseller) };
  }),

  route("POST", "/v1/reseller/licenses", async (request, body) => {
    const reseller = requireReseller(request);
    const routerLimit = requireInteger(body, "router_limit", 1, Number(reseller.router_capacity));
    const durationDays = requireInteger(body, "duration_days", 1, Number(reseller.max_child_duration_days));
    const maxDevices = body.max_devices === undefined
      ? 1
      : requireInteger(body, "max_devices", 1, Number(reseller.max_child_devices));
    const activationWindowDays = body.activation_window_days === undefined
      ? 90
      : requireInteger(body, "activation_window_days", 1, 3650);
    const plaintextKey = body.key ? formatKey(normalizeKey(body.key)) : generateLicenseKey();
    const licenseId = crypto.randomUUID();
    const issuedAt = nowIso();
    const activationDeadline = new Date(Date.now() + activationWindowDays * 86_400_000).toISOString();

    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = resellerConsumedCapacity(reseller.id);
      if (consumed + routerLimit > Number(reseller.router_capacity)) {
        throw new HttpError(409, "Crédits revendeur insuffisants. Un nouveau pack doit être acheté.", {
          router_capacity: Number(reseller.router_capacity),
          router_consumed: consumed,
          router_reserved: consumed,
          router_available: Math.max(0, Number(reseller.router_capacity) - consumed)
        });
      }
      statements.insertLicense.run(
        licenseId,
        hash(normalizeKey(plaintextKey)),
        null,
        "RESELLER-CHILD",
        String(body.plan_name ?? `Pack client ${routerLimit} routeur(s)`).slice(0, 200),
        String(body.plan_description ?? "Sous-licence TicketPro indépendante.").slice(0, 2000),
        durationDays,
        routerLimit,
        maxDevices,
        body.price_cfa === undefined ? null : Number(body.price_cfa),
        String(body.billing_period ?? "custom"),
        body.label ? String(body.label).slice(0, 200) : null,
        body.notes ? String(body.notes).slice(0, 2000) : null,
        issuedAt,
        "reseller_child",
        reseller.id,
        activationDeadline
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof HttpError) throw error;
      if (String(error.message).includes("UNIQUE")) throw new HttpError(409, "Cette clé existe déjà.");
      throw error;
    }
    const license = statements.findLicenseById.get(licenseId);
    logEvent(request, licenseId, "reseller_child_issued", null, null, {
      reseller_id: reseller.id,
      router_limit: routerLimit,
      duration_days: durationDays,
      activation_deadline_at: activationDeadline
    });
    return {
      license_id: licenseId,
      key: plaintextKey,
      status: "issued",
      activation_deadline_at: activationDeadline,
      expiry_starts_on_first_activation: true,
      plan: licensePlanResponse(license),
      reseller: resellerResponse(reseller)
    };
  }),

  route("POST", "/v1/reseller/licenses/list", async (request) => {
    const reseller = requireReseller(request);
    const licenses = statements.listResellerLicenses.all(reseller.id).map((license) => ({
      ...license,
      status: effectiveLicenseStatus(license),
      duration_days: Number(license.duration_days),
      router_limit: Number(license.router_limit),
      max_devices: Number(license.max_devices),
      router_count: Number(license.router_count),
      device_count: Number(license.device_count)
    }));
    return { reseller: resellerResponse(reseller), licenses };
  }),

  route("POST", "/v1/reseller/licenses/revoke", async (request, body) => {
    const reseller = requireReseller(request);
    const licenseId = requireText(body, "license_id", 128);
    const license = statements.findLicenseById.get(licenseId);
    if (!license || license.reseller_id !== reseller.id) {
      throw new HttpError(404, "Sous-licence introuvable.");
    }
    statements.revokeLicense.run(licenseId);
    statements.revokeAllActivations.run(licenseId);
    logEvent(request, licenseId, "reseller_child_revoked", null, null, { reseller_id: reseller.id });
    return {
      ok: true,
      license_id: licenseId,
      status: "revoked",
      reseller: resellerResponse(reseller)
    };
  }),

  route("POST", "/v1/admin/licenses", async (request, body) => {
    requireMaster(request);
    const plan = body.plan_id ? statements.findPlanById.get(String(body.plan_id)) : null;
    if (body.plan_id && !plan) throw new HttpError(404, "Offre introuvable.");
    if (plan?.is_reseller) {
      throw new HttpError(400, "Utilisez /v1/admin/resellers pour émettre une offre revendeur.");
    }
    const durationDays = plan?.duration_days ?? requireInteger(body, "duration_days", 1, 3650);
    const routerLimit = plan?.router_limit ?? requireInteger(body, "router_limit", 1, 100_000);
    const maxDevices = plan?.max_devices ?? requireInteger(body, "max_devices", 1, 100_000);
    const snapshot = plan
      ? planResponse(plan)
      : {
          id: null,
          code: String(body.plan_code ?? "CUSTOM"),
          name: String(body.plan_name ?? `Pack ${routerLimit} routeur(s)`),
          description: String(body.plan_description ?? ""),
          price_cfa: body.price_cfa === undefined ? null : Number(body.price_cfa),
          billing_period: String(body.billing_period ?? "custom")
        };
    const plaintextKey = body.key ? formatKey(normalizeKey(body.key)) : generateLicenseKey();
    const licenseId = crypto.randomUUID();
    try {
      statements.insertLicense.run(
        licenseId,
        hash(normalizeKey(plaintextKey)),
        snapshot.id,
        snapshot.code,
        snapshot.name,
        snapshot.description,
        Number(durationDays),
        Number(routerLimit),
        Number(maxDevices),
        snapshot.price_cfa,
        snapshot.billing_period,
        body.label ? String(body.label).slice(0, 200) : null,
        body.notes ? String(body.notes).slice(0, 2000) : null,
        nowIso(),
        "standard",
        null,
        null
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new HttpError(409, "Cette clé existe déjà.");
      throw error;
    }
    const license = statements.findLicenseById.get(licenseId);
    logEvent(request, licenseId, "issued", null, null, { plan: licensePlanResponse(license) });
    return {
      license_id: licenseId,
      key: plaintextKey,
      status: "issued",
      plan: licensePlanResponse(license)
    };
  }),

  route("POST", "/v1/admin/vpn/reconcile", async (request) => {
    requireMaster(request);
    await reconcileOrganizationVpnPeers();
    return { ok: true };
  }),

  route("POST", "/v1/admin/licenses/activations", async (request, body) => {
    requireMaster(request);
    const licenseId = requireText(body, "license_id", 128);
    if (!statements.findLicenseById.get(licenseId)) throw new HttpError(404, "Licence introuvable.");
    return { activations: statements.listActivations.all(licenseId) };
  }),

  route("POST", "/v1/admin/licenses/revoke", async (request, body) => {
    requireMaster(request);
    const licenseId = requireText(body, "license_id", 128);
    if (!statements.findLicenseById.get(licenseId)) throw new HttpError(404, "Licence introuvable.");
    statements.revokeLicense.run(licenseId);
    statements.revokeAllActivations.run(licenseId);
    logEvent(request, licenseId, "revoked", null, null);
    return { ok: true, license_id: licenseId, status: "revoked" };
  }),

  route("POST", "/v1/admin/licenses/reset-device", async (request, body) => {
    requireMaster(request);
    const licenseId = requireText(body, "license_id", 128);
    if (!statements.findLicenseById.get(licenseId)) throw new HttpError(404, "Licence introuvable.");
    if (body.activation_id) {
      statements.revokeActivation.run(String(body.activation_id), licenseId);
      statements.deleteRouterSourcesForActivation.run(String(body.activation_id));
    } else {
      statements.revokeAllActivations.run(licenseId);
      for (const activation of statements.listActivations.all(licenseId)) {
        statements.deleteRouterSourcesForActivation.run(activation.id);
      }
    }
    const deviceCount = Number(statements.countDevices.get(licenseId).count);
    const routerCount = Number(statements.countRouters.get(licenseId).count);
    const license = statements.findLicenseById.get(licenseId);
    statements.touchLicense.run(license.status, nowIso(), routerCount, deviceCount, licenseId);
    logEvent(request, licenseId, "device_reset", null, null, {
      activation_id: body.activation_id ?? null
    });
    return { ok: true, license_id: licenseId, device_count: deviceCount, router_count: routerCount };
  })
];

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": allowedCorsOrigin(request),
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    });
    response.end();
    return;
  }
  for (const handler of handlers) {
    if (await handler(request, response)) return;
  }
  sendJson(response, 404, { error: "Route introuvable." }, request);
});

server.listen(PORT, HOST, () => {
  console.log(`TicketPro License API écoute sur ${HOST}:${PORT}`);
  void processSubscriptionNotifications().catch((error) =>
    console.error("Traitement initial des relances d'abonnement impossible:", error)
  );
  void reconcileOrganizationVpnPeers().catch((error) =>
    console.error("Reconciliation VPN initiale impossible:", error)
  );
});

const subscriptionNotificationTimer = setInterval(() => {
  void processSubscriptionNotifications().catch((error) =>
    console.error("Traitement planifié des relances d'abonnement impossible:", error)
  );
}, SUBSCRIPTION_NOTIFICATION_INTERVAL_MS);
subscriptionNotificationTimer.unref();

const vpnReconciliationTimer = setInterval(() => {
  void reconcileOrganizationVpnPeers().catch((error) =>
    console.error("Reconciliation VPN planifiee impossible:", error)
  );
}, Number.isFinite(VPN_RECONCILIATION_INTERVAL_MS) && VPN_RECONCILIATION_INTERVAL_MS >= 1_000
  ? VPN_RECONCILIATION_INTERVAL_MS
  : 60_000);
vpnReconciliationTimer.unref();
