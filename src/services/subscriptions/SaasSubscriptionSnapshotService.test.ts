import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient, DatabaseStatement } from "../database";
import type { SaasAuthResult } from "../saas";
import { loadAccountSubscription } from "../../pages/global/subscriptionPageModel";
import { persistSaasSubscriptionSnapshot } from "./SaasSubscriptionSnapshotService";

afterEach(() => localStorage.clear());

describe("persistSaasSubscriptionSnapshot", () => {
  it("met à jour le cache local et SQLite avec le quota de l'organisation active", async () => {
    const transactions: DatabaseStatement[][] = [];
    const database: DatabaseClient = {
      execute: vi.fn(),
      initialize: vi.fn(),
      query: vi.fn(),
      transaction: vi.fn(async (statements: DatabaseStatement[]) => {
        transactions.push(statements);
        return statements.map(() => ({ rowsAffected: 1 }));
      })
    };
    const saasAccount = {
      subscription: {
        access_ends_at: "2027-08-01T00:00:00.000Z",
        current_period_end: "2027-08-01T00:00:00.000Z",
        current_period_start: "2026-08-01T00:00:00.000Z",
        device_limit_mode: "unlimited",
        grace_days_remaining: 0,
        grace_period_end: null,
        is_active: true,
        is_trial: false,
        max_devices: null,
        plan: {
          code: "ultra-150",
          id: "plan-ultra-150",
          name: "Pack 150 routeurs",
          price_cfa: 175_000
        },
        router_limit: 150,
        status: "active"
      }
    } as SaasAuthResult;

    await persistSaasSubscriptionSnapshot({
      accountId: "account-test@example.com",
      database,
      saasAccount
    });

    expect(loadAccountSubscription("account-test@example.com").routerLimitSnapshot).toBe(150);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(2);
    expect(transactions[0][0].params).toContain(150);
    expect(transactions[0][1].params).toContain(150);
  });
});
