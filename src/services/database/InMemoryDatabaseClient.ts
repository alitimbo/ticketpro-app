import type { LocalTableName } from "./repositories/TableRepository";
import type {
  DatabaseClient,
  DatabaseExecuteResult,
  DatabaseRow,
  DatabaseStatement,
  DatabaseValue
} from "./DatabaseClient";

const tableNames: LocalTableName[] = [
  "active_sessions_cache",
  "account_subscriptions",
  "accounts",
  "app_logs",
  "app_settings",
  "billing_invoices",
  "generated_files",
  "hotspot_plan_history",
  "hotspot_plans",
  "internal_profiles",
  "license_state",
  "printers",
  "router_connections",
  "router_managed_resource_manifests",
  "router_snapshots",
  "routers",
  "subscription_plans",
  "sync_outbox",
  "ticket_batches",
  "tickets",
  "vpn_networks",
  "vpn_peers"
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

  async transaction(statements: DatabaseStatement[]): Promise<DatabaseExecuteResult[]> {
    const snapshot = tableNames.reduce<Record<LocalTableName, DatabaseRow[]>>(
      (accumulator, tableName) => {
        accumulator[tableName] = this.tables[tableName].map((row) => ({ ...row }));
        return accumulator;
      },
      {} as Record<LocalTableName, DatabaseRow[]>
    );

    try {
      const results: DatabaseExecuteResult[] = [];

      for (const statement of statements) {
        results.push(await this.execute(statement.sql, statement.params ?? []));
      }

      return results;
    } catch (error) {
      tableNames.forEach((tableName) => {
        this.tables[tableName].splice(0, this.tables[tableName].length, ...snapshot[tableName]);
      });
      throw error;
    }
  }

  async execute(sql: string, params: DatabaseValue[] = []): Promise<DatabaseExecuteResult> {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("update ")) {
      return this.executeUpdate(sql, params);
    }

    if (normalized.startsWith("delete ")) {
      return this.executeDelete(sql, params);
    }

    const tableName = this.extractInsertTable(sql);
    const columns = this.extractInsertColumns(sql);
    assertBoundParameters(sql, params);
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

  private executeUpdate(sql: string, params: DatabaseValue[]): DatabaseExecuteResult {
    const match = sql.match(/update\s+([a-z_]+)\s+set\s+(.+)\s+where\s+(.+)$/is);

    if (!match || !this.isTableName(match[1])) {
      throw new Error("Requête de mise à jour inconnue.");
    }

    const assignments = match[2].split(",").map((part) => part.trim());
    const conditions = match[3];
    const idCondition = conditions.match(/\b(id|router_id)\s*=\s*\?(\d+)/i);
    const accountCondition = conditions.match(/account_id\s*=\s*\?(\d+)/i);

    if (!idCondition) {
      throw new Error("Mise à jour sans identifiant refusée.");
    }

    const idColumn = idCondition[1].toLowerCase();
    const id = params[Number(idCondition[2]) - 1];
    const accountId = accountCondition ? params[Number(accountCondition[1]) - 1] : undefined;
    const rows = this.tables[match[1]].filter(
      (row) => row[idColumn] === id && (accountId === undefined || row.account_id === accountId)
    );

    assignments.forEach((assignment) => {
      const assignmentMatch = assignment.match(/^([a-z_]+)\s*=\s*\?(\d+)$/i);
      const literalMatch = assignment.match(/^([a-z_]+)\s*=\s*'([^']*)'$/i);
      const numericMatch = assignment.match(/^([a-z_]+)\s*=\s*(-?\d+(?:\.\d+)?)$/i);
      const nullMatch = assignment.match(/^([a-z_]+)\s*=\s*null$/i);

      if (!assignmentMatch && !literalMatch && !numericMatch && !nullMatch) {
        throw new Error("Affectation de mise à jour inconnue.");
      }

      const column = (assignmentMatch?.[1] ?? literalMatch?.[1] ?? numericMatch?.[1] ?? nullMatch?.[1]) as string;
      const value = assignmentMatch
        ? params[Number(assignmentMatch[2]) - 1] ?? null
        : literalMatch
          ? literalMatch[2]
          : numericMatch ? Number(numericMatch[2]) : null;
      rows.forEach((row) => {
        row[column] = value;
      });
    });

    return { rowsAffected: rows.length };
  }

  private executeDelete(sql: string, params: DatabaseValue[]): DatabaseExecuteResult {
    const match = sql.match(/delete\s+from\s+([a-z_]+)\s+where\s+([a-z_]+)\s*=\s*\?(\d+)/i);

    if (!match || !this.isTableName(match[1])) {
      throw new Error("Requête de suppression inconnue.");
    }

    const column = match[2];
    const value = params[Number(match[3]) - 1];
    const remaining = this.tables[match[1]].filter((row) => row[column] !== value);
    const rowsAffected = this.tables[match[1]].length - remaining.length;
    this.tables[match[1]].splice(0, this.tables[match[1]].length, ...remaining);

    return { rowsAffected };
  }

  async query<T = DatabaseRow>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
    const normalized = sql.toLowerCase();
    const tableName = this.extractSelectTable(sql);
    const rows = this.tables[tableName];
    const visibleRows = normalized.includes("deleted_at is null")
      ? rows.filter((row) => row.deleted_at === null || row.deleted_at === undefined)
      : rows;

    if (normalized.includes("where id = ?1")) {
      return visibleRows.filter((row) => row.id === params[0]) as T[];
    }

    if (normalized.includes("where router_id = ?1")) {
      return visibleRows.filter((row) => row.router_id === params[0]) as T[];
    }

    if (normalized.includes("where batch_id = ?1")) {
      return rows.filter((row) => row.batch_id === params[0]) as T[];
    }

    if (normalized.includes("where plan_id = ?1")) {
      return rows.filter((row) => row.plan_id === params[0]) as T[];
    }

    if (normalized.includes("where account_id = ?1 and idempotency_key = ?2")) {
      return visibleRows.filter(
        (row) => row.account_id === params[0] && row.idempotency_key === params[1]
      ).slice(0, 1) as T[];
    }

    if (
      normalized.includes("where account_id = ?1 and created_by_profile_id = ?2") ||
      normalized.includes("where account_id = ?1 and internal_profile_id = ?2")
    ) {
      return visibleRows.filter(
        (row) =>
          row.account_id === params[0] &&
          (row.created_by_profile_id === params[1] || row.internal_profile_id === params[1]) &&
          row.deleted_at === null
      ) as T[];
    }

    if (
      normalized.includes("count(*) as count")
      && tableName === "vpn_peers"
      && /where\s+account_id\s*=\s*\?1\s+and\s+router_id\s*=\s*\?2/.test(normalized)
    ) {
      return [
        {
          count: rows.filter(
            (row) => row.account_id === params[0]
              && row.router_id === params[1]
              && row.status !== "revoked"
          ).length
        }
      ] as T[];
    }

    if (normalized.includes("count(*) as count") && normalized.includes("where account_id = ?1")) {
      return [
        {
          count: visibleRows.filter(
            (row) => row.account_id === params[0] && row.subscription_counted === 1 && row.deleted_at === null
          ).length
        }
      ] as T[];
    }

    if (normalized.includes("where account_id = ?1 and organization_id = ?2")) {
      return visibleRows.filter(
        (row) => row.account_id === params[0] && row.organization_id === params[1]
      ) as T[];
    }

    if (normalized.includes("where account_id = ?1")) {
      return visibleRows.filter((row) => row.account_id === params[0]) as T[];
    }

    return visibleRows as T[];
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

function assertBoundParameters(sql: string, params: DatabaseValue[]): void {
  const indexes = Array.from(sql.matchAll(/\?(\d+)/g), (match) => Number(match[1]));
  const highestIndex = indexes.length > 0 ? Math.max(...indexes) : 0;
  if (highestIndex > params.length) {
    throw new Error(`Paramètre SQL ?${highestIndex} absent (${params.length} valeur(s) fournie(s)).`);
  }
}
