import type { TicketStateHistoryRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export type CreateTicketStateHistoryInput = Omit<TicketStateHistoryRecord, "created_at" | "id"> & {
  created_at?: string;
  id?: string;
};

export class TicketStateHistoryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async record(input: CreateTicketStateHistoryInput): Promise<TicketStateHistoryRecord> {
    const id = input.id ?? `ticket-history-${crypto.randomUUID()}`;
    const createdAt = input.created_at ?? new Date().toISOString();
    await this.database.execute(
      `INSERT INTO ticket_state_history (
        id, account_id, ticket_id, router_id, previous_status, next_status,
        source, message, created_by_profile_id, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
        id,
        input.account_id,
        input.ticket_id,
        input.router_id,
        input.previous_status,
        input.next_status,
        input.source,
        input.message,
        input.created_by_profile_id,
        createdAt
      ]
    );
    const records = await this.database.query<TicketStateHistoryRecord>(
      "SELECT * FROM ticket_state_history WHERE id = ?1",
      [id]
    );
    if (!records[0]) throw new Error("L'historique du ticket n'a pas pu être enregistré.");
    return records[0];
  }

  async listByTicket(ticketId: string): Promise<TicketStateHistoryRecord[]> {
    return this.database.query<TicketStateHistoryRecord>(
      "SELECT * FROM ticket_state_history WHERE ticket_id = ?1 ORDER BY created_at ASC",
      [ticketId]
    );
  }
}
