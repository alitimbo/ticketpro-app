import type { LicenseStateRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class LicenseStateRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findCurrent(): Promise<LicenseStateRecord | null> {
    const rows = await this.database.query<LicenseStateRecord>("SELECT * FROM license_state WHERE id = 'current' LIMIT 1");
    return rows[0] ?? null;
  }

  async save(input: Omit<LicenseStateRecord, "created_at" | "updated_at">): Promise<LicenseStateRecord> {
    const now = new Date().toISOString();
    await this.database.execute("DELETE FROM license_state WHERE id = ?1", ["current"]);
    await this.database.execute(
      `INSERT INTO license_state (
        id, account_id, license_id, activation_id, activation_token_encrypted, install_id, device_id,
        status, expires_at, duration_days, router_limit, router_count, max_devices, device_count,
        plan_id, plan_code, plan_name, plan_description, price_cfa, billing_period,
        last_validated_at, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
        ?17, ?18, ?19, ?20, ?21, ?22, ?23
      )`,
      ["current", input.account_id, input.license_id, input.activation_id, input.activation_token_encrypted,
        input.install_id, input.device_id, input.status, input.expires_at, input.duration_days,
        input.router_limit, input.router_count, input.max_devices, input.device_count, input.plan_id,
        input.plan_code, input.plan_name, input.plan_description, input.price_cfa, input.billing_period,
        input.last_validated_at, now, now]
    );
    const saved = await this.findCurrent();
    if (!saved) throw new Error("La licence locale n'a pas pu être enregistrée.");
    return saved;
  }

  async updateValidation(
    status: LicenseStateRecord["status"],
    routerCount: number,
    deviceCount: number
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.database.execute(
      `UPDATE license_state SET status = ?1, router_count = ?2, device_count = ?3,
        last_validated_at = ?4, updated_at = ?5 WHERE id = ?6`,
      [status, routerCount, deviceCount, now, now, "current"]
    );
  }
}
