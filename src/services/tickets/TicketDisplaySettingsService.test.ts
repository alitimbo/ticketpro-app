import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import {
  defaultTicketDisplaySettings,
  TicketDisplaySettingsService
} from "./TicketDisplaySettingsService";

describe("TicketDisplaySettingsService", () => {
  it("conserve des réglages distincts pour chaque routeur", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const service = new TicketDisplaySettingsService(database);

    await expect(service.get("account-1", "router-1")).resolves.toEqual(defaultTicketDisplaySettings);
    await service.save("account-1", "router-1", {
      ...defaultTicketDisplaySettings,
      showPassword: false,
      showQrCode: true
    });

    await expect(service.get("account-1", "router-1")).resolves.toMatchObject({
      showPassword: false,
      showQrCode: true
    });
    await expect(service.get("account-1", "router-2")).resolves.toEqual(defaultTicketDisplaySettings);
  });
});
