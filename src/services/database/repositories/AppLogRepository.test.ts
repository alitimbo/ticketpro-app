import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { AppLogRepository } from "./AppLogRepository";

describe("AppLogRepository", () => {
  it("nettoie uniquement les anciens journaux du compte demandé", async () => {
    const database = new InMemoryDatabaseClient();
    const repository = new AppLogRepository(database);

    await repository.create(createLog("old-a", "account-a", "2026-01-01T00:00:00.000Z"));
    await repository.create(createLog("recent-a", "account-a", "2026-07-29T00:00:00.000Z"));
    await repository.create(createLog("old-b", "account-b", "2026-01-01T00:00:00.000Z"));

    await expect(
      repository.countBefore("account-a", "2026-07-01T00:00:00.000Z")
    ).resolves.toBe(1);
    await expect(
      repository.deleteBefore("account-a", "2026-07-01T00:00:00.000Z")
    ).resolves.toBe(1);
    await expect(repository.listByAccount("account-a")).resolves.toEqual([
      expect.objectContaining({ id: "recent-a" })
    ]);
    await expect(repository.listByAccount("account-b")).resolves.toEqual([
      expect.objectContaining({ id: "old-b" })
    ]);
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
