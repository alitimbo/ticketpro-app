import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import type { CreateTicketInput } from "../src/domain/database/entities";
import type {
  DatabaseClient,
  DatabaseExecuteResult,
  DatabaseStatement,
  DatabaseValue
} from "../src/services/database/DatabaseClient";
import { SyncOutboxRepository } from "../src/services/database/repositories/SyncOutboxRepository";
import { TicketBatchRepository } from "../src/services/database/repositories/TicketBatchRepository";

type BenchmarkResult = {
  count: number;
  databaseBytes: number;
  duplicateUsernames: number;
  idempotentOutboxRows: number;
  memoryDeltaMb: number;
  outboxEnqueueMs: number;
  outboxRows: number;
  persistenceMs: number;
  snapshotRows: number;
  ticketRows: number;
};

class NodeSqliteDatabaseClient implements DatabaseClient {
  readonly sqlite = new DatabaseSync(":memory:");

  async initialize(): Promise<void> {
    this.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = MEMORY; PRAGMA synchronous = NORMAL;");
  }

  async execute(sql: string, params: DatabaseValue[] = []): Promise<DatabaseExecuteResult> {
    const result = this.sqlite.prepare(normalizeParameters(sql)).run(...params.map(normalizeSqliteValue));
    return { rowsAffected: changesAsNumber(result) };
  }

  async query<T>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
    return this.sqlite.prepare(normalizeParameters(sql)).all(...params.map(normalizeSqliteValue)) as T[];
  }

  async transaction(statements: DatabaseStatement[]): Promise<DatabaseExecuteResult[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const result = this.sqlite
          .prepare(normalizeParameters(statement.sql))
          .run(...(statement.params ?? []).map(normalizeSqliteValue));
        return { rowsAffected: changesAsNumber(result) };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}

const counts = parseCounts(process.argv.slice(2));
const results: BenchmarkResult[] = [];

for (const count of counts) {
  results.push(await runBenchmark(count));
}

const failed = results.some((result) =>
  result.ticketRows !== result.count
  || result.snapshotRows !== result.count
  || result.outboxRows !== result.count
  || result.idempotentOutboxRows !== result.count
  || result.duplicateUsernames !== 0
);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: "SQLite in-memory, migrations TicketPro reelles, aucun appel RouterOS",
  results,
  status: failed ? "FAILED" : "PASSED"
}, null, 2));

if (failed) process.exitCode = 1;

async function runBenchmark(count: number): Promise<BenchmarkResult> {
  const database = new NodeSqliteDatabaseClient();
  try {
    await database.initialize();
    applyMigrations(database.sqlite);
    seedDependencies(database.sqlite, count);

    const batchId = `sprint5-batch-${count}`;
    const tickets = createTickets(batchId, count);
    const heapBefore = process.memoryUsage().heapUsed;
    const repository = new TicketBatchRepository(database);
    const persistenceStartedAt = performance.now();
    await repository.createWithTickets({
      account_id: "account-sprint5",
      code_length: 10,
      currency: "CFA",
      created_by_profile: "admin",
      created_by_profile_id: "account-sprint5:profile-admin",
      generated_file_id: null,
      hotspot_server_name: "ticketpro-hotspot",
      id: batchId,
      operator_profile: "admin",
      plan_id: "plan-sprint5",
      prefix: "S5",
      price_snapshot: 100,
      quantity: count,
      router_id: "router-sprint5",
      status: "pending",
      sync_status: "pending"
    }, tickets);
    const persistenceMs = performance.now() - persistenceStartedAt;

    const outbox = new SyncOutboxRepository(database);
    const outboxStartedAt = performance.now();
    await enqueueVoucherOperations(outbox, tickets);
    const outboxEnqueueMs = performance.now() - outboxStartedAt;
    await enqueueVoucherOperations(outbox, tickets);

    const ticketRows = scalar(database.sqlite, "SELECT COUNT(*) FROM tickets WHERE batch_id = ?1", batchId);
    const snapshotRows = scalar(
      database.sqlite,
      `SELECT COUNT(*) FROM tickets
       WHERE batch_id = ?1
         AND duration_minutes_snapshot = 60
         AND validity_minutes_snapshot = 180
         AND data_limit_mb_snapshot = 1024
         AND download_limit_snapshot = '5M'
         AND upload_limit_snapshot = '2M'
         AND shared_users_snapshot = 1`,
      batchId
    );
    const duplicateUsernames = scalar(
      database.sqlite,
      `SELECT COUNT(*) FROM (
         SELECT username FROM tickets WHERE batch_id = ?1 GROUP BY username HAVING COUNT(*) > 1
       )`,
      batchId
    );
    const outboxRows = scalar(
      database.sqlite,
      "SELECT COUNT(*) FROM sync_outbox WHERE correlation_id = ?1",
      batchId
    );
    const idempotentOutboxRows = outboxRows;
    const databaseBytes = scalar(database.sqlite, "PRAGMA page_count")
      * scalar(database.sqlite, "PRAGMA page_size");

    return {
      count,
      databaseBytes,
      duplicateUsernames,
      idempotentOutboxRows,
      memoryDeltaMb: roundMb(process.memoryUsage().heapUsed - heapBefore),
      outboxEnqueueMs: roundMs(outboxEnqueueMs),
      outboxRows,
      persistenceMs: roundMs(persistenceMs),
      snapshotRows,
      ticketRows
    };
  } finally {
    database.close();
  }
}

