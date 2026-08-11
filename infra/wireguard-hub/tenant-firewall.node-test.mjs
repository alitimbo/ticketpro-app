import assert from "node:assert/strict";
import test from "node:test";
import { buildTenantFirewallCommands } from "./tenant-firewall.mjs";

test("chaque organisation ne peut atteindre que son propre pool", () => {
  const commands = buildTenantFirewallCommands({
    organizationA: { address_pool: "10.250.0.0/24" },
    organizationB: { address_pool: "10.250.1.0/24" }
  }, "wg0");
  const acceptRules = commands.filter((command) => command.args.at(-1) === "ACCEPT");
  assert.deepEqual(acceptRules.map((command) => command.args), [
    ["-A", "TICKETPRO-WG", "-s", "10.250.0.0/24", "-d", "10.250.0.0/24", "-j", "ACCEPT"],
    ["-A", "TICKETPRO-WG", "-s", "10.250.1.0/24", "-d", "10.250.1.0/24", "-j", "ACCEPT"]
  ]);
  assert.equal(commands.some((command) => (
    command.args.includes("10.250.0.0/24") && command.args.includes("10.250.1.0/24")
  )), false);
  assert.deepEqual(commands.at(-2).args, ["-A", "TICKETPRO-WG", "-j", "DROP"]);
});
