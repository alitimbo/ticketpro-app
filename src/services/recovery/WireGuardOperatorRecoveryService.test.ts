import { describe, expect, it, vi } from "vitest";
import { InMemoryDatabaseClient, VpnPeerRepository } from "../database";
import { WireGuardOperatorRecoveryService } from "./WireGuardOperatorRecoveryService";

describe("WireGuardOperatorRecoveryService", () => {
  it("adopte un tunnel Windows actif reconnu par le VPS", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const service = new WireGuardOperatorRecoveryService(database, "account-a", {
      listInstalled: async () => [{
        active: true,
        assignedAddress: "10.250.7.3",
        publicKey: "public-a",
        tunnelName: "tp-existing"
      }],
      listRemote: async () => [{
        assigned_address: "10.250.7.3/32",
        name: "PC Ali",
        peer_type: "operator",
        public_key: "public-a",
        status: "active"
      }]
    });

    await expect(service.recover(network())).resolves.toEqual({
      adopted: 1,
      removedRevoked: 0,
      unresolved: 0
    });
    expect(await new VpnPeerRepository(database).listByAccount("account-a")).toEqual([
      expect.objectContaining({
        id: "tp-existing",
        private_key_encrypted: null,
        public_key: "public-a",
        status: "active"
      })
    ]);
  });

  it("désinstalle uniquement un tunnel révoqué du compte", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const removeInstalled = vi.fn(async () => undefined);
    const service = new WireGuardOperatorRecoveryService(database, "account-a", {
      listInstalled: async () => [{
        active: false,
        assignedAddress: "10.250.7.3",
        publicKey: "public-revoked",
        tunnelName: "tp-revoked"
      }, {
        active: true,
        assignedAddress: "10.251.7.3",
        publicKey: "other-account",
        tunnelName: "tp-other"
      }],
      listRemote: async () => [{
        assigned_address: "10.250.7.3/32",
        name: "Ancien PC",
        peer_type: "operator",
        public_key: "public-revoked",
        status: "revoked"
      }],
      removeInstalled
    });

    await expect(service.recover(network())).resolves.toEqual({
      adopted: 0,
      removedRevoked: 1,
      unresolved: 1
    });
    expect(removeInstalled).toHaveBeenCalledExactlyOnceWith("tp-revoked");
  });
});

function network() {
  const now = new Date().toISOString();
  return {
    account_id: "account-a",
    address_pool: "10.250.7.0/24",
    created_at: now,
    id: "network-a",
    name: "TicketPro",
    provisioning_api_token_encrypted: null,
    provisioning_api_url: "",
    server_endpoint: "vpn.example.com",
    server_port: 51820,
    server_public_key: "server-public",
    status: "active" as const,
    updated_at: now
  };
}
