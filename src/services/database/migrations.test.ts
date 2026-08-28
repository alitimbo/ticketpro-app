import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "src-tauri/migrations/004_subscription_pricing_grid.sql");
const invoicesPermissionMigrationPath = resolve(process.cwd(), "src-tauri/migrations/005_invoices_permission.sql");
const profileAuditMigrationPath = resolve(process.cwd(), "src-tauri/migrations/006_profile_id_audit_fields.sql");
const internalProfilePermissionsMigrationPath = resolve(process.cwd(), "src-tauri/migrations/007_internal_profile_permissions_v2.sql");
const accountProfileActivityScopeMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/008_account_profile_activity_scope.sql"
);
const canonicalAccountProfileIdentityMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/009_canonical_account_profile_identity.sql"
);
const disableLegacyDemoAccountMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/017_disable_legacy_demo_account.sql"
);
const restoreVpnConnectionModesMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/018_restore_vpn_connection_modes.sql"
);
const ticketRouterUsernameUniquenessMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/019_ticket_router_username_uniqueness.sql"
);
const routerHotspotAddressMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/020_router_hotspot_address.sql"
);
const generatedFileMetadataMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/021_generated_file_metadata.sql"
);
const vpnPeerLifecycleMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/022_vpn_peer_lifecycle.sql"
);
const ticketRuntimeTrackingMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/023_ticket_runtime_tracking.sql"
);
const routerCloudIdentityMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/024_router_cloud_identity.sql"
);
const routerOrganizationScopeMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/025_router_organization_scope.sql"
);
const ticketBatchCurrencyMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/026_ticket_batch_currency.sql"
);
const hotspotPlanIdentityAuditMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/027_hotspot_plan_identity_audit.sql"
);
const routerManagedResourceManifestMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/028_router_managed_resource_manifest.sql"
);
const ticketCommercialSnapshotsMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/029_ticket_commercial_snapshots.sql"
);
const syncOutboxMigrationPath = resolve(
  process.cwd(),
  "src-tauri/migrations/030_sync_outbox.sql"
);

