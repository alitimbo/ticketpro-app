PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS print_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  router_id TEXT REFERENCES routers(id),
  batch_id TEXT REFERENCES ticket_batches(id),
  printer_id TEXT,
  printer_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  user_message TEXT NOT NULL,
  created_by_profile TEXT NOT NULL,
  created_by_profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_print_history_account_created
  ON print_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_history_batch_id
  ON print_history(batch_id);
