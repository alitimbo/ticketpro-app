import { DatabaseSync } from "node:sqlite";

const email = String(process.argv[2] ?? "").trim().toLowerCase();
const days = Number(process.argv[3] ?? 30);

if (!email || !email.includes("@")) throw new Error("Adresse email invalide.");
if (!Number.isInteger(days) || days < 1 || days > 365) {
  throw new Error("La prolongation doit être comprise entre 1 et 365 jours.");
}

const db = new DatabaseSync(process.env.LICENSE_DB ?? "/data/licenses.sqlite");
const user = db.prepare(`
  SELECT id, organization_id, email
  FROM organization_users
  WHERE lower(email) = ?
  LIMIT 1
`).get(email);

if (user === undefined) throw new Error(`Compte introuvable : ${email}`);

const subscription = db.prepare(`
  SELECT id, organization_id, status, current_period_start, current_period_end
  FROM organization_subscriptions
  WHERE organization_id = ? AND plan_id = 'ticketpro-trial-7-days'
  ORDER BY created_at DESC
  LIMIT 1
`).get(user.organization_id);

if (subscription === undefined) {
  throw new Error(`Aucun abonnement d'essai trouvé pour ${email}.`);
}

const previousEndMs = Date.parse(String(subscription.current_period_end));
const extensionBaseMs = Number.isFinite(previousEndMs) && previousEndMs > Date.now()
  ? previousEndMs
  : Date.now();
const now = new Date().toISOString();
const nextEnd = new Date(extensionBaseMs + days * 86_400_000).toISOString();

db.exec("BEGIN IMMEDIATE");
try {
  db.prepare(`
    UPDATE organization_subscriptions
    SET status = 'active', current_period_end = ?, updated_at = ?
    WHERE id = ?
  `).run(nextEnd, now, subscription.id);
  db.prepare(`
    UPDATE organizations
    SET status = 'active', updated_at = ?
    WHERE id = ?
  `).run(now, user.organization_id);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({
  days_added: days,
  email,
  new_status: "active",
  organization_id: user.organization_id,
  previous_end: subscription.current_period_end,
  current_period_end: nextEnd
}, null, 2));
