import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.LICENSE_PORT ?? 8787);
const HOST = process.env.LICENSE_BIND ?? "127.0.0.1";
const DB_PATH = process.env.LICENSE_DB ?? "/data/licenses.sqlite";
const MASTER_TOKEN = process.env.LICENSE_MASTER_TOKEN ?? "";
const HASH_SECRET = process.env.LICENSE_HASH_SECRET ?? "";
const IPAY_BASE_URL = String(process.env.IPAY_BASE_URL ?? "https://api.i-pay.money").replace(/\/$/, "");
const IPAY_ENV = process.env.IPAY_ENV ?? "";
const IPAY_PUBLIC_KEY = process.env.IPAY_PUBLIC_KEY ?? "";
const IPAY_PRIVATE_KEY = process.env.IPAY_PRIVATE_KEY ?? "";
const IPAY_SECRET_HASH = process.env.IPAY_SECRET_HASH ?? "";
const VPN_HUB_URL = String(process.env.VPN_HUB_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const VPN_HUB_MASTER_TOKEN = process.env.VPN_HUB_MASTER_TOKEN ?? "";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimits = new Map();

if (HASH_SECRET.length < 32) {
  throw new Error("LICENSE_HASH_SECRET doit contenir au moins 32 caractères.");
}

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
    duration_days INTEGER NOT NULL CHECK(duration_days > 0),
    price_cfa INTEGER,
    billing_period TEXT NOT NULL CHECK(billing_period IN ('monthly', 'yearly', 'custom')),
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
  CREATE INDEX IF NOT EXISTS idx_payment_orders_transaction ON payment_orders(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_reseller ON payment_orders(reseller_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_registration ON payment_orders(reseller_registration_id);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, fulfillment_status);
`);

ensureColumn("plans", "is_reseller", "INTEGER NOT NULL DEFAULT 0");
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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_licenses_reseller ON licenses(reseller_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_accounts_email
    ON reseller_accounts(email) WHERE email IS NOT NULL;
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
db.exec("UPDATE plans SET is_reseller = 1 WHERE code LIKE 'RESELLER-%';");

const statements = {
  listPlans: db.prepare("SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, router_limit ASC"),
  listAllPlans: db.prepare("SELECT * FROM plans ORDER BY sort_order ASC, router_limit ASC"),
  findPlanById: db.prepare("SELECT * FROM plans WHERE id = ?"),
  upsertPlan: db.prepare(`
    INSERT INTO plans (
      id, code, name, description, router_limit, max_devices, duration_days,
      price_cfa, billing_period, is_recommended, is_active, is_reseller, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code, name = excluded.name, description = excluded.description,
      router_limit = excluded.router_limit, max_devices = excluded.max_devices,
      duration_days = excluded.duration_days, price_cfa = excluded.price_cfa,
      billing_period = excluded.billing_period, is_recommended = excluded.is_recommended,
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
  listLicenses: db.prepare(`
    SELECT id, status, license_type, reseller_id, plan_id, plan_code, plan_name,
      duration_days, router_limit, max_devices, price_cfa, label, issued_at,
      activation_deadline_at, activated_at, expires_at, router_count, device_count
    FROM licenses ORDER BY issued_at DESC LIMIT ?
  `),
  insertPaymentOrder: db.prepare(`
    INSERT INTO payment_orders (
      id, transaction_id, purchaser_type, reseller_id, reseller_registration_id,
      plan_id, plan_code, plan_name,
      router_limit, max_devices, duration_days, amount, currency, country, msisdn,
      customer_name, payment_type, status, fulfillment_status, access_token_hash,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'XOF', 'NE', ?, ?, ?, 'pending', 'pending', ?, ?, ?)
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

function nowIso() {
  return new Date().toISOString();
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

function planResponse(plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    router_limit: Number(plan.router_limit),
    max_devices: Number(plan.max_devices),
    duration_days: Number(plan.duration_days),
    price_cfa: plan.price_cfa === null ? null : Number(plan.price_cfa),
    billing_period: plan.billing_period,
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
  return {
    order_id: order.id,
    transaction_id: order.transaction_id,
    purchaser_type: order.purchaser_type,
    plan: {
      id: order.plan_id,
      code: order.plan_code,
      name: order.plan_name,
      router_limit: Number(order.router_limit),
      max_devices: Number(order.max_devices),
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

function route(method, pathname, handler) {
  return async (request, response) => {
    if (request.method !== method || request.url.split("?")[0] !== pathname) return false;
    try {
      const body = method === "GET" ? {} : await readJson(request);
      sendJson(response, 200, await handler(request, body), request);
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

async function createIpayOrder(request, body, purchaserType, reseller = null, registration = null) {
  if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
  const plan = statements.findPlanById.get(requireText(body, "plan_id", 128));
  if (!plan || !Boolean(plan.is_active)) throw new HttpError(404, "Forfait introuvable ou inactif.");
  if (purchaserType === "organization" && Boolean(plan.is_reseller)) {
    throw new HttpError(400, "Une organisation ne peut pas acheter un pack revendeur.");
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
    plan.id,
    plan.code,
    plan.name,
    Number(plan.router_limit),
    Number(plan.max_devices),
    Number(plan.duration_days),
    amount,
    normalizeNigerMsisdn(body.msisdn),
    purchaserType === "reseller"
      ? reseller?.name ?? registration.name
      : requireText(body, "customer_name", 200),
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
    return { ok: true, service: "ticketpro-license-api", database: "ok", time: nowIso() };
  }),
  route("GET", "/v1/plans", async () => ({ plans: statements.listPlans.all().map(planResponse) })),

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

  route("POST", "/v1/vpn/peers", async (request, body) => {
    if (isRateLimited(request)) throw new HttpError(429, "Trop de tentatives. Réessayez plus tard.");
    const { activation, license } = requireLicensedDevice(body);
    const action = String(body.action ?? "");
    if (!["upsert", "revoke"].includes(action)) throw new HttpError(400, "Action VPN invalide.");
    const publicKey = requireText(body, "public_key", 128);
    const peer = await vpnHubRequest("/v1/peers", {
      account_id: license.id,
      action,
      name: typeof body.name === "string" ? body.name.slice(0, 200) : "",
      peer_type: body.peer_type === "operator" ? "operator" : "router",
      persistent_keepalive: 25,
      public_key: publicKey
    });
    logEvent(request, license.id, action === "revoke" ? "vpn_peer_revoked" : "vpn_peer_upserted", activation.account_id, activation.device_id_hash, {
      public_key_hash: hash(publicKey)
    });
    return {
      address_pool: peer.address_pool ?? null,
      assigned_address: peer.assigned_address ?? null,
      public_key: publicKey,
      status: peer.status
    };
  }),

  route("POST", "/v1/admin/plans", async (request, body) => {
    requireMaster(request);
    const planId = requireText(body, "id", 128);
    const code = requireText(body, "code", 64).toUpperCase();
    const name = requireText(body, "name", 200);
    const routerLimit = requireInteger(body, "router_limit", 1, 100_000);
    const maxDevices = requireInteger(body, "max_devices", 1, 100_000);
    const durationDays = requireInteger(body, "duration_days", 1, 3650);
    const billingPeriod = String(body.billing_period ?? "monthly");
    if (!["monthly", "yearly", "custom"].includes(billingPeriod)) {
      throw new HttpError(400, "billing_period invalide.");
    }
    const existing = statements.findPlanById.get(planId);
    const now = nowIso();
    statements.upsertPlan.run(
      planId,
      code,
      name,
      body.description ? String(body.description).slice(0, 2000) : null,
      routerLimit,
      maxDevices,
      durationDays,
      body.price_cfa === null || body.price_cfa === undefined ? null : Number(body.price_cfa),
      billingPeriod,
      body.is_recommended ? 1 : 0,
      body.is_active === false ? 0 : 1,
      body.is_reseller ? 1 : 0,
      Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      existing?.created_at ?? now,
      now
    );
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

server.listen(PORT, HOST, () => console.log(`TicketPro License API écoute sur ${HOST}:${PORT}`));
