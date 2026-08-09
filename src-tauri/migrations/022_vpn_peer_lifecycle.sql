PRAGMA foreign_keys = OFF;

-- Keep the newest non-revoked pair for each router. Older accidental
-- duplicates remain available for audit but can no longer be used.
WITH ranked_router_peers AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id, router_id
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC
    ) AS duplicate_rank
  FROM vpn_peers
  WHERE router_id IS NOT NULL AND status <> 'revoked'
)
UPDATE vpn_peers
SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id FROM ranked_router_peers WHERE duplicate_rank > 1
);

CREATE TABLE vpn_peers_v2 (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  network_id TEXT NOT NULL REFERENCES vpn_networks(id),
  router_id TEXT REFERENCES routers(id),
  resource_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO vpn_peers_v2 (
  id, account_id, network_id, router_id, resource_id, peer_type, name,
  public_key, private_key_encrypted, assigned_address, allowed_ips,
  endpoint_address, endpoint_port, status, last_handshake_at, created_at, updated_at
)
SELECT
  id, account_id, network_id, router_id, COALESCE(router_id, id), peer_type,
  name, public_key, private_key_encrypted, assigned_address, allowed_ips,
  endpoint_address, endpoint_port, status, last_handshake_at, created_at, updated_at
FROM vpn_peers;

DROP TABLE vpn_peers;
ALTER TABLE vpn_peers_v2 RENAME TO vpn_peers;

CREATE INDEX idx_vpn_peers_account ON vpn_peers(account_id);
CREATE INDEX idx_vpn_peers_router ON vpn_peers(router_id);
CREATE UNIQUE INDEX uq_vpn_peer_public_key
  ON vpn_peers(network_id, public_key);
CREATE UNIQUE INDEX uq_vpn_peer_active_address
  ON vpn_peers(network_id, assigned_address)
  WHERE status <> 'revoked';
CREATE UNIQUE INDEX uq_vpn_peer_active_resource
  ON vpn_peers(account_id, peer_type, resource_id)
  WHERE status <> 'revoked';
CREATE UNIQUE INDEX uq_vpn_peer_active_router
  ON vpn_peers(account_id, router_id)
  WHERE router_id IS NOT NULL AND status <> 'revoked';

PRAGMA foreign_keys = ON;
