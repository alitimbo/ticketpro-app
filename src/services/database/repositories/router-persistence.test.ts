import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { RouterConnectionRepository } from "./RouterConnectionRepository";
import { RouterRepository } from "./RouterRepository";
import { VpnPeerRepository } from "./VpnPeerRepository";

describe("persistance des tests de connexion routeur", () => {
  it("met à jour le statut du routeur et de sa connexion dans une transaction", async () => {
    const database = new InMemoryDatabaseClient();
    const routers = new RouterRepository(database);
    const connections = new RouterConnectionRepository(database);

    await database.initialize();
    await routers.create({
      account_id: "account-test",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "RB5009",
      connection_mode: "local",
      created_by_profile_id: "account-test:internal-profile-admin",
      encrypted_password: "encrypted:test",
      id: "router-test",
      label: "Routeur test",
      last_seen_at: null,
      local_ip: "192.168.88.1",
      model: "RB5009",
      name: "Routeur test",
      notes: "",
      routeros_version: "7.15",
      serial_number: "SERIAL-1",
      status: "warning",
      username: "admin",
      zone_id: null
    });
    await connections.create({
      host: "192.168.88.1",
      id: "router-test:local",
      last_connected_at: null,
      last_error: null,
      mode: "local",
      port: 8728,
      router_id: "router-test",
      status: "inactive",
      use_ssl: 0
    });

    await routers.recordConnectionTest({
      accountId: "account-test",
      checkedAt: "2026-07-13T12:00:00.000Z",
      errorMessage: null,
      internalProfileId: "account-test:internal-profile-admin",
      mode: "local",
      routerId: "router-test",
      status: "connected"
    });

    expect(await routers.findById("router-test")).toMatchObject({
      last_seen_at: "2026-07-13T12:00:00.000Z",
      status: "active"
    });
    await expect(database.query("SELECT * FROM router_connections WHERE router_id = ?1", ["router-test"])).resolves.toMatchObject([
      expect.objectContaining({
        id: "router-test:local",
        last_connected_at: "2026-07-13T12:00:00.000Z",
        status: "active"
      })
    ]);
  });

  it("refuse le parcours atomique si la connexion RouterOS n'a pas été validée", async () => {
    const database = new InMemoryDatabaseClient();
    const routers = new RouterRepository(database);

    await database.initialize();

    await expect(
      routers.createWithConnections(
        {
          account_id: "account-test",
          api_port: 8728,
          api_ssl_port: 8729,
          board_name: "RB5009",
          connection_mode: "local",
          created_by_profile_id: "account-test:internal-profile-admin",
          encrypted_password: "encrypted:test",
          id: "router-unvalidated",
          label: "Routeur non validé",
          last_seen_at: null,
          local_ip: "192.168.88.2",
          model: "RB5009",
          name: "Routeur non validé",
          notes: "",
          routeros_version: "7.15",
          serial_number: "SERIAL-2",
          status: "warning",
          username: "admin",
          zone_id: null
        },
        []
      )
    ).rejects.toThrow("Testez et validez la connexion RouterOS");
  });

  it("ne supprime localement un routeur VPN qu'après confirmation distante et libère son quota", async () => {
    const database = new InMemoryDatabaseClient();
    const routers = new RouterRepository(database);
    const peers = new VpnPeerRepository(database);
    await database.initialize();

    await routers.create({
      account_id: "account-delete",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "hAP ax2",
      connection_mode: "vpn",
      created_by_profile_id: "account-delete:internal-profile-admin",
      encrypted_password: "encrypted:test",
      id: "router-delete",
      label: "Routeur à supprimer",
      last_seen_at: null,
      local_ip: "192.168.88.1",
      model: "C52iG-5HaxD2HaxD",
      name: "Routeur à supprimer",
      notes: "",
      routeros_version: "7.21",
      serial_number: "DELETE-001",
      status: "active",
      username: "ticketpro-api",
      zone_id: null
    });
    await peers.create({
      account_id: "account-delete",
      allowed_ips: "10.250.1.2/32",
      assigned_address: "10.250.1.2/32",
      endpoint_address: null,
      endpoint_port: null,
      id: "peer-router-delete",
      last_handshake_at: null,
      name: "Routeur à supprimer",
      network_id: "network-delete",
      peer_type: "router",
      private_key_encrypted: "encrypted:key",
      public_key: "router-public-key",
      resource_id: "router-delete",
      router_id: "router-delete",
      status: "active"
    });
    await database.execute(
      `INSERT INTO ticket_batches (id, account_id, router_id, status, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
      ["batch-delete", "account-delete", "router-delete", "terminé", null]
    );
    await database.execute(
      `INSERT INTO tickets (
        id, account_id, batch_id, router_id, username, status, deleted_at,
        archived_at, router_deleted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      [
        "ticket-delete",
        "account-delete",
        "batch-delete",
        "router-delete",
        "TP-DELETE",
        "disponible",
        null,
        null,
        null
      ]
    );

    await expect(routers.remove("account-delete", "router-delete"))
      .rejects.toThrow("Révoquez d'abord le pair VPN");

    await routers.remove("account-delete", "router-delete", {
      vpnRevocationConfirmed: true
    });

    await expect(routers.countSubscriptionRoutersByAccount("account-delete")).resolves.toBe(0);
    await expect(routers.listByAccount("account-delete")).resolves.toEqual([]);
    await expect(peers.listByAccount("account-delete")).resolves.toEqual([
      expect.objectContaining({ id: "peer-router-delete", status: "revoked" })
    ]);
    await expect(database.query("SELECT * FROM ticket_batches WHERE id = ?1", ["batch-delete"]))
      .resolves.toEqual([
        expect.objectContaining({ deleted_at: expect.any(String), status: "supprimé" })
      ]);
    await expect(database.query("SELECT * FROM tickets WHERE id = ?1", ["ticket-delete"]))
      .resolves.toEqual([
        expect.objectContaining({
          archived_at: expect.any(String),
          deleted_at: expect.any(String),
          router_deleted_at: expect.any(String),
          status: "supprimé"
        })
      ]);
  });
});