async function enqueueVoucherOperations(
  outbox: SyncOutboxRepository,
  tickets: CreateTicketInput[]
): Promise<void> {
  await outbox.enqueueMany(tickets.map((ticket) => ({
      account_id: ticket.account_id,
      aggregate_id: ticket.id,
      aggregate_type: "ticket",
      correlation_id: ticket.batch_id,
      idempotency_key: `routeros:voucher:create:${ticket.router_id}:${ticket.id}`,
      max_attempts: 8,
      operation_type: "routeros.voucher.create",
      payload: { ticketId: ticket.id },
      priority: 20,
      router_id: ticket.router_id
    })));
}

function applyMigrations(database: DatabaseSync): void {
  const directory = resolve(process.cwd(), "src-tauri", "migrations");
  const migrations = readdirSync(directory)
    .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
    .sort();
  for (const migration of migrations) {
    database.exec(readFileSync(resolve(directory, migration), "utf8"));
  }
}

function seedDependencies(database: DatabaseSync, count: number): void {
  const suffix = String(count);
  database.prepare(normalizeParameters(
    "INSERT INTO accounts (id, email, password_hash, display_name, status) VALUES (?1, ?2, ?3, ?4, 'active')"
  )).run("account-sprint5", `sprint5-${suffix}@ticketpro.invalid`, "not-a-real-secret", "Sprint 5");
  database.prepare(normalizeParameters(
    `INSERT INTO internal_profiles (
      id, account_id, role, display_name, password_hash, permissions_json
    ) VALUES (?1, ?2, 'admin', 'Sprint 5', ?3, '[]')`
  )).run("account-sprint5:profile-admin", "account-sprint5", "not-a-real-secret");
  database.prepare(normalizeParameters(
    `INSERT INTO routers (
      id, name, label, local_ip, username, encrypted_password, account_id,
      created_by_profile_id, subscription_counted
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)`
  )).run(
    "router-sprint5",
    "Routeur Sprint 5",
    "Routeur Sprint 5",
    "192.0.2.1",
    "ticketpro-api",
    "secret://sprint5/router-password",
    "account-sprint5",
    "account-sprint5:profile-admin"
  );
  database.prepare(normalizeParameters(
    `INSERT INTO hotspot_plans (
      id, router_id, name, duration_minutes, validity_minutes, data_limit_mb,
      download_limit, upload_limit, shared_users, price_hint,
      mikrotik_profile_name, status, currency, mikrotik_id,
      created_by_profile_id, updated_by_profile_id
    ) VALUES (?1, ?2, ?3, 60, 180, 1024, '5M', '2M', 1, 100, ?4, 'active', 'CFA', ?5, ?6, ?6)`
  )).run(
    "plan-sprint5",
    "router-sprint5",
    "Sprint 5 - 1h",
    "sprint5-1h",
    "*S5",
    "account-sprint5:profile-admin",
    "account-sprint5:profile-admin"
  );
}

function createTickets(batchId: string, count: number): CreateTicketInput[] {
  return Array.from({ length: count }, (_, index) => {
    const serial = String(index + 1).padStart(8, "0");
    return {
      account_id: "account-sprint5",
      activated_at: null,
      archived_at: null,
      batch_id: batchId,
      completed_at: null,
      created_by_profile: "admin",
      created_by_profile_id: "account-sprint5:profile-admin",
      data_limit_mb_snapshot: 1024,
      data_remaining_bytes: 1024 * 1024 * 1024,
      deleted_at: null,
      download_limit_snapshot: "5M",
      downloaded_bytes: 0,
      duration_minutes_snapshot: 60,
      expires_at: null,
      exported_at: null,
      hotspot_server_name: "ticketpro-hotspot",
      id: `sprint5-ticket-${count}-${serial}`,
      ip_address: null,
      last_router_sync_at: null,
      mac_address: null,
      mikrotik_id: null,
      mikrotik_profile_name: "sprint5-1h",
      password_encrypted: `secret://sprint5/ticket-${count}-${serial}`,
      plan_id: "plan-sprint5",
      printed_count: 0,
      remaining_seconds: 3600,
      router_deleted_at: null,
      router_id: "router-sprint5",
      shared_users_snapshot: 1,
      status: "disponible",
      sync_status: "pending",
      uploaded_bytes: 0,
      upload_limit_snapshot: "2M",
      uptime_seconds: 0,
      username: `S5${serial}`,
      validity_minutes_snapshot: 180
    };
  });
}

function scalar(database: DatabaseSync, sql: string, parameter?: string): number {
  const row = (parameter === undefined
    ? database.prepare(normalizeParameters(sql)).get()
    : database.prepare(normalizeParameters(sql)).get(parameter)) as Record<string, number | bigint> | undefined;
  const value = row ? Object.values(row)[0] : 0;
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function normalizeParameters(sql: string): string {
  return sql.replace(/\?\d+/g, "?");
}

function normalizeSqliteValue(value: DatabaseValue): string | number | bigint | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

function changesAsNumber(result: StatementResultingChanges): number {
  return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
}

function parseCounts(values: string[]): number[] {
  const parsed = values.length > 0 ? values.map(Number) : [1_000, 5_000];
  if (parsed.some((value) => !Number.isInteger(value) || value <= 0 || value > 10_000)) {
    throw new Error("Les volumes doivent etre des entiers entre 1 et 10 000.");
  }
  return parsed;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}
