CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  router_id TEXT,
  operation_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'processing', 'retry', 'succeeded', 'conflict', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  last_attempt_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready
  ON sync_outbox(account_id, status, next_attempt_at, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_router
  ON sync_outbox(account_id, router_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_correlation
  ON sync_outbox(correlation_id, created_at);
