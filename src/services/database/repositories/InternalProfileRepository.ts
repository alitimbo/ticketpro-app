import type { InternalProfileRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class InternalProfileRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listByAccount(accountId: string): Promise<InternalProfileRecord[]> {
    return this.database.query<InternalProfileRecord>(
      "SELECT * FROM internal_profiles WHERE account_id = ?1 ORDER BY role ASC",
      [accountId]
    );
  }

  async update(input: {
    accountId: string;
    displayName: string;
    id: string;
    isEnabled: number;
    lastUsedAt: string | null;
    passwordHash: string;
    permissionsJson: string;
  }): Promise<void> {
    await this.database.execute(
      `UPDATE internal_profiles SET
        display_name = ?1, password_hash = ?2, is_enabled = ?3,
        permissions_json = ?4, last_used_at = ?5, updated_at = ?6
      WHERE id = ?7 AND account_id = ?8`,
      [
        input.displayName,
        input.passwordHash,
        input.isEnabled,
        input.permissionsJson,
        input.lastUsedAt,
        new Date().toISOString(),
        input.id,
        input.accountId
      ]
    );
  }

  async recordUsed(accountId: string, id: string, usedAt = new Date().toISOString()): Promise<void> {
    await this.database.execute(
      "UPDATE internal_profiles SET last_used_at = ?1, updated_at = ?2 WHERE id = ?3 AND account_id = ?4",
      [usedAt, usedAt, id, accountId]
    );
  }
}
