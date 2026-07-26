CREATE TABLE IF NOT EXISTS license_state (
  id TEXT PRIMARY KEY CHECK (id = 'current'),
  account_id TEXT NOT NULL,
  license_id TEXT NOT NULL UNIQUE,
  activation_token_encrypted TEXT NOT NULL,
  install_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued', 'active', 'expired', 'revoked')),
  expires_at TEXT,
  duration_days INTEGER NOT NULL,
  router_limit INTEGER NOT NULL,
  router_count INTEGER NOT NULL DEFAULT 0,
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
