export function buildTenantFirewallCommands(tenants, interfaceName) {
  if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(interfaceName)) {
    throw new Error("invalid_wireguard_interface");
  }
  const commands = [
    { args: ["-N", "TICKETPRO-WG"], ignoreFailure: true },
    { args: ["-F", "TICKETPRO-WG"], ignoreFailure: false }
  ];
  for (const tenant of Object.values(tenants)) {
    const pool = String(tenant?.address_pool ?? "");
    if (!/^10\.(?:\d{1,3}\.){2}\d{1,3}\/\d{1,2}$/.test(pool)) {
      throw new Error("invalid_tenant_address_pool");
    }
  }

  // Access is granted per active operator/router pair. A broad pool-to-pool
  // rule would let a device whose IP originated in tenant A keep reaching A
  // after that membership was revoked, as long as its key remained active in
  // tenant B. Explicit /32 paths keep each organization independently revocable.
  for (const tenant of Object.values(tenants)) {
    const activePeers = (tenant.peers ?? []).filter((peer) => peer.status === "active");
    const operators = activePeers.filter((peer) => peer.peer_type === "operator");
    const routers = activePeers.filter((peer) => peer.peer_type === "router");
    for (const operator of operators) {
      for (const router of routers) {
        commands.push(
          { args: ["-A", "TICKETPRO-WG", "-s", operator.assigned_address, "-d", router.assigned_address, "-j", "ACCEPT"], ignoreFailure: false },
          { args: ["-A", "TICKETPRO-WG", "-s", router.assigned_address, "-d", operator.assigned_address, "-j", "ACCEPT"], ignoreFailure: false }
        );
      }
    }
  }
  commands.push(
    { args: ["-A", "TICKETPRO-WG", "-j", "DROP"], ignoreFailure: false },
    {
      args: ["-C", "FORWARD", "-i", interfaceName, "-o", interfaceName, "-j", "TICKETPRO-WG"],
      fallbackArgs: ["-I", "FORWARD", "-i", interfaceName, "-o", interfaceName, "-j", "TICKETPRO-WG"],
      ignoreFailure: false
    }
  );
  return commands;
}
