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
      message: "Facture créée."
    });

    await expect(new AppLogRepository(database).listByAccount("account-a")).resolves.toMatchObject([
      expect.objectContaining({
        category: "systeme",
        internal_profile_id: "account-a:internal-profile-admin",
        user_message: "[invoice.created] Facture créée."
      })
    ]);
  });
});
