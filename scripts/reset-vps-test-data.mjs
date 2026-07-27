import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbPath = "/data/licenses.sqlite";
const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = "/data/backups";
const backupPath = `${backupDirectory}/licenses-pre-test-reset-${timestamp}.sqlite`;

fs.mkdirSync(backupDirectory, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`VACUUM INTO '${backupPath}';`);
db.exec(`
  BEGIN IMMEDIATE;
  DELETE FROM organization_subscriptions;
  DELETE FROM organization_password_reset_tokens;
  DELETE FROM organization_sessions;
  DELETE FROM payment_webhook_events;
  DELETE FROM payment_orders;
  DELETE FROM organization_users;
  DELETE FROM organizations;
  DELETE FROM reseller_registrations;
  DELETE FROM password_reset_tokens WHERE actor_type = 'reseller';
  DELETE FROM auth_sessions WHERE actor_type = 'reseller';
  DELETE FROM reseller_accounts;
  DELETE FROM license_router_sources;
  DELETE FROM license_activations;
  DELETE FROM license_events;
  DELETE FROM licenses;
  COMMIT;
  PRAGMA wal_checkpoint(TRUNCATE);
`);

const preserved = {
  plans: db.prepare("SELECT COUNT(*) AS count FROM plans").get().count,
  admin_users: db.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count,
  admin_sessions: db.prepare(
    "SELECT COUNT(*) AS count FROM auth_sessions WHERE actor_type = 'admin'"
  ).get().count
};
const removedScopes = {
  organizations: db.prepare("SELECT COUNT(*) AS count FROM organizations").get().count,
  payments: db.prepare("SELECT COUNT(*) AS count FROM payment_orders").get().count,
  licenses: db.prepare("SELECT COUNT(*) AS count FROM licenses").get().count,
  resellers: db.prepare("SELECT COUNT(*) AS count FROM reseller_accounts").get().count
};

console.log(JSON.stringify({ backupPath, preserved, removedScopes }, null, 2));
