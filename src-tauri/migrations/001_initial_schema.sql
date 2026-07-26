PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_profiles (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_launch_required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS routers (
  id TEXT PRIMARY KEY,
  zone_id TEXT,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  model TEXT,
  board_name TEXT,
  serial_number TEXT,
  routeros_version TEXT,
  local_ip TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728,
  api_ssl_port INTEGER NOT NULL DEFAULT 8729,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  connection_mode TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS router_connections (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  mode TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  use_ssl INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inactive',
  last_error TEXT,
  last_connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS hotspot_plans (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  validity_minutes INTEGER,
  data_limit_mb INTEGER,
  download_limit TEXT,
  upload_limit TEXT,
  shared_users INTEGER NOT NULL DEFAULT 1,
  price_hint INTEGER,
  mikrotik_profile_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS ticket_batches (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  plan_id TEXT NOT NULL REFERENCES hotspot_plans(id),
  operator_profile TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  prefix TEXT,
  code_length INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_file_id TEXT,
  created_by_profile TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ticket_batches(id),
  router_id TEXT NOT NULL REFERENCES routers(id),
  plan_id TEXT NOT NULL REFERENCES hotspot_plans(id),
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  mac_address TEXT,
  ip_address TEXT,
  activated_at TEXT,
  completed_at TEXT,
  expires_at TEXT,
  deleted_at TEXT,
  printed_count INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  mikrotik_id TEXT,
  created_by_profile TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS generated_files (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  batch_id TEXT REFERENCES ticket_batches(id),
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL,
  created_by_profile TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS active_sessions_cache (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  username TEXT NOT NULL,
  ip_address TEXT,
  mac_address TEXT,
  uptime TEXT,
  session_time_left TEXT,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS router_snapshots (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id),
  cpu_load INTEGER,
  memory_used INTEGER,
  memory_total INTEGER,
  uptime TEXT,
  active_clients_count INTEGER NOT NULL DEFAULT 0,
  tickets_count INTEGER NOT NULL DEFAULT 0,
  plans_count INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  user_message TEXT NOT NULL,
  technical_message TEXT,
  router_id TEXT REFERENCES routers(id),
  created_by_profile TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS printers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  paper_width_mm INTEGER,
  status TEXT NOT NULL DEFAULT 'inactive',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS idx_hotspot_plans_router_id ON hotspot_plans(router_id);
CREATE INDEX IF NOT EXISTS idx_ticket_batches_router_id ON ticket_batches(router_id);
CREATE INDEX IF NOT EXISTS idx_ticket_batches_plan_id ON ticket_batches(plan_id);
CREATE INDEX IF NOT EXISTS idx_tickets_batch_id ON tickets(batch_id);
CREATE INDEX IF NOT EXISTS idx_tickets_router_id ON tickets(router_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_batch_id ON generated_files(batch_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_router_id ON active_sessions_cache(router_id);
CREATE INDEX IF NOT EXISTS idx_router_snapshots_router_id ON router_snapshots(router_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_router_id ON app_logs(router_id);
