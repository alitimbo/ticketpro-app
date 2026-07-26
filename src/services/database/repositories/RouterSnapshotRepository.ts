import type { CreateRouterSnapshotInput, RouterSnapshotRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class RouterSnapshotRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateRouterSnapshotInput): Promise<RouterSnapshotRecord> {
    await this.database.execute(
      `INSERT INTO router_snapshots (
        id, router_id, cpu_load, memory_used, memory_total, uptime,
        active_clients_count, tickets_count, plans_count, captured_at, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      [
        input.id,
        input.router_id,
        input.cpu_load,
        input.memory_used,
        input.memory_total,
        input.uptime,
        input.active_clients_count,
        input.tickets_count,
        input.plans_count,
        input.captured_at,
        input.sync_status ?? "local"
      ]
    );

    const rows = await this.database.query<RouterSnapshotRecord>("SELECT * FROM router_snapshots WHERE id = ?1", [input.id]);
    const created = rows[0];

    if (!created) {
      throw new Error("Le snapshot du routeur n'a pas pu être enregistré.");
    }

    return created;
  }

  async listByRouter(routerId: string, limit = 60): Promise<RouterSnapshotRecord[]> {
    const rows = await this.database.query<RouterSnapshotRecord>(
      "SELECT * FROM router_snapshots WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY captured_at DESC",
      [routerId]
    );

    return rows.slice(0, limit).reverse();
  }
}
