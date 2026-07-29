import type {
  CreateRouterConnectionInput,
  CreateRouterInput,
  RouterConnectionRecord,
  RouterRecord
} from "../../../domain/database";
import type { RouterConnectionMode } from "../../../domain/router";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";

export class RouterRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateRouterInput): Promise<RouterRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO routers (
        id, account_id, zone_id, name, label, model, board_name, serial_number, routeros_version,
        local_ip, hotspot_address, notes, api_port, api_ssl_port, username, encrypted_password, connection_mode,
        status, last_seen_at, subscription_counted, created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
      [
        input.id,
        input.account_id,
        input.zone_id,
        input.name,
        input.label,
        input.model,
        input.board_name,
        input.serial_number,
        input.routeros_version,
        input.local_ip,
        input.hotspot_address ?? null,
        input.notes ?? null,
        input.api_port,
        input.api_ssl_port,
        input.username,
        input.encrypted_password,
        input.connection_mode,
        input.status,
        input.last_seen_at,
        input.subscription_counted ?? 1,
        input.created_by_profile_id,
        input.sync_status ?? "local"
      ]
    );

    const created = await this.findById(input.id);
    if (!created) throw new Error("Le routeur n'a pas pu être créé.");
    return created;
  }

  async createWithConnections(
    input: CreateRouterInput,
    connections: CreateRouterConnectionInput[]
  ): Promise<RouterRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    assertRouterConnectionValidated(input);

    await this.database.transaction([
      this.buildRouterInsertStatement(input),
      ...connections.map((connection) => this.buildConnectionInsertStatement(connection))
    ]);

    const created = await this.findById(input.id);
    if (!created) throw new Error("Le routeur n'a pas pu être créé.");
    return created;
  }

  async update(input: CreateRouterInput): Promise<RouterRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    const existing = input.hotspot_address === undefined ? await this.findById(input.id) : null;
    const hotspotAddress = input.hotspot_address === undefined
      ? existing?.hotspot_address ?? null
      : input.hotspot_address;
    const updatedAt = input.updated_at ?? new Date().toISOString();
    await this.database.transaction([
      {
        params: [
          input.name,
          input.label,
          input.model,
          input.board_name,
          input.serial_number,
          input.routeros_version,
          input.local_ip,
          hotspotAddress,
          input.notes ?? null,
          input.api_port,
          input.api_ssl_port,
          input.username,
          input.encrypted_password,
          input.connection_mode,
          input.status,
          input.last_seen_at ?? null,
          input.subscription_counted ?? 1,
          input.sync_status ?? "local",
          updatedAt,
          input.id,
          input.account_id
        ],
        sql: `UPDATE routers SET
          name = ?1, label = ?2, model = ?3, board_name = ?4, serial_number = ?5,
          routeros_version = ?6, local_ip = ?7, hotspot_address = ?8, notes = ?9, api_port = ?10,
          api_ssl_port = ?11, username = ?12, encrypted_password = ?13, connection_mode = ?14,
          status = ?15, last_seen_at = ?16, subscription_counted = ?17, sync_status = ?18,
          updated_at = ?19
        WHERE id = ?20 AND account_id = ?21`
      },
      {
        params: [input.local_ip, input.api_port, updatedAt, input.id],
        sql: `UPDATE router_connections
              SET host = ?1, port = ?2, use_ssl = 0, updated_at = ?3, sync_status = 'local'
              WHERE router_id = ?4 AND mode = 'local' AND deleted_at IS NULL`
      }
    ]);

    const updated = await this.findById(input.id);
    if (!updated) throw new Error("Le routeur n'a pas pu être mis à jour.");
    return updated;
  }

  async remove(accountId: string, routerId: string): Promise<void> {
    const activePeers = await this.database.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM vpn_peers
       WHERE account_id = ?1 AND router_id = ?2 AND status <> 'revoked'`,
      [accountId, routerId]
    );

    if (Number(activePeers[0]?.count ?? 0) > 0) {
      throw new Error("Révoquez d'abord le pair VPN de ce routeur avant de le supprimer.");
    }

    const now = new Date().toISOString();
    const results = await this.database.transaction([
      {
        params: [now, now, routerId, accountId],
        sql: `UPDATE routers
              SET deleted_at = ?1, updated_at = ?2, status = 'offline', subscription_counted = 0
              WHERE id = ?3 AND account_id = ?4 AND deleted_at IS NULL`
      },
      {
        params: [now, now, routerId],
        sql: `UPDATE router_connections
              SET deleted_at = ?1, updated_at = ?2, status = 'inactive'
              WHERE router_id = ?3 AND deleted_at IS NULL`
      }
    ]);

    if ((results[0]?.rowsAffected ?? 0) === 0) {
      throw new Error("Le routeur est introuvable ou a déjà été supprimé.");
    }
  }

  async recordConnectionTest(input: {
    accountId: string;
    internalProfileId: string;
    routerId: string;
    mode: RouterConnectionMode;
    status: "connected" | "offline" | "warning";
    errorMessage: string | null;
    checkedAt: string;
  }): Promise<void> {
    assertAccountProfileOwnership(input.accountId, input.internalProfileId);

    const connections = await this.database.query<RouterConnectionRecord>(
      "SELECT * FROM router_connections WHERE router_id = ?1 AND deleted_at IS NULL",
      [input.routerId]
    );
    const connection = connections.find((item) => item.mode === input.mode);

    if (!connection) {
      throw new Error(`La connexion ${input.mode} de ce routeur est introuvable.`);
    }

    const routerStatus = input.status === "connected" ? "active" : input.status;
    const statements: DatabaseStatement[] = [
      {
        params: [routerStatus, input.checkedAt, input.routerId, input.accountId],
        sql: "UPDATE routers SET status = ?1, updated_at = ?2 WHERE id = ?3 AND account_id = ?4"
      },
      {
        params: [
          input.status === "connected" ? "active" : "inactive",
          input.errorMessage,
          input.checkedAt,
          connection.id
        ],
        sql: `UPDATE router_connections
              SET status = ?1, last_error = ?2, updated_at = ?3
              WHERE id = ?4`
      }
    ];

    if (input.status === "connected") {
      statements.push(
        {
          params: [input.checkedAt, input.routerId, input.accountId],
          sql: "UPDATE routers SET last_seen_at = ?1 WHERE id = ?2 AND account_id = ?3"
        },
        {
          params: [input.checkedAt, input.checkedAt, connection.id],
          sql: `UPDATE router_connections
                SET last_connected_at = ?1, updated_at = ?2
                WHERE id = ?3`
        }
      );
    }

    await this.database.transaction(statements);
  }

  async findById(id: string): Promise<RouterRecord | null> {
    const rows = await this.database.query<RouterRecord>("SELECT * FROM routers WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async list(): Promise<RouterRecord[]> {
    return this.database.query<RouterRecord>("SELECT * FROM routers ORDER BY created_at DESC");
  }

  async listByAccount(accountId: string): Promise<RouterRecord[]> {
    return this.database.query<RouterRecord>(
      "SELECT * FROM routers WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [accountId]
    );
  }

  async countSubscriptionRoutersByAccount(accountId: string): Promise<number> {
    const rows = await this.database.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM routers WHERE account_id = ?1 AND subscription_counted = 1 AND deleted_at IS NULL",
      [accountId]
    );
    return Number(rows[0]?.count ?? 0);
  }

  private buildRouterInsertStatement(input: CreateRouterInput): DatabaseStatement {
    return {
      params: [
        input.id,
        input.account_id,
        input.zone_id,
        input.name,
        input.label,
        input.model,
        input.board_name,
        input.serial_number,
        input.routeros_version,
        input.local_ip,
        input.hotspot_address ?? null,
        input.notes ?? null,
        input.api_port,
        input.api_ssl_port,
        input.username,
        input.encrypted_password,
        input.connection_mode,
        input.status,
        input.last_seen_at,
        input.subscription_counted ?? 1,
        input.created_by_profile_id,
        input.sync_status ?? "local"
      ],
      sql: `INSERT INTO routers (
        id, account_id, zone_id, name, label, model, board_name, serial_number, routeros_version,
        local_ip, hotspot_address, notes, api_port, api_ssl_port, username, encrypted_password, connection_mode,
        status, last_seen_at, subscription_counted, created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`
    };
  }

  private buildConnectionInsertStatement(input: CreateRouterConnectionInput): DatabaseStatement {
    const connection = normalizeRouterConnection(input);
    return {
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
    };
  }
}

function assertRouterConnectionValidated(input: CreateRouterInput): void {
  if (input.status !== "active") {
    throw new Error("Testez et validez la connexion RouterOS avant d'enregistrer ce routeur.");
  }
}

function normalizeRouterConnection(input: CreateRouterConnectionInput): CreateRouterConnectionInput {
  return input.mode === "vpn" ? { ...input, port: 8728, use_ssl: 0 } : input;
}
