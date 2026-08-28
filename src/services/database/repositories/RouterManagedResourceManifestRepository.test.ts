import { describe, expect, it } from "vitest";
import type { RouterManagedResourceManifest } from "../../../domain/router";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { RouterManagedResourceManifestRepository } from "./RouterManagedResourceManifestRepository";

describe("RouterManagedResourceManifestRepository", () => {
  it("conserve la dernière observation et incrémente sa révision", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const repository = new RouterManagedResourceManifestRepository(database);
    const first = await repository.save("account-1", "router-1", manifest("present"));
    const second = await repository.save("account-1", "router-1", manifest("drift"));

    expect(first.record).toMatchObject({ revision: 1, status: "synced" });
    expect(second.record).toMatchObject({ revision: 2, status: "drift" });
    expect(second.manifest.resources[0]).toMatchObject({ state: "drift" });
    expect(JSON.stringify(second.manifest)).not.toContain("privateKey");
  });
});

function manifest(
  state: RouterManagedResourceManifest["resources"][number]["state"]
): RouterManagedResourceManifest {
  return {
    capturedAt: "2026-08-27T12:00:00.000Z",
    desired: {
      authorizedManagementCidrs: ["192.168.88.0/24", "10.250.0.0/16"],
      managementUsername: "ticketpro-api",
      managedHotspotProfileNames: ["6h"],
      wireguardInterfaceName: "ticketpro-vpn"
    },
    resources: [{
      attributes: { engineVersion: 4 },
      key: "system-script:voucher-lifecycle",
      kind: "voucher_script",
      matchCount: 1,
      ownership: "ticketpro",
      state
    }],
    routerOsVersion: "7.21.5",
    schemaVersion: 1,
    warnings: []
  };
}
