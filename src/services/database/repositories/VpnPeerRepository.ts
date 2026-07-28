import type { VpnPeerRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class VpnPeerRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listByAccount(accountId: string): Promise<VpnPeerRecord[]> {
    try {
      return await this.database.query<VpnPeerRecord>(
        "SELECT * FROM vpn_peers WHERE account_id = ?1 ORDER BY created_at DESC",
        [accountId]
      );
    } catch (error) {
      throw databaseError("Impossible de charger les pairs VPN", error);
    }
  }

  async findByRouter(accountId: string, routerId: string): Promise<VpnPeerRecord | null> {
    const rows = await this.listByAccount(accountId);
    return rows.find((row) => row.router_id === routerId && row.status !== "revoked") ?? null;
  }

  async create(input: Omit<VpnPeerRecord, "created_at" | "updated_at">): Promise<VpnPeerRecord> {
    try {
      await this.database.execute(
        `INSERT INTO vpn_peers (
          id, account_id, network_id, router_id, peer_type, name, public_key,
          private_key_encrypted, assigned_address, allowed_ips, endpoint_address,
          endpoint_port, status, last_handshake_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        [input.id, input.account_id, input.network_id, input.router_id, input.peer_type, input.name, input.public_key, input.private_key_encrypted, input.assigned_address, input.allowed_ips, input.endpoint_address, input.endpoint_port, input.status, input.last_handshake_at]
      );
      const created = await this.database.query<VpnPeerRecord>("SELECT * FROM vpn_peers WHERE id = ?1", [input.id]);
      if (!created[0]) {
        throw new Error("La ligne du pair VPN est absente après l'insertion.");
      }
      return created[0];
    } catch (error) {
      throw databaseError(`Impossible d'enregistrer le pair VPN ${input.name}`, error);
    }
  }

  async updateStatus(accountId: string, id: string, status: VpnPeerRecord["status"]): Promise<void> {
    try {
      await this.database.execute(
        "UPDATE vpn_peers SET status = ?1, updated_at = ?2 WHERE id = ?3 AND account_id = ?4",
        [status, new Date().toISOString(), id, accountId]
      );
    } catch (error) {
      throw databaseError(`Impossible de passer le pair VPN à l'état ${status}`, error);
    }
  }
}

function databaseError(context: string, error: unknown): Error {
  if (error instanceof Error) return new Error(`${context} : ${error.message}`);
  if (typeof error === "string" && error.trim()) return new Error(`${context} : ${error.trim()}`);
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return new Error(`${context} : ${candidate.message.trim()}`);
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return new Error(`${context} : ${candidate.error.trim()}`);
    }
  }
  return new Error(context);
}
