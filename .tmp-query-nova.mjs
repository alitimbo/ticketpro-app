import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(
  process.argv[2] ?? "/data/licenses.sqlite",
  { readOnly: true },
);
const routers = database.prepare(`
  SELECT
    r.id,
    r.organization_id,
    r.name,
    r.label,
    r.deleted_at,
    r.decommission_status,
    CASE WHEN EXISTS (
      SELECT 1
      FROM organization_router_retirement_tombstones t
      WHERE t.organization_id = r.organization_id
        AND (t.router_id = r.id OR t.stable_identity = r.stable_identity)
    ) THEN 1 ELSE 0 END AS has_tombstone
  FROM organization_routers r
  WHERE lower(r.name) LIKE '%nova%' OR lower(r.label) LIKE '%nova%'
`).all();

console.log(JSON.stringify({ routers }));
