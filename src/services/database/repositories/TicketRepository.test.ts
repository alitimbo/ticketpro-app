import { describe, expect, it } from "vitest";
import type { CreateTicketInput, TicketRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseExecuteResult, DatabaseStatement } from "../DatabaseClient";
import { TicketRepository } from "./TicketRepository";

class TicketDatabaseStub implements DatabaseClient {
  lastQuery = "";

  constructor(private record: TicketRecord) {}

  async initialize(): Promise<void> {}

  async execute(_sql: string, params: Array<string | number | boolean | null> = []): Promise<DatabaseExecuteResult> {
    if (_sql.trim().toLowerCase().startsWith("insert into tickets")) {
      this.record = {
        ...this.record,
        data_limit_mb_snapshot: params[34] as number | null,
        data_remaining_bytes: params[31] as number | null,
        downloaded_bytes: Number(params[15]),
        duration_minutes_snapshot: params[32] as number | null,
        remaining_seconds: params[30] as number | null,
        status: String(params[7]),
        sync_status: String(params[22]) as TicketRecord["sync_status"],
        updated_at: String(params[21]),
        uploaded_bytes: Number(params[16]),
        uptime_seconds: Number(params[29]),
        validity_minutes_snapshot: params[33] as number | null
      };
      return { rowsAffected: 1 };
    }
    this.record = {
      ...this.record,
      status: String(params[0]),
      data_limit_mb_snapshot: params[23] as number | null,
      download_limit_snapshot: params[24] as string | null,
      duration_minutes_snapshot: params[21] as number | null,
      shared_users_snapshot: params[26] as number | null,
      updated_at: String(params[27]),
      upload_limit_snapshot: params[25] as string | null,
      validity_minutes_snapshot: params[22] as number | null
    };
    return { rowsAffected: 1 };
  }

  async query<T>(sql: string): Promise<T[]> {
    this.lastQuery = sql;
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

  it("inclut les tickets supprimés dans la source historique des rapports", async () => {
    const database = new TicketDatabaseStub({
      ...createTicketRecord(),
      deleted_at: "2026-07-10T10:00:00.000Z"
    });
    const repository = new TicketRepository(database);

    await expect(repository.listForReportByAccount("account-1")).resolves.toHaveLength(1);
    expect(database.lastQuery).not.toContain("deleted_at IS NULL");
    expect(database.lastQuery).toContain("account_id = ?1");
  });
  it("fige les limites commerciales apres l'activation du voucher", async () => {
    const current = {
      ...createTicketRecord(),
      activated_at: "2026-01-01T00:05:00.000Z",
      duration_minutes_snapshot: 60,
      validity_minutes_snapshot: 180
    };
    const repository = new TicketRepository(new TicketDatabaseStub(current));

    const updated = await repository.update({
      ...ticketInputFromRecord(current),
      duration_minutes_snapshot: 120,
      validity_minutes_snapshot: 360
    });

    expect(updated.duration_minutes_snapshot).toBe(60);
    expect(updated.validity_minutes_snapshot).toBe(180);
  });

  it("autorise encore l'ajustement d'un voucher vierge non imprime", async () => {
    const current = {
      ...createTicketRecord(),
      duration_minutes_snapshot: 60,
      validity_minutes_snapshot: 180
    };
    const repository = new TicketRepository(new TicketDatabaseStub(current));

    const updated = await repository.update({
      ...ticketInputFromRecord(current),
      duration_minutes_snapshot: 120,
      validity_minutes_snapshot: 360
    });

    expect(updated.duration_minutes_snapshot).toBe(120);
    expect(updated.validity_minutes_snapshot).toBe(360);
  });

  it("refuse une remise a zero publiee par un autre poste", async () => {
    const current = {
      ...createTicketRecord(),
      completed_at: "2026-01-01T01:00:00.000Z",
      downloaded_bytes: 1000,
      duration_minutes_snapshot: 60,
      remaining_seconds: 0,
      status: "consommÃ©",
      uptime_seconds: 3600,
      validity_minutes_snapshot: 180
    };
    const repository = new TicketRepository(new TicketDatabaseStub(current));

    const updated = await repository.upsertShared({
      ...ticketInputFromRecord(current),
      completed_at: null,
      downloaded_bytes: 0,
      duration_minutes_snapshot: 999,
      remaining_seconds: 3600,
      status: "disponible",
      sync_status: "synced",
      uptime_seconds: 0,
      validity_minutes_snapshot: 999
    });

    expect(updated.status).toBe("consommÃ©");
    expect(updated.sync_status).toBe("conflict");
    expect(updated.uptime_seconds).toBe(3600);
    expect(updated.downloaded_bytes).toBe(1000);
    expect(updated.duration_minutes_snapshot).toBe(60);
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

describe("TicketRepository.renameProfileReference", () => {
  it("reporte le renommage du profil RouterOS sur les tickets du plan, utilisés ou non", async () => {
    const statements: Array<{ params: unknown[]; sql: string }> = [];
    const tickets = [
      { ...createTicketRecord(), id: "t1", mikrotik_profile_name: "4H", plan_id: "plan-4h", status: "activé" },
      { ...createTicketRecord(), id: "t2", mikrotik_profile_name: "4H", plan_id: "plan-4h" },
      { ...createTicketRecord(), id: "t3", mikrotik_profile_name: "4H", plan_id: "autre-plan" }
    ];
    const database = {
      execute: async (sql: string, params: unknown[] = []) => { statements.push({ params, sql }); return { rowsAffected: 1 }; },
      initialize: async () => undefined,
      query: async () => tickets,
      transaction: async () => []
    } as unknown as DatabaseClient;

    const count = await new TicketRepository(database).renameProfileReference({
      accountId: tickets[0].account_id, planId: "plan-4h", previousProfileName: "4H", profileName: "6H", routerId: tickets[0].router_id
    });

    expect(count).toBe(2);
    expect(statements.map((statement) => statement.params[2])).toEqual(["t1", "t2"]);
    expect(statements.every((statement) => statement.params[0] === "6H")).toBe(true);
  });
});
