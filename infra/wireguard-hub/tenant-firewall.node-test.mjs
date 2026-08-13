import assert from "node:assert/strict";
import test from "node:test";
import { buildTenantFirewallCommands } from "./tenant-firewall.mjs";

test("chaque opérateur ne peut atteindre que les routeurs actifs de ses organisations", () => {
  const commands = buildTenantFirewallCommands({
    organizationA: {
      address_pool: "10.250.0.0/24",
      peers: [
        peer("operator", "10.250.0.5/32"),
        peer("router", "10.250.0.2/32")
      ]
    },
    organizationB: {
      address_pool: "10.250.1.0/24",
      peers: [
        peer("operator", "10.250.0.5/32"),
        peer("router", "10.250.1.6/32"),
        { ...peer("router", "10.250.1.7/32"), status: "revoked" }
      ]
    }
  }, "wg0");
  const acceptRules = commands.filter((command) => command.args.at(-1) === "ACCEPT");
  assert.deepEqual(acceptRules.map((command) => command.args), [
    ["-A", "TICKETPRO-WG", "-s", "10.250.0.5/32", "-d", "10.250.0.2/32", "-j", "ACCEPT"],
    ["-A", "TICKETPRO-WG", "-s", "10.250.0.2/32", "-d", "10.250.0.5/32", "-j", "ACCEPT"],
    ["-A", "TICKETPRO-WG", "-s", "10.250.0.5/32", "-d", "10.250.1.6/32", "-j", "ACCEPT"],
    ["-A", "TICKETPRO-WG", "-s", "10.250.1.6/32", "-d", "10.250.0.5/32", "-j", "ACCEPT"]
  ]);
  assert.equal(commands.some((command) => command.args.includes("10.250.1.7/32")), false);
  assert.deepEqual(commands.at(-2).args, ["-A", "TICKETPRO-WG", "-j", "DROP"]);
});

test("révoquer une appartenance retire uniquement ses chemins", () => {
  const commands = buildTenantFirewallCommands({
    organizationA: {
      address_pool: "10.250.0.0/24",
      peers: [
        { ...peer("operator", "10.250.0.5/32"), status: "disabled" },
        peer("router", "10.250.0.2/32")
      ]
    },
    organizationB: {
      address_pool: "10.250.1.0/24",
      peers: [
        peer("operator", "10.250.0.5/32"),
        peer("router", "10.250.1.6/32")
      ]
    }
  }, "wg0");

  assert.equal(commands.some((command) => command.args.includes("10.250.0.2/32")), false);
  assert.equal(commands.some((command) => command.args.includes("10.250.1.6/32")), true);
});

function peer(peerType, assignedAddress) {
  return { assigned_address: assignedAddress, peer_type: peerType, status: "active" };
}
