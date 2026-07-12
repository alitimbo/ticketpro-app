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
        created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
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
        input.sync_status ?? "local"
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le fichier généré n'a pas pu être créé.");
    }

    return created;
  }

  async findById(id: string): Promise<GeneratedFileRecord | null> {
    const rows = await this.database.query<GeneratedFileRecord>("SELECT * FROM generated_files WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async listByBatch(batchId: string): Promise<GeneratedFileRecord[]> {
    return this.database.query<GeneratedFileRecord>(
      "SELECT * FROM generated_files WHERE batch_id = ?1 ORDER BY created_at DESC",
      [batchId]
    );
  }

  async listByAccount(accountId: string, profileId?: string): Promise<GeneratedFileRecord[]> {
    if (profileId) {
      return this.database.query<GeneratedFileRecord>(
        "SELECT * FROM generated_files WHERE account_id = ?1 AND created_by_profile_id = ?2 ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }

    return this.database.query<GeneratedFileRecord>(
      "SELECT * FROM generated_files WHERE account_id = ?1 ORDER BY created_at DESC",
      [accountId]
    );
  }
}
