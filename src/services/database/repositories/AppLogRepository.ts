import type { AppLogRecord, CreateAppLogInput } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class AppLogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateAppLogInput): Promise<AppLogRecord> {
    await this.database.execute(
      `INSERT INTO app_logs (
        id, account_id, level, category, user_message, technical_message,
        router_id, created_by_profile, internal_profile_id, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
        input.id,
        input.account_id,
        input.level,
        input.category,
        input.user_message,
        input.technical_message,
        input.router_id,
        input.created_by_profile,
        input.internal_profile_id,
        input.created_at ?? new Date().toISOString()
      ]
    );

    const rows = await this.database.query<AppLogRecord>("SELECT * FROM app_logs WHERE id = ?1", [input.id]);
    const created = rows[0];

    if (!created) {
      throw new Error("Le journal n'a pas pu être enregistré.");
    }

    return created;
  }

  async findById(id: string): Promise<AppLogRecord | null> {
    const rows = await this.database.query<AppLogRecord>("SELECT * FROM app_logs WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async upsertShared(input: CreateAppLogInput): Promise<AppLogRecord> {
    const existing = await this.findById(input.id);
    if (!existing) return this.create(input);
    if (existing.account_id !== input.account_id) {
      throw new Error("Ce journal appartient à un autre compte.");
    }
    await this.database.execute(
      `UPDATE app_logs SET level = ?1, category = ?2, user_message = ?3,
        technical_message = ?4, router_id = ?5, created_by_profile = ?6,
        internal_profile_id = ?7, created_at = ?8 WHERE id = ?9 AND account_id = ?10`,
      [
        input.level,
        input.category,
        input.user_message,
        input.technical_message,
        input.router_id,
        input.created_by_profile,
        input.internal_profile_id,
        input.created_at ?? existing.created_at,
        input.id,
        input.account_id
      ]
    );
    const updated = await this.database.query<AppLogRecord>("SELECT * FROM app_logs WHERE id = ?1", [input.id]);
    if (!updated[0]) throw new Error("Le journal partagé n'a pas pu être actualisé.");
    return updated[0];
  }

  async listByAccount(accountId: string): Promise<AppLogRecord[]> {
    return this.database.query<AppLogRecord>(
      "SELECT * FROM app_logs WHERE account_id = ?1 ORDER BY created_at DESC",
      [accountId]
    );
  }

  async deleteBefore(accountId: string, before: string, routerId?: string | null): Promise<number> {
    const logs = await this.listByAccount(accountId);
    const removable = logs.filter((log) => {
      if (new Date(log.created_at).getTime() >= new Date(before).getTime()) {
        return false;
      }

      return routerId === undefined || log.router_id === routerId;
    });

    for (const log of removable) {
      await this.database.execute("DELETE FROM app_logs WHERE id = ?1", [log.id]);
    }

    return removable.length;
  }

  async countBefore(accountId: string, before: string, routerId?: string | null): Promise<number> {
    const logs = await this.listByAccount(accountId);
    const cutoff = new Date(before).getTime();
    return logs.filter((log) => {
      const createdAt = new Date(log.created_at).getTime();
      if (!Number.isFinite(createdAt) || createdAt >= cutoff) {
        return false;
      }
      return routerId === undefined || log.router_id === routerId;
    }).length;
  }
}
