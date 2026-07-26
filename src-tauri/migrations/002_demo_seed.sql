INSERT OR IGNORE INTO app_settings (id, key, value)
VALUES
  ('setting-first-launch', 'first_launch', 'true'),
  ('setting-demo-seed', 'demo_seed_version', '1');

INSERT OR IGNORE INTO local_profiles (id, role, label, password_hash, first_launch_required, status)
VALUES
  ('profile-admin', 'admin', 'Admin', '9ffcea3caee6f051052df3849808f6dae17469a14cab1a5c55e59d4a9f37ba2a', 1, 'active'),
  ('profile-operator', 'operator', 'Opérateur', '7a70d720fa2c11cfcc79e2a62c761079f7e5c1e1a38d80c16f0d03cbdf3b8e2b', 1, 'active'),
  ('profile-agent', 'agent', 'Agent', '5eb5817ce535bec90e2cbcf587591b259ef8ec6f3d2c7fa7d26611bd04b9fefc', 1, 'active'),
  ('profile-guest', 'guest', 'Invité', '57fe88bc34ce4f2b7e3e7b2bd951259b2cb96e410819f809fe28f71ea4e19f15', 1, 'active');

INSERT OR IGNORE INTO routers (
  id,
  zone_id,
  name,
  label,
  model,
  board_name,
  serial_number,
  routeros_version,
  local_ip,
  api_port,
  api_ssl_port,
  username,
  encrypted_password,
  connection_mode,
  status,
  last_seen_at
)
VALUES (
  'router-demo',
  'zone-demo',
  'routeur-demo',
  'Routeur démo',
  'hEX',
  'RB750Gr3',
  'DEMO-SERIAL',
  '7.x',
  '192.168.88.1',
  8728,
  8729,
  'admin',
  'secret://router-demo/password',
  'local',
  'active',
  CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO router_connections (id, router_id, mode, host, port, use_ssl, status, last_connected_at)
VALUES
  ('connection-demo-local', 'router-demo', 'local', '192.168.88.1', 8728, 0, 'active', CURRENT_TIMESTAMP),
  ('connection-demo-remote', 'router-demo', 'distant_ip', 'demo.remote.local', 8729, 1, 'inactive', NULL);

INSERT OR IGNORE INTO hotspot_plans (
  id,
  router_id,
  name,
  duration_minutes,
  validity_minutes,
  data_limit_mb,
  download_limit,
  upload_limit,
  shared_users,
  price_hint,
  mikrotik_profile_name,
  status
)
VALUES (
  'plan-demo-day',
  'router-demo',
  'Journée',
  1440,
  1440,
  NULL,
  '5M',
  '2M',
  1,
  500,
  'plan-journee',
  'active'
);

INSERT OR IGNORE INTO ticket_batches (
  id,
  router_id,
  plan_id,
  operator_profile,
  quantity,
  prefix,
  code_length,
  status,
  generated_file_id,
  created_by_profile
)
VALUES (
  'batch-demo-20',
  'router-demo',
  'plan-demo-day',
  'operator',
  20,
  'J',
  6,
  'generated',
  'file-demo-pdf',
  'operator'
);

INSERT OR IGNORE INTO tickets (
  id,
  batch_id,
  router_id,
  plan_id,
  username,
  password_encrypted,
  status,
  printed_count,
  mikrotik_id,
  created_by_profile
)
VALUES
  ('ticket-demo-001', 'batch-demo-20', 'router-demo', 'plan-demo-day', 'J001', 'secret://ticket-demo-001/password', 'available', 0, NULL, 'operator'),
  ('ticket-demo-002', 'batch-demo-20', 'router-demo', 'plan-demo-day', 'J002', 'secret://ticket-demo-002/password', 'available', 0, NULL, 'operator'),
  ('ticket-demo-003', 'batch-demo-20', 'router-demo', 'plan-demo-day', 'J003', 'secret://ticket-demo-003/password', 'used', 1, '*1', 'operator');

INSERT OR IGNORE INTO generated_files (
  id,
  router_id,
  batch_id,
  type,
  file_name,
  file_path,
  format,
  created_by_profile
)
VALUES (
  'file-demo-pdf',
  'router-demo',
  'batch-demo-20',
  'tickets_pdf',
  'tickets-demo.pdf',
  'files/tickets-demo.pdf',
  'pdf',
  'operator'
);

INSERT OR IGNORE INTO active_sessions_cache (
  id,
  router_id,
  username,
  ip_address,
  mac_address,
  uptime,
  session_time_left,
  downloaded_bytes,
  uploaded_bytes
)
VALUES (
  'active-session-demo-001',
  'router-demo',
  'J003',
  '192.168.88.25',
  '00:11:22:33:44:55',
  '12m',
  '1h48m',
  10485760,
  1048576
);

INSERT OR IGNORE INTO router_snapshots (
  id,
  router_id,
  cpu_load,
  memory_used,
  memory_total,
  uptime,
  active_clients_count,
  tickets_count,
  plans_count
)
VALUES (
  'snapshot-demo-001',
  'router-demo',
  12,
  67108864,
  268435456,
  '2d 04:15:00',
  1,
  3,
  1
);

INSERT OR IGNORE INTO printers (id, name, type, paper_width_mm, status)
VALUES ('printer-demo-thermal', 'Imprimante thermique démo', 'thermal', 58, 'inactive');

INSERT OR IGNORE INTO app_logs (id, level, category, user_message, technical_message, router_id, created_by_profile)
VALUES (
  'log-demo-seed',
  'info',
  'database',
  'Données de démonstration créées.',
  NULL,
  'router-demo',
  'operator'
);
