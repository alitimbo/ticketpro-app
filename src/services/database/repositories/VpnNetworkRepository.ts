import type { VpnNetworkRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class VpnNetworkRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByAccount(accountId: string): Promise<VpnNetworkRecord | null> {
    const rows = await this.database.query<VpnNetworkRecord>("SELECT * FROM vpn_networks WHERE account_id = ?1 LIMIT 1", [accountId]);
    return rows[0] ?? null;
  }

  async create(input: Omit<VpnNetworkRecord, "created_at" | "updated_at">): Promise<VpnNetworkRecord> {
    await this.database.execute(
      `INSERT INTO vpn_networks (id, account_id, name, server_endpoint, server_public_key, server_port, address_pool, provisioning_api_url, provisioning_api_token_encrypted, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [input.id, input.account_id, input.name, input.server_endpoint, input.server_public_key, input.server_port, input.address_pool, input.provisioning_api_url, input.provisioning_api_token_encrypted, input.status]
    );
    const created = await this.findByAccount(input.account_id);
    if (!created) {
      throw new Error("Le réseau VPN n'a pas pu être créé.");
    }
    return created;
  }

  async update(input: Omit<VpnNetworkRecord, "created_at" | "updated_at">): Promise<void> {
    await this.database.execute(
      `UPDATE vpn_networks SET name = ?1, server_endpoint = ?2, server_public_key = ?3,
        server_port = ?4, address_pool = ?5, provisioning_api_url = ?6,
        provisioning_api_token_encrypted = ?7, status = ?8, updated_at = ?9
       WHERE id = ?10 AND account_id = ?11`,
      [input.name, input.server_endpoint, input.server_public_key, input.server_port, input.address_pool, input.provisioning_api_url, input.provisioning_api_token_encrypted, input.status, new Date().toISOString(), input.id, input.account_id]
    );
  }
}
