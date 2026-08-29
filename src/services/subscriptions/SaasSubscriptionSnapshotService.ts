import type { DatabaseClient } from "../database";
import type { SaasAuthResult } from "../saas";
import {
  saveAccountSubscription,
  subscriptionFromSaas,
  subscriptionPlanFromSaas
} from "../../pages/global/subscriptionPageModel";

type PersistSaasSubscriptionSnapshotInput = {
  accountId: string;
  database?: DatabaseClient;
  saasAccount: SaasAuthResult;
};

/**
 * Conserve une copie locale du quota de l'organisation active. L'API SaaS
 * reste la source de vérité ; cette copie évite de revenir à un ancien quota
 * après un redémarrage hors ligne de l'application.
 */
export async function persistSaasSubscriptionSnapshot({
  accountId,
  database,
  saasAccount
}: PersistSaasSubscriptionSnapshotInput): Promise<void> {
  const snapshot = subscriptionFromSaas(saasAccount.subscription);
  const plan = subscriptionPlanFromSaas(saasAccount.subscription, snapshot);

  saveAccountSubscription(snapshot, accountId);

  if (!database) return;

  await database.transaction([
    {
      sql: `INSERT INTO subscription_plans (
        id, name, router_limit, price_cfa, price_per_router_cfa, billing_period,
        description, is_recommended, is_active, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        router_limit = excluded.router_limit,
        price_cfa = excluded.price_cfa,
        price_per_router_cfa = excluded.price_per_router_cfa,
        billing_period = excluded.billing_period,
        description = excluded.description,
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP`,
      params: [
        plan.id,
        plan.name,
        plan.routerLimit,
        plan.priceCfa,
        plan.pricePerRouterCfa,
        plan.billingPeriod,
        plan.description,
        plan.isRecommended ? 1 : 0,
        plan.isActive ? 1 : 0
      ]
    },
    {
      sql: `INSERT INTO account_subscriptions (
        id, account_id, subscription_plan_id, status, current_period_start,
        current_period_end, router_limit_snapshot, price_cfa_snapshot,
        price_per_router_cfa_snapshot, payment_status, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        subscription_plan_id = excluded.subscription_plan_id,
        status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        router_limit_snapshot = excluded.router_limit_snapshot,
        price_cfa_snapshot = excluded.price_cfa_snapshot,
        price_per_router_cfa_snapshot = excluded.price_per_router_cfa_snapshot,
        payment_status = excluded.payment_status,
        updated_at = CURRENT_TIMESTAMP`,
      params: [
        `subscription-${accountId}-current`,
        accountId,
        snapshot.planId,
        snapshot.status,
        snapshot.currentPeriodStart,
        snapshot.currentPeriodEnd,
        snapshot.routerLimitSnapshot,
        snapshot.priceCfaSnapshot,
        snapshot.pricePerRouterCfaSnapshot,
        snapshot.paymentStatus
      ]
    }
  ]);
}
