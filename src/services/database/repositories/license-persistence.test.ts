import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { LicenseStateRepository } from "./LicenseStateRepository";

describe("LicenseStateRepository", () => {
  it("conserve l'activation, le forfait et le quota multi-PC", async () => {
    const database = new InMemoryDatabaseClient();
    const repository = new LicenseStateRepository(database);
    await database.initialize();

    await repository.save({
      account_id: "account-reseller",
      activation_id: "activation-pc-1",
      activation_token_encrypted: "protected-token",
      billing_period: "monthly",
      device_count: 3,
      device_id: "device-1",
      duration_days: 30,
      expires_at: "2026-08-25T00:00:00.000Z",
      id: "current",
      install_id: "install-1",
      last_validated_at: "2026-07-25T00:00:00.000Z",
      license_id: "license-reseller",
      max_devices: 25,
      plan_code: "RESELLER-100",
      plan_description: "Offre revendeur",
      plan_id: "plan-reseller-100",
      plan_name: "Pack Revendeur 100",
      price_cfa: 70000,
      router_count: 12,
      router_limit: 100,
      status: "active"
    });

    await expect(repository.findCurrent()).resolves.toMatchObject({
      activation_id: "activation-pc-1",
      device_count: 3,
      max_devices: 25,
      plan_code: "RESELLER-100",
      router_limit: 100
    });

    await repository.updateValidation("active", 14, 4);
    await expect(repository.findCurrent()).resolves.toMatchObject({ device_count: 4, router_count: 14 });
  });
});
