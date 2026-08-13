PRAGMA foreign_keys = ON;

-- The same TicketPro account can be invited into several SaaS organizations.
-- Persist the organization owning each local router so offline access and deep
-- links cannot accidentally reuse a router from another active organization.
ALTER TABLE routers ADD COLUMN organization_id TEXT;

DROP INDEX IF EXISTS uq_routers_account_cloud_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_routers_account_organization_cloud_id
  ON routers(account_id, organization_id, cloud_router_id)
  WHERE deleted_at IS NULL AND organization_id IS NOT NULL AND cloud_router_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routers_account_organization
  ON routers(account_id, organization_id, deleted_at);
