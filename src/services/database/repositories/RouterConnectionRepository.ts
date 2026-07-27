import type { CreateRouterConnectionInput, RouterConnectionRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";

export class RouterConnectionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateRouterConnectionInput): Promise<RouterConnectionRecord> {
    const connection = normalizeConnection(input);
    await this.database.execute(
      `INSERT INTO router_connections (
        id, router_id, mode, host, port, use_ssl, status, last_error, last_connected_at, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
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
      ]
    );

    const created = await this.findById(connection.id);

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
    const normalizedConnections = connections.map(normalizeConnection);
    const statements: DatabaseStatement[] = [
      {
        params: [routerId],
        sql: "DELETE FROM router_connections WHERE router_id = ?1"
      },
      ...normalizedConnections.map((connection) => ({
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

function normalizeConnection(input: CreateRouterConnectionInput): CreateRouterConnectionInput {
  if (input.mode !== "vpn") {
    return input;
  }

  // WireGuard already encrypts and authenticates the transport. Using api-ssl
  // here would require a RouterOS certificate and a trusted CA on every PC.
  return {
    ...input,
    port: 8728,
    use_ssl: 0
  };
}
