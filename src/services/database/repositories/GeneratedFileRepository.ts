import type { CreateGeneratedFileInput, GeneratedFileRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";

export class GeneratedFileRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateGeneratedFileInput): Promise<GeneratedFileRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO generated_files (
        id, account_id, router_id, batch_id, type, file_name, file_path, format, created_by_profile,
        created_by_profile_id, metadata_json, sync_status, created_at, updated_at, deleted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      [
        input.id,
        input.account_id,
        input.router_id,
        input.batch_id,
        input.type,
        input.file_name,
        input.file_path,
        input.format,
        input.created_by_profile,
        input.created_by_profile_id,
        input.metadata_json ?? null,
        input.sync_status ?? "local",
        input.created_at ?? new Date().toISOString(),
        input.updated_at ?? input.created_at ?? new Date().toISOString(),
        input.deleted_at ?? null
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le fichier généré n'a pas pu être créé.");
    }

    return created;
  }

  async upsert(input: CreateGeneratedFileInput): Promise<GeneratedFileRecord> {
    const existing = await this.findById(input.id);
    if (!existing) return this.create(input);
    if (existing.account_id !== input.account_id) {
      throw new Error("Ce fichier appartient à un autre compte.");
    }
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `UPDATE generated_files SET
        router_id = ?1, batch_id = ?2, type = ?3, file_name = ?4, file_path = ?5,
        format = ?6, created_by_profile = ?7, created_by_profile_id = ?8,
        metadata_json = ?9, sync_status = ?10, deleted_at = ?11, updated_at = ?12
       WHERE id = ?13 AND account_id = ?14`,
      [
        input.router_id,
        input.batch_id,
        input.type,
        input.file_name,
        input.file_path,
        input.format,
        input.created_by_profile,
        input.created_by_profile_id,
        input.metadata_json ?? null,
        input.sync_status ?? "local",
        input.deleted_at ?? null,
        input.updated_at ?? new Date().toISOString(),
        input.id,
        input.account_id
      ]
    );
    const updated = await this.findById(input.id);
    if (!updated) throw new Error("Le fichier généré n'a pas pu être actualisé.");
    return updated;
  }

  async findById(id: string): Promise<GeneratedFileRecord | null> {
    const rows = await this.database.query<GeneratedFileRecord>("SELECT * FROM generated_files WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async listByBatch(batchId: string): Promise<GeneratedFileRecord[]> {
    return this.database.query<GeneratedFileRecord>(
      "SELECT * FROM generated_files WHERE batch_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [batchId]
    );
  }

  async remove(id: string, accountId: string): Promise<void> {
    const result = await this.database.execute(
      "UPDATE generated_files SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND account_id = ?4",
      [new Date().toISOString(), new Date().toISOString(), id, accountId]
    );

    if (result.rowsAffected === 0) {
      throw new Error("Le fichier est introuvable dans l'historique de ce compte.");
    }
  }

  async markRegenerated(id: string, accountId: string): Promise<void> {
    const result = await this.database.execute(
      "UPDATE generated_files SET updated_at = ?1 WHERE id = ?2 AND account_id = ?3 AND deleted_at IS NULL",
      [new Date().toISOString(), id, accountId]
    );

    if (result.rowsAffected === 0) {
      throw new Error("Le fichier régénéré est introuvable dans l'historique.");
    }
  }

  async listByAccount(accountId: string, profileId?: string): Promise<GeneratedFileRecord[]> {
    if (profileId) {
      return this.database.query<GeneratedFileRecord>(
        "SELECT * FROM generated_files WHERE account_id = ?1 AND created_by_profile_id = ?2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }

    return this.database.query<GeneratedFileRecord>(
      "SELECT * FROM generated_files WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [accountId]
    );
  }

  async listByRouter(routerId: string, accountId: string): Promise<GeneratedFileRecord[]> {
    return this.database.query<GeneratedFileRecord>(
      `SELECT * FROM generated_files
       WHERE router_id = ?1 AND account_id = ?2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [routerId, accountId]
    );
  }

  async listByRouterIncludingDeleted(routerId: string, accountId: string): Promise<GeneratedFileRecord[]> {
    return this.database.query<GeneratedFileRecord>(
      "SELECT * FROM generated_files WHERE router_id = ?1 AND account_id = ?2 ORDER BY created_at DESC",
      [routerId, accountId]
    );
  }
}
