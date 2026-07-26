import type { CreatePrintHistoryInput, PrintHistoryRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class PrintHistoryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreatePrintHistoryInput): Promise<PrintHistoryRecord> {
    await this.database.execute(
      `INSERT INTO print_history (
        id, account_id, router_id, batch_id, printer_id, printer_name, mode, format,
        status, ticket_count, user_message, created_by_profile, created_by_profile_id, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      [
        input.id,
        input.account_id,
        input.router_id,
        input.batch_id,
        input.printer_id,
        input.printer_name,
        input.mode,
        input.format,
        input.status,
        input.ticket_count,
        input.user_message,
        input.created_by_profile,
        input.created_by_profile_id,
        input.created_at ?? new Date().toISOString()
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("L'historique d'impression n'a pas pu être enregistré.");
    }

    return created;
  }

  async findById(id: string): Promise<PrintHistoryRecord | null> {
    const rows = await this.database.query<PrintHistoryRecord>("SELECT * FROM print_history WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async listByAccount(accountId: string, batchId?: string): Promise<PrintHistoryRecord[]> {
    if (batchId) {
      return this.database.query<PrintHistoryRecord>(
        "SELECT * FROM print_history WHERE account_id = ?1 AND batch_id = ?2 ORDER BY created_at DESC",
        [accountId, batchId]
      );
    }

    return this.database.query<PrintHistoryRecord>(
      "SELECT * FROM print_history WHERE account_id = ?1 ORDER BY created_at DESC",
      [accountId]
    );
  }
}
