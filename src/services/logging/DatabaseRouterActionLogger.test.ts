import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import { AppLogRepository } from "../database/repositories/AppLogRepository";
import { parseTechnicalMessage } from "./technicalMessage";
import { DatabaseRouterActionLogger } from "./DatabaseRouterActionLogger";

describe("DatabaseRouterActionLogger", () => {
  it("conserve l'action, la catégorie, l'acteur et le routeur sans secret", async () => {
    const database = new InMemoryDatabaseClient();
    const logger = new DatabaseRouterActionLogger(database);

    await logger.write({
      accountId: "account-a",
      action: "syncTickets",
      internalProfileId: "account-a:internal-profile-admin",
      internalProfileRole: "admin",
      level: "error",
      routerId: "router-a",
      technicalCode: "router_rejected",
      technicalMessage: "password=router-secret",
      userMessage: "Synchronisation refusée."
    });

    const records = await new AppLogRepository(database).listByAccount("account-a");
    expect(records[0]).toMatchObject({
      category: "synchronisation",
      created_by_profile: "admin",
      router_id: "router-a",
      user_message: "Synchronisation refusée."
    });
    expect(parseTechnicalMessage(records[0].technical_message)).toMatchObject({
      action: "syncTickets",
      code: "router_rejected",
      detail: "password=[MASQUÉ]"
    });
    expect(records[0].technical_message).not.toContain("router-secret");
  });
});
