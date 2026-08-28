-- TicketPro Sprint 2: versioned, secret-free RouterOS ownership manifest.
-- The manifest is observational in this migration; it never mutates RouterOS.
CREATE TABLE IF NOT EXISTS router_managed_resource_manifests (
  router_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('drift', 'error', 'synced')),
  desired_json TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_router_managed_manifest_account_status
  ON router_managed_resource_manifests(account_id, status, updated_at DESC);
