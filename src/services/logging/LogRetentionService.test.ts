import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import { AppLogRepository } from "../database/repositories/AppLogRepository";
import { LogRetentionService } from "./LogRetentionService";

describe("LogRetentionService", () => {
  it("persiste la durée et nettoie automatiquement au maximum une fois par jour", async () => {
    const database = new InMemoryDatabaseClient();
    const logs = new AppLogRepository(database);
    const retention = new LogRetentionService(database);
    const now = new Date("2026-07-29T12:00:00.000Z");

    await logs.create(createLog("old-a", "account-a", "2026-07-01T00:00:00.000Z"));
    await logs.create(createLog("recent-a", "account-a", "2026-07-28T00:00:00.000Z"));
    await logs.create(createLog("old-b", "account-b", "2026-07-01T00:00:00.000Z"));

    await expect(retention.setRetentionDays("account-a", 7)).resolves.toBe(7);
    await expect(retention.countEligible("account-a", 7, now)).resolves.toBe(1);

    await expect(retention.runAutomatic("account-a", now)).resolves.toMatchObject({
      ran: true,
      removedCount: 1
    });
    await expect(new LogRetentionService(database).getPolicy("account-a")).resolves.toEqual({
      days: 7,
      lastCleanupAt: now.toISOString()
    });
    await expect(logs.listByAccount("account-a")).resolves.toEqual([
      expect.objectContaining({ id: "recent-a" })
    ]);
    await expect(logs.listByAccount("account-b")).resolves.toEqual([
      expect.objectContaining({ id: "old-b" })
    ]);

    await logs.create(createLog("late-old-a", "account-a", "2026-07-02T00:00:00.000Z"));
    await expect(retention.runAutomatic("account-a", now)).resolves.toEqual({
      ran: false,
      removedCount: 0
    });
    await expect(logs.listByAccount("account-a")).resolves.toHaveLength(2);

    await expect(
      retention.runAutomatic("account-a", new Date("2026-07-30T12:01:00.000Z"))
    ).resolves.toMatchObject({ ran: true, removedCount: 1 });
  });

  it("retombe sur 30 jours lorsqu'une valeur non autorisée est demandée", async () => {
    const database = new InMemoryDatabaseClient();
    const retention = new LogRetentionService(database);

    await expect(retention.setRetentionDays("account-a", 12)).resolves.toBe(30);
    await expect(retention.getPolicy("account-a")).resolves.toMatchObject({ days: 30 });
  });
});

function createLog(id: string, accountId: string, createdAt: string) {
  return {
    account_id: accountId,
    category: "systeme",
    created_at: createdAt,
    created_by_profile: "admin",
    id,
    internal_profile_id: `${accountId}:internal-profile-admin`,
    level: "info" as const,
    router_id: null,
    technical_message: null,
    user_message: "Journal de test"
  };
}
