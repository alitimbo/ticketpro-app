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

describe("migration comptes et abonnements", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const invoicesPermissionMigration = readFileSync(invoicesPermissionMigrationPath, "utf8");
  const profileAuditMigration = readFileSync(profileAuditMigrationPath, "utf8");
  const internalProfilePermissionsMigration = readFileSync(internalProfilePermissionsMigrationPath, "utf8");
  const accountProfileActivityScopeMigration = readFileSync(accountProfileActivityScopeMigrationPath, "utf8");
  const canonicalAccountProfileIdentityMigration = readFileSync(canonicalAccountProfileIdentityMigrationPath, "utf8");
  const disableLegacyDemoAccountMigration = readFileSync(disableLegacyDemoAccountMigrationPath, "utf8");

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
});
