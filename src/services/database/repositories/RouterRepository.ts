import type { CreateRouterInput, RouterRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";

export class RouterRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateRouterInput): Promise<RouterRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO routers (
        id, account_id, zone_id, name, label, model, board_name, serial_number, routeros_version,
        local_ip, api_port, api_ssl_port, username, encrypted_password, connection_mode,
        status, last_seen_at, subscription_counted, created_by_profile_id, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
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

    if (!created) {
      throw new Error("Le routeur n'a pas pu être créé.");
    }

    return created;
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
}
