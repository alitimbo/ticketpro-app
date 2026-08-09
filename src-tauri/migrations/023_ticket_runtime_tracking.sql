ALTER TABLE ticket_batches ADD COLUMN hotspot_server_name TEXT NOT NULL DEFAULT 'all';

ALTER TABLE tickets ADD COLUMN hotspot_server_name TEXT NOT NULL DEFAULT 'all';
ALTER TABLE tickets ADD COLUMN mikrotik_profile_name TEXT;
ALTER TABLE tickets ADD COLUMN exported_at TEXT;
ALTER TABLE tickets ADD COLUMN archived_at TEXT;
ALTER TABLE tickets ADD COLUMN router_deleted_at TEXT;
ALTER TABLE tickets ADD COLUMN last_router_sync_at TEXT;
ALTER TABLE tickets ADD COLUMN uptime_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN remaining_seconds INTEGER;
ALTER TABLE tickets ADD COLUMN data_remaining_bytes INTEGER;

CREATE TABLE IF NOT EXISTS ticket_state_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  router_id TEXT NOT NULL REFERENCES routers(id),
  previous_status TEXT,
  next_status TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by_profile_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_state_history_ticket
  ON ticket_state_history(ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_runtime_filters
  ON tickets(router_id, status, hotspot_server_name, mikrotik_profile_name, created_at DESC);
