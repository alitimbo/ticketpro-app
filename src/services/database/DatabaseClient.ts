export type DatabaseValue = string | number | boolean | null;

export type DatabaseRow = Record<string, DatabaseValue>;

export type DatabaseExecuteResult = {
  rowsAffected: number;
};

export interface DatabaseClient {
  execute(sql: string, params?: DatabaseValue[]): Promise<DatabaseExecuteResult>;
  initialize(): Promise<void>;
  query<T = DatabaseRow>(sql: string, params?: DatabaseValue[]): Promise<T[]>;
}
