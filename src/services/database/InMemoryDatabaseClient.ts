import type { LocalTableName } from "./repositories/TableRepository";
import type { DatabaseClient, DatabaseExecuteResult, DatabaseRow, DatabaseValue } from "./DatabaseClient";

const tableNames: LocalTableName[] = [
  "active_sessions_cache",
  "account_subscriptions",
  "accounts",
  "app_logs",
  "app_settings",
  "billing_invoices",
  "generated_files",
  "hotspot_plans",
  "internal_profiles",
  "printers",
  "router_connections",
  "router_snapshots",
  "routers",
  "subscription_plans",
  "ticket_batches",
  "tickets"
];

export class InMemoryDatabaseClient implements DatabaseClient {
  private readonly tables = tableNames.reduce<Record<LocalTableName, DatabaseRow[]>>(
    (accumulator, tableName) => {
      accumulator[tableName] = [];
      return accumulator;
    },
    {} as Record<LocalTableName, DatabaseRow[]>
  );

  async initialize(): Promise<void> {
    return undefined;
  }

  async execute(sql: string, params: DatabaseValue[] = []): Promise<DatabaseExecuteResult> {
    const tableName = this.extractInsertTable(sql);
    const columns = this.extractInsertColumns(sql);
    const now = new Date(0).toISOString();
    const row = columns.reduce<DatabaseRow>((accumulator, column, index) => {
      accumulator[column] = params[index] ?? null;
      return accumulator;
    }, {});

    row.created_at = row.created_at ?? now;
    row.updated_at = row.updated_at ?? now;
    row.deleted_at = row.deleted_at ?? null;
    row.sync_status = row.sync_status ?? "local";
    this.tables[tableName].push(row);

    return { rowsAffected: 1 };
  }

  async query<T = DatabaseRow>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
    const normalized = sql.toLowerCase();
    const tableName = this.extractSelectTable(sql);
    const rows = this.tables[tableName];

    if (normalized.includes("where id = ?1")) {
      return rows.filter((row) => row.id === params[0]) as T[];
    }

    if (normalized.includes("where router_id = ?1")) {
      return rows.filter((row) => row.router_id === params[0]) as T[];
    }

    if (normalized.includes("where batch_id = ?1")) {
      return rows.filter((row) => row.batch_id === params[0]) as T[];
    }

    if (
      normalized.includes("where account_id = ?1 and created_by_profile_id = ?2") ||
      normalized.includes("where account_id = ?1 and internal_profile_id = ?2")
    ) {
      return rows.filter(
        (row) =>
          row.account_id === params[0] &&
          (row.created_by_profile_id === params[1] || row.internal_profile_id === params[1]) &&
          row.deleted_at === null
      ) as T[];
    }

    if (normalized.includes("count(*) as count") && normalized.includes("where account_id = ?1")) {
      return [
        {
          count: rows.filter(
            (row) => row.account_id === params[0] && row.subscription_counted === 1 && row.deleted_at === null
          ).length
        }
      ] as T[];
    }

    if (normalized.includes("where account_id = ?1")) {
      return rows.filter((row) => row.account_id === params[0] && row.deleted_at === null) as T[];
    }

    return rows as T[];
  }

  private extractInsertTable(sql: string): LocalTableName {
    const match = sql.toLowerCase().match(/insert into\s+([a-z_]+)/);

    if (!match || !this.isTableName(match[1])) {
      throw new Error("Table inconnue pour l'insertion.");
    }

    return match[1];
  }

  private extractInsertColumns(sql: string): string[] {
    const match = sql.match(/\(([^)]+)\)\s+VALUES/i);

    if (!match) {
      throw new Error("Colonnes d'insertion introuvables.");
    }

    return match[1].split(",").map((column) => column.trim());
  }

  private extractSelectTable(sql: string): LocalTableName {
    const match = sql.toLowerCase().match(/from\s+([a-z_]+)/);

    if (!match || !this.isTableName(match[1])) {
      throw new Error("Table inconnue pour la lecture.");
    }

    return match[1];
  }

  private isTableName(value: string): value is LocalTableName {
    return tableNames.includes(value as LocalTableName);
  }
}
