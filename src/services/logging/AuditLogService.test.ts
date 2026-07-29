import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import { AppLogRepository } from "../database/repositories/AppLogRepository";
import { AuditLogService } from "./AuditLogService";

describe("AuditLogService", () => {
  it("enregistre une action métier sans secret", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const audit = new AuditLogService(database);

    await audit.write({
      accountId: "account-a",
      action: "invoice.created",
      category: "systeme",
      internalProfileId: "account-a:internal-profile-admin",
      message: "Facture créée.",
      routerId: "router-a"
    });

    await expect(new AppLogRepository(database).listByAccount("account-a")).resolves.toMatchObject([
      expect.objectContaining({
        category: "systeme",
        created_by_profile: "admin",
        internal_profile_id: "account-a:internal-profile-admin",
        router_id: "router-a",
        user_message: "Facture créée."
      })
    ]);
  });
});
