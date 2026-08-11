PRAGMA foreign_keys = ON;

-- A cloud router belongs to an organization, while every Windows user keeps a
-- separate local account. The local primary key must therefore be allowed to
-- differ from the shared SaaS router identifier.
ALTER TABLE routers ADD COLUMN cloud_router_id TEXT;

-- Existing installations historically used the local id as the cloud id.
UPDATE routers
SET cloud_router_id = id
WHERE cloud_router_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_routers_account_cloud_id
  ON routers(account_id, cloud_router_id)
  WHERE deleted_at IS NULL AND cloud_router_id IS NOT NULL;

