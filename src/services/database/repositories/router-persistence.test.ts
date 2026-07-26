import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { RouterRepository } from "./RouterRepository";

describe("persistance des tests de connexion routeur", () => {
  it("met à jour le statut du routeur et de sa connexion dans une transaction", async () => {
    const database = new InMemoryDatabaseClient();
    const routers = new RouterRepository(database);

    await database.initialize();
    await routers.createWithConnections(
      {
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
      },
      [
        {
          host: "192.168.88.1",
          id: "router-test:local",
          last_connected_at: null,
          last_error: null,
          mode: "local",
          port: 8728,
          router_id: "router-test",
          status: "inactive",
          use_ssl: 0
        }
      ]
    );

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
});
