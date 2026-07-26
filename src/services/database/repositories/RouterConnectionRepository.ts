import type { CreateRouterConnectionInput, RouterConnectionRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";

export class RouterConnectionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateRouterConnectionInput): Promise<RouterConnectionRecord> {
    await this.database.execute(
      `INSERT INTO router_connections (
        id, router_id, mode, host, port, use_ssl, status, last_error, last_connected_at, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
        input.id,
        input.router_id,
        input.mode,
        input.host,
        input.port,
        input.use_ssl,
        input.status,
        input.last_error,
        input.last_connected_at,
        input.sync_status ?? "local"
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("La connexion du routeur n'a pas pu être créée.");
    }

    return created;
  }

  async findById(id: string): Promise<RouterConnectionRecord | null> {
    const rows = await this.database.query<RouterConnectionRecord>(
      "SELECT * FROM router_connections WHERE id = ?1",
      [id]
    );

    return rows[0] ?? null;
  }

  async listByRouter(routerId: string): Promise<RouterConnectionRecord[]> {
    return this.database.query<RouterConnectionRecord>(
      "SELECT * FROM router_connections WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC",
      [routerId]
    );
  }

  async replaceForRouter(routerId: string, connections: CreateRouterConnectionInput[]): Promise<void> {
    const statements: DatabaseStatement[] = [
      {
        params: [routerId],
        sql: "DELETE FROM router_connections WHERE router_id = ?1"
      },
      ...connections.map((connection) => ({
        params: [
          connection.id,
          connection.router_id,
          connection.mode,
          connection.host,
          connection.port,
          connection.use_ssl,
          connection.status,
          connection.last_error,
          connection.last_connected_at,
          connection.sync_status ?? "local"
        ],
        sql: `INSERT INTO router_connections (
          id, router_id, mode, host, port, use_ssl, status, last_error, last_connected_at, sync_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      }))
    ];

    await this.database.transaction(statements);
  }
}
