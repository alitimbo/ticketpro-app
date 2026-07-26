import type { SubscriptionPlanRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class SubscriptionPlanRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listActive(): Promise<SubscriptionPlanRecord[]> {
    return this.database.query<SubscriptionPlanRecord>(
      "SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY router_limit ASC"
    );
  }

  async findById(id: string): Promise<SubscriptionPlanRecord | null> {
    const rows = await this.database.query<SubscriptionPlanRecord>(
      "SELECT * FROM subscription_plans WHERE id = ?1",
      [id]
    );
    return rows[0] ?? null;
  }
}
