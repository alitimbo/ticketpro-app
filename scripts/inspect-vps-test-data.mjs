import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("/data/licenses.sqlite", { readOnly: true });
const names = [
  "plans",
  "admin_users",
  "organizations",
  "organization_users",
  "organization_subscriptions",
  "organization_sessions",
  "organization_password_reset_tokens",
  "payment_orders",
  "payment_webhook_events",
  "licenses",
  "license_activations",
  "license_router_sources",
  "license_events",
  "reseller_accounts",
  "reseller_registrations",
  "auth_sessions",
  "password_reset_tokens"
];

const counts = Object.fromEntries(
  names.map((name) => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count])
);

console.log(JSON.stringify(counts, null, 2));
