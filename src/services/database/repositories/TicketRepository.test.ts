import { describe, expect, it } from "vitest";
import type { CreateTicketInput, TicketRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseExecuteResult, DatabaseStatement } from "../DatabaseClient";
import { TicketRepository } from "./TicketRepository";

class TicketDatabaseStub implements DatabaseClient {
  constructor(private record: TicketRecord) {}

  async initialize(): Promise<void> {}

  async execute(_sql: string, params: Array<string | number | boolean | null> = []): Promise<DatabaseExecuteResult> {
    this.record = {
      ...this.record,
      status: String(params[0]),
      updated_at: String(params[12])
    };
    return { rowsAffected: 1 };
  }

  async query<T>(): Promise<T[]> {
    return [this.record as T];
  }

  async transaction(_statements: DatabaseStatement[]): Promise<DatabaseExecuteResult[]> {
    return [];
  }
}

describe("TicketRepository", () => {
  it("enregistre un changement de statut uniquement après que l'appelant l'a validé", async () => {
    const current = createTicketRecord();
    const repository = new TicketRepository(new TicketDatabaseStub(current));

    const updated = await repository.update({
      ...ticketInputFromRecord(current),
      status: "expiré",
      sync_status: "synced"
    });

    expect(updated.status).toBe("expiré");
    expect(updated.sync_status).toBe("synced");
  });
});

function createTicketRecord(): TicketRecord {
  return {
    account_id: "account-1",
    activated_at: null,
    batch_id: "batch-1",
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by_profile: "admin",
    created_by_profile_id: "account-1:internal-profile-admin",
    deleted_at: null,
    downloaded_bytes: 0,
    expires_at: null,
    id: "ticket-1",
    ip_address: null,
    mac_address: null,
    mikrotik_id: "*U1",
    password_encrypted: "secret://router-1/123456/password",
    plan_id: "plan-1",
    printed_count: 0,
    router_id: "router-1",
    status: "disponible",
    sync_status: "synced",
    updated_at: "2026-01-01T00:00:00.000Z",
    uploaded_bytes: 0,
    username: "123456"
  };
}

function ticketInputFromRecord(record: TicketRecord): CreateTicketInput {
  return {
    account_id: record.account_id,
    activated_at: record.activated_at,
    batch_id: record.batch_id,
    completed_at: record.completed_at,
    created_by_profile: record.created_by_profile,
    created_by_profile_id: record.created_by_profile_id,
    deleted_at: record.deleted_at,
    downloaded_bytes: record.downloaded_bytes,
    expires_at: record.expires_at,
    id: record.id,
    ip_address: record.ip_address,
    mac_address: record.mac_address,
    mikrotik_id: record.mikrotik_id,
    password_encrypted: record.password_encrypted,
    plan_id: record.plan_id,
    printed_count: record.printed_count,
    router_id: record.router_id,
    status: record.status,
    sync_status: record.sync_status,
    uploaded_bytes: record.uploaded_bytes,
    username: record.username
  };
}
