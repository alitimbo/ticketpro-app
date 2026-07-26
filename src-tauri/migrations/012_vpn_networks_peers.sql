PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vpn_networks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  server_endpoint TEXT NOT NULL,
  server_public_key TEXT NOT NULL,
  server_port INTEGER NOT NULL DEFAULT 51820,
  address_pool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id)
);

CREATE TABLE IF NOT EXISTS vpn_peers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  network_id TEXT NOT NULL REFERENCES vpn_networks(id),
  router_id TEXT REFERENCES routers(id),
  peer_type TEXT NOT NULL CHECK (peer_type IN ('router', 'operator')),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT,
  assigned_address TEXT NOT NULL,
  allowed_ips TEXT NOT NULL,
  endpoint_address TEXT,
  endpoint_port INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'revoked')),
  last_handshake_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(network_id, assigned_address),
  UNIQUE(network_id, public_key)
);

CREATE INDEX IF NOT EXISTS idx_vpn_networks_account ON vpn_networks(account_id);
CREATE INDEX IF NOT EXISTS idx_vpn_peers_account ON vpn_peers(account_id);
CREATE INDEX IF NOT EXISTS idx_vpn_peers_router ON vpn_peers(router_id);
