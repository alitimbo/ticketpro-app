import { describe, expect, it } from "vitest";
import type { PrintHistoryRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseExecuteResult, DatabaseStatement } from "../DatabaseClient";
import { PrintHistoryRepository } from "./PrintHistoryRepository";

class PrintDatabaseStub implements DatabaseClient {
  readonly transactions: DatabaseStatement[][] = [];
  private record: PrintHistoryRecord | null = null;

  async initialize(): Promise<void> {}

  async execute(): Promise<DatabaseExecuteResult> {
    return { rowsAffected: 1 };
  }

  async query<T>(): Promise<T[]> {
    return this.record ? [this.record as T] : [];
  }

  async transaction(statements: DatabaseStatement[]): Promise<DatabaseExecuteResult[]> {
    this.transactions.push(statements);
    const params = statements[0]?.params ?? [];
    this.record = {
      account_id: String(params[1]),
      batch_id: params[3] === null ? null : String(params[3]),
      created_at: String(params[13]),
      created_by_profile: String(params[11]),
      created_by_profile_id: String(params[12]),
      format: String(params[7]),
      id: String(params[0]),
      mode: String(params[6]),
      printer_id: params[4] === null ? null : String(params[4]),
      printer_name: String(params[5]),
      router_id: params[2] === null ? null : String(params[2]),
      status: String(params[8]),
      ticket_count: Number(params[9]),
      user_message: String(params[10])
    };
    return statements.map(() => ({ rowsAffected: 1 }));
  }
}

describe("PrintHistoryRepository", () => {
  it("incrémente les vouchers du lot seulement après une impression réussie", async () => {
    const database = new PrintDatabaseStub();
    const repository = new PrintHistoryRepository(database);

    await repository.create({
      account_id: "account-1",
      batch_id: "batch-1",
      created_by_profile: "admin",
      created_by_profile_id: "profile-1",
      format: "thermal80",
      id: "print-1",
      mode: "batch",
      printer_id: "printer-1",
      printer_name: "Thermique",
      router_id: "router-1",
      status: "printed",
      ticket_count: 20,
      user_message: "20 vouchers imprimés"
    });

    expect(database.transactions[0]).toHaveLength(2);
    expect(database.transactions[0][1]?.sql).toContain("printed_count = printed_count + 1");
    expect(database.transactions[0][1]?.params).toEqual([
      expect.any(String),
      "account-1",
      "batch-1"
    ]);
  });

  it("n'altère pas les vouchers pendant un simple test imprimante", async () => {
    const database = new PrintDatabaseStub();
    const repository = new PrintHistoryRepository(database);

    await repository.create({
      account_id: "account-1",
      batch_id: "batch-1",
      created_by_profile: "admin",
      created_by_profile_id: "profile-1",
      format: "thermal80",
      id: "print-test",
      mode: "test",
      printer_id: "printer-1",
      printer_name: "Thermique",
      router_id: "router-1",
      status: "prepared",
      ticket_count: 1,
      user_message: "Test préparé"
    });

    expect(database.transactions[0]).toHaveLength(1);
  });
});
