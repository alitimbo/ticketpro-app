import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { InternalProfileRepository } from "./InternalProfileRepository";

describe("persistance des profils internes", () => {
  it("isole les profils par compte et conserve les changements", async () => {
    const database = new InMemoryDatabaseClient();
    const profiles = new InternalProfileRepository(database);

    await database.initialize();
    await database.execute(
      `INSERT INTO internal_profiles (id, account_id, role, display_name, password_hash, is_enabled, permissions_json, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ["account-a:profile-admin", "account-a", "admin", "Admin A", "hash", 1, "[]", null]
    );
    await database.execute(
      `INSERT INTO internal_profiles (id, account_id, role, display_name, password_hash, is_enabled, permissions_json, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ["account-b:profile-admin", "account-b", "admin", "Admin B", "hash", 1, "[]", null]
    );

    await profiles.update({
      accountId: "account-a",
      displayName: "Caisse A",
      id: "account-a:profile-admin",
      isEnabled: 1,
      lastUsedAt: "2026-07-16T10:00:00.000Z",
      passwordHash: "hash-new",
      permissionsJson: "[\"global.home\"]"
    });

    await expect(profiles.listByAccount("account-a")).resolves.toMatchObject([
      expect.objectContaining({ display_name: "Caisse A", password_hash: "hash-new" })
    ]);
    await expect(profiles.listByAccount("account-b")).resolves.toMatchObject([
      expect.objectContaining({ display_name: "Admin B", password_hash: "hash" })
    ]);
  });
});
