import type { AccountSubscriptionRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class AccountSubscriptionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findCurrentByAccount(accountId: string): Promise<AccountSubscriptionRecord | null> {
    const rows = await this.database.query<AccountSubscriptionRecord>(
      "SELECT * FROM account_subscriptions WHERE account_id = ?1 ORDER BY updated_at DESC LIMIT 1",
      [accountId]
    );
    return rows[0] ?? null;
  }

  async update(input: AccountSubscriptionRecord): Promise<AccountSubscriptionRecord> {
    await this.database.execute(
      `UPDATE account_subscriptions SET
        subscription_plan_id = ?1, status = ?2, current_period_start = ?3,
        current_period_end = ?4, router_limit_snapshot = ?5, price_cfa_snapshot = ?6,
        price_per_router_cfa_snapshot = ?7, payment_status = ?8, updated_at = ?9
      WHERE id = ?10 AND account_id = ?11`,
      [
        input.subscription_plan_id,
        input.status,
        input.current_period_start,
        input.current_period_end,
        input.router_limit_snapshot,
        input.price_cfa_snapshot,
        input.price_per_router_cfa_snapshot,
        input.payment_status,
        input.updated_at ?? new Date().toISOString(),
        input.id,
        input.account_id
      ]
    );

    const updated = await this.database.query<AccountSubscriptionRecord>(
      "SELECT * FROM account_subscriptions WHERE id = ?1 AND account_id = ?2",
      [input.id, input.account_id]
    );
    if (!updated[0]) {
      throw new Error("L'abonnement n'a pas pu être mis à jour.");
    }
    return updated[0];
  }
}
