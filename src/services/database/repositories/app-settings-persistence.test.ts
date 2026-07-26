import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { AppSettingsRepository } from "./AppSettingsRepository";

describe("persistance des paramètres avancés", () => {
  it("crée puis met à jour un réglage JSON", async () => {
    const database = new InMemoryDatabaseClient();
    const settings = new AppSettingsRepository(database);
    await database.initialize();

    await settings.set("app_settings", JSON.stringify({ sessionTimeoutMinutes: 45 }));
    await settings.set("app_settings", JSON.stringify({ sessionTimeoutMinutes: 60 }));

    await expect(settings.get("app_settings")).resolves.toBe(JSON.stringify({ sessionTimeoutMinutes: 60 }));
  });
});