describe("migration comptes et abonnements", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const invoicesPermissionMigration = readFileSync(invoicesPermissionMigrationPath, "utf8");
  const profileAuditMigration = readFileSync(profileAuditMigrationPath, "utf8");
  const internalProfilePermissionsMigration = readFileSync(internalProfilePermissionsMigrationPath, "utf8");
  const accountProfileActivityScopeMigration = readFileSync(accountProfileActivityScopeMigrationPath, "utf8");
  const canonicalAccountProfileIdentityMigration = readFileSync(canonicalAccountProfileIdentityMigrationPath, "utf8");
  const disableLegacyDemoAccountMigration = readFileSync(disableLegacyDemoAccountMigrationPath, "utf8");
  const restoreVpnConnectionModesMigration = readFileSync(restoreVpnConnectionModesMigrationPath, "utf8");
  const ticketRouterUsernameUniquenessMigration = readFileSync(ticketRouterUsernameUniquenessMigrationPath, "utf8");
  const routerHotspotAddressMigration = readFileSync(routerHotspotAddressMigrationPath, "utf8");
  const generatedFileMetadataMigration = readFileSync(generatedFileMetadataMigrationPath, "utf8");
  const vpnPeerLifecycleMigration = readFileSync(vpnPeerLifecycleMigrationPath, "utf8");
  const ticketRuntimeTrackingMigration = readFileSync(ticketRuntimeTrackingMigrationPath, "utf8");
  const routerCloudIdentityMigration = readFileSync(routerCloudIdentityMigrationPath, "utf8");
  const routerOrganizationScopeMigration = readFileSync(routerOrganizationScopeMigrationPath, "utf8");
  const ticketBatchCurrencyMigration = readFileSync(ticketBatchCurrencyMigrationPath, "utf8");
  const hotspotPlanIdentityAuditMigration = readFileSync(hotspotPlanIdentityAuditMigrationPath, "utf8");
  const routerManagedResourceManifestMigration = readFileSync(routerManagedResourceManifestMigrationPath, "utf8");
  const ticketCommercialSnapshotsMigration = readFileSync(ticketCommercialSnapshotsMigrationPath, "utf8");
  const syncOutboxMigration = readFileSync(syncOutboxMigrationPath, "utf8");

  it("ajoute la grille tarifaire evolutive des abonnements logiciel", () => {
    expect(migration).toContain("price_per_router_cfa");
    expect(migration).toContain("description");
    expect(migration).toContain("is_recommended");
    expect(migration).toContain("'subscription-plan-5-routers'");
    expect(migration).toContain("6000");
    expect(migration).toContain("1200");
    expect(migration).toContain("70000");
    expect(migration).toContain("700");
  });

  it("prepare le rattachement compte, profils et routeurs sans secret en clair", () => {
    expect(migration).toContain("'account-douma-demo'");
    expect(migration).toContain("global.invoices");
    expect(migration).toContain("UPDATE routers");
    expect(migration).toContain("subscription_annual_discount_months");
    expect(migration).not.toContain("test123");
    expect(migration).not.toContain("admin123");
    expect(migration).not.toContain("operateur123");
    expect(migration).not.toContain("agent123");
    expect(migration).not.toContain("invite123");
  });

  it("ajoute la permission Factures pour les bases deja migrees", () => {
    expect(invoicesPermissionMigration).toContain("global.invoices");
    expect(invoicesPermissionMigration).toContain("internal_profiles");
  });

  it("ajoute l'audit par profil interne sur les lots et tickets", () => {
    expect(profileAuditMigration).toContain("ALTER TABLE ticket_batches ADD COLUMN created_by_profile_id");
    expect(profileAuditMigration).toContain("ALTER TABLE tickets ADD COLUMN created_by_profile_id");
    expect(profileAuditMigration).toContain("internal-profile-operator");
  });

  it("met a jour les permissions des profils internes", () => {
    expect(internalProfilePermissionsMigration).toContain("global.routers.add");
    expect(internalProfilePermissionsMigration).toContain("router.tickets.reprint");
    expect(internalProfilePermissionsMigration).toContain("router.files.own");
    expect(internalProfilePermissionsMigration).toContain("WHERE role = 'guest'");
    expect(internalProfilePermissionsMigration).not.toContain("Mobile Money");
  });

  it("rattache tickets, fichiers et logs au compte principal et au profil interne", () => {
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE ticket_batches ADD COLUMN account_id");
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE tickets ADD COLUMN account_id");
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE generated_files ADD COLUMN account_id");
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE generated_files ADD COLUMN created_by_profile_id");
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE app_logs ADD COLUMN account_id");
    expect(accountProfileActivityScopeMigration).toContain("ALTER TABLE app_logs ADD COLUMN internal_profile_id");
    expect(accountProfileActivityScopeMigration).toContain("idx_tickets_account_profile");
  });

  it("rend les identifiants de profils internes uniques par compte sans supprimer les données", () => {
    expect(canonicalAccountProfileIdentityMigration).toContain("account_id || ':' || id");
    expect(canonicalAccountProfileIdentityMigration).toContain("created_by_profile_id");
    expect(canonicalAccountProfileIdentityMigration).toContain("internal_profile_id");
    expect(canonicalAccountProfileIdentityMigration).not.toContain("DELETE FROM");
    expect(canonicalAccountProfileIdentityMigration).not.toContain("DROP TABLE");
  });

  it("libère l'adresse historique du compte démo sans supprimer ses données", () => {
    expect(disableLegacyDemoAccountMigration).toContain("legacy-demo-disabled@ticketpro.local");
    expect(disableLegacyDemoAccountMigration).toContain("status = 'suspended'");
    expect(disableLegacyDemoAccountMigration).toContain("id = 'account-douma-demo'");
    expect(disableLegacyDemoAccountMigration).not.toContain("DELETE FROM");
    expect(disableLegacyDemoAccountMigration).not.toContain("DROP TABLE");
  });

  it("restaure les connexions VPN des routeurs déjà provisionnés", () => {
    expect(restoreVpnConnectionModesMigration).toContain("vpn_peers");
    expect(restoreVpnConnectionModesMigration).toContain("distant_ip");
    expect(restoreVpnConnectionModesMigration).toContain("mode = 'vpn'");
  });

  it("répare les doublons historiques avant d'imposer l'unicité des vouchers par routeur", () => {
    expect(ticketRouterUsernameUniquenessMigration).toContain("ROW_NUMBER() OVER");
    expect(ticketRouterUsernameUniquenessMigration).toContain("PARTITION BY router_id, username");
    expect(ticketRouterUsernameUniquenessMigration).toContain("duplicate_rank > 1");
    expect(ticketRouterUsernameUniquenessMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(ticketRouterUsernameUniquenessMigration).toContain("WHERE deleted_at IS NULL");
  });

  it("ajoute l'adresse du portail captif aux routeurs existants", () => {
    expect(routerHotspotAddressMigration).toContain("ALTER TABLE routers ADD COLUMN hotspot_address TEXT");
    expect(routerHotspotAddressMigration).not.toContain("DROP TABLE");
  });

  it("conserve les paramètres nécessaires à la régénération exacte des fichiers", () => {
    expect(generatedFileMetadataMigration).toContain("ALTER TABLE generated_files ADD COLUMN metadata_json TEXT");
    expect(generatedFileMetadataMigration).not.toContain("DROP TABLE");
  });

  it("conserve l'historique WireGuard et interdit plusieurs clés actives par ressource", () => {
    expect(vpnPeerLifecycleMigration).toContain("resource_id TEXT NOT NULL");
    expect(vpnPeerLifecycleMigration).toContain("ROW_NUMBER() OVER");
    expect(vpnPeerLifecycleMigration).toContain("uq_vpn_peer_active_resource");
    expect(vpnPeerLifecycleMigration).toContain("WHERE status <> 'revoked'");
    expect(vpnPeerLifecycleMigration).toContain("uq_vpn_peer_public_key");
    expect(vpnPeerLifecycleMigration).not.toContain("DELETE FROM vpn_peers");
  });

  it("persiste le serveur Hotspot, l'état temps réel et l'historique des vouchers", () => {
    expect(ticketRuntimeTrackingMigration).toContain("hotspot_server_name");
    expect(ticketRuntimeTrackingMigration).toContain("mikrotik_profile_name");
    expect(ticketRuntimeTrackingMigration).toContain("remaining_seconds");
    expect(ticketRuntimeTrackingMigration).toContain("data_remaining_bytes");
    expect(ticketRuntimeTrackingMigration).toContain("CREATE TABLE IF NOT EXISTS ticket_state_history");
    expect(ticketRuntimeTrackingMigration).not.toContain("DROP TABLE");
  });

  it("separe l'identifiant local du routeur de son identite SaaS partagee", () => {
    expect(routerCloudIdentityMigration).toContain("ALTER TABLE routers ADD COLUMN cloud_router_id TEXT");
    expect(routerCloudIdentityMigration).toContain("SET cloud_router_id = id");
    expect(routerCloudIdentityMigration).toContain("ON routers(account_id, cloud_router_id)");
    expect(routerCloudIdentityMigration).toContain("WHERE deleted_at IS NULL");
    expect(routerCloudIdentityMigration).not.toContain("DROP TABLE");
  });

  it("isole les routeurs locaux par organisation SaaS", () => {
    expect(routerOrganizationScopeMigration).toContain("ALTER TABLE routers ADD COLUMN organization_id TEXT");
    expect(routerOrganizationScopeMigration).toContain("idx_routers_account_organization");
    expect(routerOrganizationScopeMigration).toContain("uq_routers_account_organization_cloud_id");
    expect(routerOrganizationScopeMigration).not.toContain("DROP TABLE");
  });

  it("fige la devise choisie au moment de la génération d'un lot", () => {
    expect(ticketBatchCurrencyMigration).toContain("ALTER TABLE ticket_batches ADD COLUMN currency TEXT");
    expect(ticketBatchCurrencyMigration).toContain("ALTER TABLE ticket_batches ADD COLUMN price_snapshot INTEGER");
    expect(ticketBatchCurrencyMigration).toContain("DEFAULT 'CFA'");
    expect(ticketBatchCurrencyMigration).not.toContain("DROP TABLE");
  });

  it("rend la devise des plans obligatoire et conserve leur identite MikroTik et leur historique", () => {
    expect(hotspotPlanIdentityAuditMigration).toContain("ADD COLUMN currency TEXT NOT NULL DEFAULT 'CFA'");
    expect(hotspotPlanIdentityAuditMigration).toContain("ADD COLUMN mikrotik_id TEXT");
    expect(hotspotPlanIdentityAuditMigration).toContain("ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
    expect(hotspotPlanIdentityAuditMigration).toContain("CREATE TABLE IF NOT EXISTS hotspot_plan_history");
    expect(hotspotPlanIdentityAuditMigration).toContain("actor_profile_id");
    expect(hotspotPlanIdentityAuditMigration).toContain("trg_hotspot_plan_history_immutable_update");
    expect(hotspotPlanIdentityAuditMigration).toContain("trg_hotspot_plan_history_immutable_delete");
    expect(hotspotPlanIdentityAuditMigration).not.toContain("DROP TABLE");
  });

  it("ajoute un manifeste RouterOS versionne et sans secret par routeur", () => {
    expect(routerManagedResourceManifestMigration).toContain(
      "CREATE TABLE IF NOT EXISTS router_managed_resource_manifests"
    );
    expect(routerManagedResourceManifestMigration).toContain("schema_version INTEGER NOT NULL");
    expect(routerManagedResourceManifestMigration).toContain("revision INTEGER NOT NULL DEFAULT 1");
    expect(routerManagedResourceManifestMigration).toContain("desired_json TEXT NOT NULL");
    expect(routerManagedResourceManifestMigration).toContain("observed_json TEXT NOT NULL");
    expect(routerManagedResourceManifestMigration).not.toContain("private_key");
    expect(routerManagedResourceManifestMigration).not.toContain("password");
    expect(routerManagedResourceManifestMigration).not.toContain("DROP TABLE");
  });

  it("fige les regles commerciales de chaque voucher sans supprimer l'historique", () => {
    expect(ticketCommercialSnapshotsMigration).toContain("duration_minutes_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("validity_minutes_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("data_limit_mb_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("download_limit_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("upload_limit_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("shared_users_snapshot");
    expect(ticketCommercialSnapshotsMigration).toContain("UPDATE tickets");
    expect(ticketCommercialSnapshotsMigration).not.toContain("DELETE FROM");
    expect(ticketCommercialSnapshotsMigration).not.toContain("DROP TABLE");
  });

  it("ajoute une outbox durable et idempotente sans y stocker de secret", () => {
    expect(syncOutboxMigration).toContain("CREATE TABLE IF NOT EXISTS sync_outbox");
    expect(syncOutboxMigration).toContain("idempotency_key TEXT NOT NULL UNIQUE");
    expect(syncOutboxMigration).toContain("correlation_id TEXT NOT NULL");
    expect(syncOutboxMigration).toContain("attempt_count INTEGER NOT NULL DEFAULT 0");
    expect(syncOutboxMigration).toContain("next_attempt_at TEXT NOT NULL");
    expect(syncOutboxMigration).toContain("idx_sync_outbox_ready");
    expect(syncOutboxMigration).not.toContain("private_key");
    expect(syncOutboxMigration).not.toContain("password_encrypted");
    expect(syncOutboxMigration).not.toContain("DROP TABLE");
  });
});
