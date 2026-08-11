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
    commands.push({
      args: ["-A", "TICKETPRO-WG", "-s", pool, "-d", pool, "-j", "ACCEPT"],
      ignoreFailure: false
    });
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
