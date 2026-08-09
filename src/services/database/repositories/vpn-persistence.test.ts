import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { VpnNetworkRepository } from "./VpnNetworkRepository";
import { VpnPeerRepository } from "./VpnPeerRepository";

describe("VPN persistence", () => {
  it("isole les réseaux et les pairs par compte", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const networks = new VpnNetworkRepository(database);
    const peers = new VpnPeerRepository(database);

    await networks.create({
      id: "network-a",
      account_id: "account-a",
      name: "A",
      server_endpoint: "vpn-a.example.com",
      server_public_key: "server-a",
      server_port: 51820,
      address_pool: "10.250.0.0/24",
      provisioning_api_url: "",
      provisioning_api_token_encrypted: null,
      status: "active"
    });
    await networks.create({
      id: "network-b",
      account_id: "account-b",
      name: "B",
      server_endpoint: "vpn-b.example.com",
      server_public_key: "server-b",
      server_port: 51820,
      address_pool: "10.251.0.0/24",
      provisioning_api_url: "",
      provisioning_api_token_encrypted: null,
      status: "active"
    });
    await peers.create({
      id: "peer-a",
      account_id: "account-a",
      network_id: "network-a",
      router_id: "router-a",
      resource_id: "router-a",
      peer_type: "router",
      name: "Routeur A",
      public_key: "public-a",
      private_key_encrypted: "encrypted:a.b",
      assigned_address: "10.250.0.2/24",
      allowed_ips: "10.250.0.2/32",
      endpoint_address: null,
      endpoint_port: null,
      status: "active",
      last_handshake_at: null
    });

    expect((await networks.findByAccount("account-a"))?.id).toBe("network-a");
    expect(await networks.findByAccount("account-b")).not.toBeNull();
    expect((await peers.findByRouter("account-a", "router-a"))?.id).toBe("peer-a");
    expect(await peers.findByRouter("account-b", "router-a")).toBeNull();
    expect((await peers.listByAccount("account-b"))).toHaveLength(0);
  });

  it("remplace atomiquement un ancien pair quand le hub réattribue son adresse", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const peers = new VpnPeerRepository(database);

    await peers.create(peerInput({
      id: "old-peer",
      name: "PC Ali Test",
      public_key: "old-public-key",
      status: "active"
    }));

    const conflicts = await peers.findAssignmentConflicts(
      "account-a",
      "network-a",
      "10.250.0.2/32",
      "new-public-key"
    );
    expect(conflicts.map((peer) => peer.id)).toEqual(["old-peer"]);

    const replacement = await peers.create(peerInput({
      id: "new-peer",
      name: "PC Ali Test2",
      public_key: "new-public-key",
      status: "draft"
    }));

    expect(replacement.id).toBe("new-peer");
    expect(await peers.listByAccount("account-a")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "old-peer", status: "revoked" }),
      expect.objectContaining({
        id: "new-peer",
        assigned_address: "10.250.0.2/32",
        public_key: "new-public-key"
      })
    ]));
  });

  it("retourne le pair existant lors d'une répétition strictement identique", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const peers = new VpnPeerRepository(database);
    const existing = await peers.create(peerInput({ id: "peer-a" }));
    const repeated = await peers.create(peerInput({ id: "peer-b" }));

    expect(repeated.id).toBe(existing.id);
    expect(await peers.listByAccount("account-a")).toHaveLength(1);
  });

  it("refuse de réactiver une clé déjà révoquée", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const peers = new VpnPeerRepository(database);
    await peers.create(peerInput({ id: "revoked-peer", status: "revoked" }));

    await expect(peers.create(peerInput({ id: "reused-peer", status: "active" })))
      .rejects.toThrow("ne peut pas être réactivée");
  });
});

function peerInput(
  overrides: Partial<Parameters<VpnPeerRepository["create"]>[0]> = {}
): Parameters<VpnPeerRepository["create"]>[0] {
  return {
    id: "peer-a",
    account_id: "account-a",
    network_id: "network-a",
    router_id: null,
    peer_type: "operator",
    name: "PC",
    public_key: "public-key",
    private_key_encrypted: "encrypted:a.b",
    assigned_address: "10.250.0.2/32",
    allowed_ips: "10.250.0.2/32",
    endpoint_address: "vpn.example.com",
    endpoint_port: 51820,
    status: "active",
    last_handshake_at: null,
    ...overrides,
    resource_id: overrides.resource_id ?? "operator:test-pc"
  };
}
