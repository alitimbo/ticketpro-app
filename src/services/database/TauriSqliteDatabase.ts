import { invoke } from "@tauri-apps/api/core";
import type { DatabaseClient, DatabaseExecuteResult, DatabaseRow, DatabaseValue } from "./DatabaseClient";

type TauriExecuteResult = {
  rows_affected: number;
};

export class TauriSqliteDatabase implements DatabaseClient {
  async initialize(): Promise<void> {
    await invoke("db_initialize");
  }

  async execute(sql: string, params: DatabaseValue[] = []): Promise<DatabaseExecuteResult> {
    const result = await invoke<TauriExecuteResult>("db_execute", { sql, params });

    return { rowsAffected: result.rows_affected };
  }

  async query<T = DatabaseRow>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
    return invoke<T[]>("db_query", { sql, params });
  }
}
