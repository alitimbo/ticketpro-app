PRAGMA foreign_keys = ON;

-- Earlier builds could rewrite a WireGuard endpoint as distant_ip when the
-- operator temporarily selected the local connection. Restore the mode from
-- the router peer, whose assigned address is the authoritative VPN endpoint.
UPDATE router_connections
SET
  mode = 'vpn',
  port = 8728,
  use_ssl = 0,
  updated_at = CURRENT_TIMESTAMP
WHERE mode = 'distant_ip'
  AND EXISTS (
    SELECT 1
    FROM vpn_peers
    WHERE vpn_peers.router_id = router_connections.router_id
      AND vpn_peers.peer_type = 'router'
      AND vpn_peers.status IN ('draft', 'active')
      AND (
        vpn_peers.assigned_address = router_connections.host
        OR substr(vpn_peers.assigned_address, 1, instr(vpn_peers.assigned_address, '/') - 1) = router_connections.host
      )
  );
