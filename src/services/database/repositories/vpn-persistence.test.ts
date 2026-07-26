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
});
