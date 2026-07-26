import type { CreateTicketInput, TicketRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";

export class TicketRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateTicketInput): Promise<TicketRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO tickets (
        id, account_id, batch_id, router_id, plan_id, username, password_encrypted, status,
        mac_address, ip_address, activated_at, completed_at, expires_at, deleted_at,
        printed_count, downloaded_bytes, uploaded_bytes, mikrotik_id, created_by_profile,
        created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
      [
        input.id,
        input.account_id,
        input.batch_id,
        input.router_id,
        input.plan_id,
        input.username,
        input.password_encrypted,
        input.status,
        input.mac_address,
        input.ip_address,
        input.activated_at,
        input.completed_at,
        input.expires_at,
        input.deleted_at,
        input.printed_count,
        input.downloaded_bytes,
        input.uploaded_bytes,
        input.mikrotik_id,
        input.created_by_profile,
        input.created_by_profile_id,
        input.sync_status ?? "local"
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le ticket n'a pas pu être créé.");
    }

    return created;
  }

  async findById(id: string): Promise<TicketRecord | null> {
    const rows = await this.database.query<TicketRecord>("SELECT * FROM tickets WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async update(input: CreateTicketInput): Promise<TicketRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `UPDATE tickets SET
        status = ?1, mac_address = ?2, ip_address = ?3, activated_at = ?4, completed_at = ?5,
        expires_at = ?6, deleted_at = ?7, printed_count = ?8, downloaded_bytes = ?9,
        uploaded_bytes = ?10, mikrotik_id = ?11, sync_status = ?12, updated_at = ?13
      WHERE id = ?14 AND account_id = ?15`,
      [
        input.status,
        input.mac_address,
        input.ip_address,
        input.activated_at,
        input.completed_at,
        input.expires_at,
        input.deleted_at,
        input.printed_count,
        input.downloaded_bytes,
        input.uploaded_bytes,
        input.mikrotik_id,
        input.sync_status ?? "local",
        input.updated_at ?? new Date().toISOString(),
        input.id,
        input.account_id
      ]
    );

    const updated = await this.findById(input.id);

    if (!updated) {
      throw new Error("Le ticket n'a pas pu être mis à jour.");
    }

    return updated;
  }

  async listByBatch(batchId: string): Promise<TicketRecord[]> {
    return this.database.query<TicketRecord>("SELECT * FROM tickets WHERE batch_id = ?1 ORDER BY created_at ASC", [
      batchId
    ]);
  }

  async listByRouter(routerId: string): Promise<TicketRecord[]> {
    return this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [routerId]
    );
  }

  async listByAccount(accountId: string, profileId?: string): Promise<TicketRecord[]> {
    if (profileId) {
      return this.database.query<TicketRecord>(
        "SELECT * FROM tickets WHERE account_id = ?1 AND created_by_profile_id = ?2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }

    return this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [accountId]
    );
  }
}
