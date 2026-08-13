import type { CreateTicketBatchInput, CreateTicketInput, TicketBatchRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";

export class TicketBatchRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateTicketBatchInput): Promise<TicketBatchRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO ticket_batches (
        id, account_id, router_id, plan_id, operator_profile, quantity, prefix, code_length,
        status, generated_file_id, created_by_profile, created_by_profile_id, sync_status,
        hotspot_server_name, currency, price_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
      [
        input.id,
        input.account_id,
        input.router_id,
        input.plan_id,
        input.operator_profile,
        input.quantity,
        input.prefix,
        input.code_length,
        input.status,
        input.generated_file_id,
        input.created_by_profile,
        input.created_by_profile_id,
        input.sync_status ?? "local",
        input.hotspot_server_name ?? "all",
        normalizeBatchCurrency(input.currency),
        input.price_snapshot ?? null
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le lot de tickets n'a pas pu être créé.");
    }

    return created;
  }

  async createWithTickets(input: CreateTicketBatchInput, tickets: CreateTicketInput[]): Promise<TicketBatchRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);

    await this.database.transaction([
      this.buildBatchInsertStatement(input),
      ...tickets.map((ticket) => this.buildTicketInsertStatement(ticket))
    ]);

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le lot de tickets n'a pas pu être créé.");
    }

    return created;
  }

  async findById(id: string): Promise<TicketBatchRecord | null> {
    const rows = await this.database.query<TicketBatchRecord>("SELECT * FROM ticket_batches WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async upsertShared(input: CreateTicketBatchInput): Promise<TicketBatchRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO ticket_batches (
        id, account_id, router_id, plan_id, operator_profile, quantity, prefix, code_length,
        status, generated_file_id, created_by_profile, created_by_profile_id, created_at,
        updated_at, deleted_at, sync_status, hotspot_server_name, currency, price_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at,
        hotspot_server_name = excluded.hotspot_server_name,
        currency = excluded.currency,
        price_snapshot = excluded.price_snapshot
      WHERE ticket_batches.account_id = excluded.account_id
        AND ticket_batches.router_id = excluded.router_id`,
      [
        input.id,
        input.account_id,
        input.router_id,
        input.plan_id,
        input.operator_profile,
        input.quantity,
        input.prefix,
        input.code_length,
        input.status,
        input.generated_file_id,
        input.created_by_profile,
        input.created_by_profile_id,
        input.created_at ?? new Date().toISOString(),
        input.updated_at ?? new Date().toISOString(),
        input.deleted_at ?? null,
        input.sync_status ?? "synced",
        input.hotspot_server_name ?? "all",
        normalizeBatchCurrency(input.currency),
        input.price_snapshot ?? null
      ]
    );
    const saved = await this.findById(input.id);
    if (!saved || saved.account_id !== input.account_id || saved.router_id !== input.router_id) {
      throw new Error("Ce lot partagé entre en conflit avec une donnée locale existante.");
    }
    return saved;
  }

  async listByRouter(routerId: string): Promise<TicketBatchRecord[]> {
    return this.database.query<TicketBatchRecord>(
      "SELECT * FROM ticket_batches WHERE router_id = ?1 ORDER BY created_at DESC",
      [routerId]
    );
  }

  async listByAccount(accountId: string, profileId?: string): Promise<TicketBatchRecord[]> {
    if (profileId) {
      return this.database.query<TicketBatchRecord>(
        "SELECT * FROM ticket_batches WHERE account_id = ?1 AND created_by_profile_id = ?2 ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }

    return this.database.query<TicketBatchRecord>(
      "SELECT * FROM ticket_batches WHERE account_id = ?1 ORDER BY created_at DESC",
      [accountId]
    );
  }

  async updateState(
    id: string,
    accountId: string,
    status: string,
    syncStatus: CreateTicketBatchInput["sync_status"]
  ): Promise<TicketBatchRecord> {
    await this.database.execute(
      `UPDATE ticket_batches
       SET status = ?1, sync_status = ?2, updated_at = ?3
       WHERE id = ?4 AND account_id = ?5`,
      [status, syncStatus ?? "local", new Date().toISOString(), id, accountId]
    );

    const updated = await this.findById(id);
    if (!updated || updated.account_id !== accountId) {
      throw new Error("Le lot de tickets n'a pas pu être mis à jour.");
    }
    return updated;
  }

  private buildBatchInsertStatement(input: CreateTicketBatchInput): DatabaseStatement {
    return {
      params: [
        input.id,
        input.account_id,
        input.router_id,
        input.plan_id,
        input.operator_profile,
        input.quantity,
        input.prefix,
        input.code_length,
        input.status,
        input.generated_file_id,
        input.created_by_profile,
        input.created_by_profile_id,
        input.sync_status ?? "local",
        input.hotspot_server_name ?? "all",
        normalizeBatchCurrency(input.currency),
        input.price_snapshot ?? null
      ],
      sql: `INSERT INTO ticket_batches (
        id, account_id, router_id, plan_id, operator_profile, quantity, prefix, code_length,
        status, generated_file_id, created_by_profile, created_by_profile_id, sync_status,
        hotspot_server_name, currency, price_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
    };
  }

  private buildTicketInsertStatement(input: CreateTicketInput): DatabaseStatement {
    return {
      params: [
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
        input.sync_status ?? "local",
        input.hotspot_server_name ?? "all",
        input.mikrotik_profile_name ?? null,
        input.exported_at ?? null,
        input.archived_at ?? null,
        input.router_deleted_at ?? null,
        input.last_router_sync_at ?? null,
        input.uptime_seconds ?? 0,
        input.remaining_seconds ?? null,
        input.data_remaining_bytes ?? null
      ],
      sql: `INSERT INTO tickets (
        id, account_id, batch_id, router_id, plan_id, username, password_encrypted, status,
        mac_address, ip_address, activated_at, completed_at, expires_at, deleted_at,
        printed_count, downloaded_bytes, uploaded_bytes, mikrotik_id, created_by_profile,
        created_by_profile_id, sync_status, hotspot_server_name, mikrotik_profile_name,
        exported_at, archived_at, router_deleted_at, last_router_sync_at,
        uptime_seconds, remaining_seconds, data_remaining_bytes
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30)`
    };
  }
}

function normalizeBatchCurrency(value: string | null | undefined): string {
  return value?.trim().slice(0, 12) || "CFA";
}
