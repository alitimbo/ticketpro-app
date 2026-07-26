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
        status, generated_file_id, created_by_profile, created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
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
        input.sync_status ?? "local"
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
        input.sync_status ?? "local"
      ],
      sql: `INSERT INTO ticket_batches (
        id, account_id, router_id, plan_id, operator_profile, quantity, prefix, code_length,
        status, generated_file_id, created_by_profile, created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
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
        input.sync_status ?? "local"
      ],
      sql: `INSERT INTO tickets (
        id, account_id, batch_id, router_id, plan_id, username, password_encrypted, status,
        mac_address, ip_address, activated_at, completed_at, expires_at, deleted_at,
        printed_count, downloaded_bytes, uploaded_bytes, mikrotik_id, created_by_profile,
        created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`
    };
  }
}
