PRAGMA foreign_keys = ON;

-- Commercial data belongs to TicketPro. RouterOS only stores the technical
-- Hotspot profile, so currency and audit identity must remain local/cloud data.
ALTER TABLE hotspot_plans ADD COLUMN currency TEXT NOT NULL DEFAULT 'CFA';
ALTER TABLE hotspot_plans ADD COLUMN mikrotik_id TEXT;
ALTER TABLE hotspot_plans ADD COLUMN created_by_profile_id TEXT;
ALTER TABLE hotspot_plans ADD COLUMN updated_by_profile_id TEXT;
ALTER TABLE hotspot_plans ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotspot_plans ADD COLUMN last_synced_at TEXT;

UPDATE hotspot_plans
SET currency = 'CFA'
WHERE currency IS NULL OR TRIM(currency) = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_hotspot_plans_router_mikrotik_id
  ON hotspot_plans(router_id, mikrotik_id)
  WHERE mikrotik_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS hotspot_plan_history (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  router_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'deleted', 'restored', 'synchronized')),
  revision INTEGER NOT NULL,
  actor_profile_id TEXT,
  source TEXT NOT NULL DEFAULT 'ticketpro',
  mikrotik_id TEXT,
  mikrotik_profile_name TEXT,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  price_hint INTEGER,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hotspot_plan_history_plan_revision
  ON hotspot_plan_history(plan_id, revision DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hotspot_plan_history_router_created
  ON hotspot_plan_history(router_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_hotspot_plan_history_immutable_update
BEFORE UPDATE ON hotspot_plan_history
BEGIN
  SELECT RAISE(ABORT, 'hotspot plan history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_hotspot_plan_history_immutable_delete
BEFORE DELETE ON hotspot_plan_history
BEGIN
  SELECT RAISE(ABORT, 'hotspot plan history is immutable');
END;

-- Existing plans predate the detailed audit. Keep an explicit migration
-- baseline instead of pretending to know their original author.
INSERT INTO hotspot_plan_history (
  id, plan_id, router_id, action, revision, actor_profile_id, source,
  mikrotik_id, mikrotik_profile_name, name, currency, price_hint,
  snapshot_json, created_at
)
SELECT
  'history-migration-' || id,
  id,
  router_id,
  'restored',
  revision,
  updated_by_profile_id,
  'migration-027',
  mikrotik_id,
  mikrotik_profile_name,
  name,
  currency,
  price_hint,
  json_object(
    'id', id,
    'router_id', router_id,
    'name', name,
    'currency', currency,
    'price_hint', price_hint,
    'mikrotik_id', mikrotik_id,
    'mikrotik_profile_name', mikrotik_profile_name,
    'revision', revision,
    'status', status
  ),
  COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM hotspot_plans;
