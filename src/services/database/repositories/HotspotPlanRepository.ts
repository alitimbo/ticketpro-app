import type { CreateHotspotPlanInput, HotspotPlanRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class HotspotPlanRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateHotspotPlanInput): Promise<HotspotPlanRecord> {
    await this.database.execute(
      `INSERT INTO hotspot_plans (
        id, router_id, name, duration_minutes, validity_minutes, data_limit_mb,
        download_limit, upload_limit, shared_users, price_hint, mikrotik_profile_name,
        status, sync_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      [
        input.id,
        input.router_id,
        input.name,
        input.duration_minutes,
        input.validity_minutes,
        input.data_limit_mb,
        input.download_limit,
        input.upload_limit,
        input.shared_users,
        input.price_hint,
        input.mikrotik_profile_name,
        input.status,
        input.sync_status ?? "local"
      ]
    );

    const created = await this.findById(input.id);

    if (!created) {
      throw new Error("Le plan n'a pas pu être créé.");
    }

    return created;
  }

  async findById(id: string): Promise<HotspotPlanRecord | null> {
    const rows = await this.database.query<HotspotPlanRecord>(
      "SELECT * FROM hotspot_plans WHERE id = ?1 AND deleted_at IS NULL",
      [id]
    );
    return rows[0] ?? null;
  }

  async listByRouter(routerId: string): Promise<HotspotPlanRecord[]> {
    return this.database.query<HotspotPlanRecord>(
      "SELECT * FROM hotspot_plans WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [routerId]
    );
  }

  async update(input: CreateHotspotPlanInput): Promise<HotspotPlanRecord> {
    await this.database.execute(
      `UPDATE hotspot_plans SET
        name = ?1, duration_minutes = ?2, validity_minutes = ?3, data_limit_mb = ?4,
        download_limit = ?5, upload_limit = ?6, shared_users = ?7, price_hint = ?8,
        mikrotik_profile_name = ?9, status = ?10, sync_status = ?11, updated_at = ?12
      WHERE id = ?13`,
      [
        input.name,
        input.duration_minutes,
        input.validity_minutes,
        input.data_limit_mb,
        input.download_limit,
        input.upload_limit,
        input.shared_users,
        input.price_hint,
        input.mikrotik_profile_name,
        input.status,
        input.sync_status ?? "local",
        input.updated_at ?? new Date().toISOString(),
        input.id
      ]
    );

    const updated = await this.findById(input.id);

    if (!updated) {
      throw new Error("Le plan n'a pas pu être mis à jour.");
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE hotspot_plans SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
      [new Date().toISOString(), new Date().toISOString(), id]
    );
  }
}
