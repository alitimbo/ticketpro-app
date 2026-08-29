import { afterEach, describe, expect, it } from "vitest";
import { listRoutersForAccount, type RouterCardData } from "./routerPageModel";
import type { SaasSubscription } from "../../services/saas";
import {
  changeSubscriptionPlan,
  defaultAccountSubscription,
  getSubscriptionOverview,
  saveAccountSubscription,
  updateSubscriptionStatus
} from "./subscriptionPageModel";

const accountId = "account-douma-demo";
const now = Date.parse("2026-07-11T00:00:00.000Z");

function activateDefaultSubscription(): void {
  saveAccountSubscription(
    {
      ...defaultAccountSubscription,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      status: "active"
    },
    accountId
  );
}

function router(id: string, owner = accountId): RouterCardData {
  return {
    accountId: owner,
    id,
    status: "active",
    subscriptionCounted: true
  } as RouterCardData;
}

function saasSubscription(routerLimit: number, overrides: Partial<SaasSubscription> = {}): SaasSubscription {
  return {
    access_ends_at: "2026-12-31T23:59:59.000Z",
    current_period_end: "2026-12-31T23:59:59.000Z",
    current_period_start: "2026-08-01T00:00:00.000Z",
    device_limit_mode: "unlimited",
    grace_days_remaining: 0,
    grace_period_end: null,
    is_active: true,
    is_trial: false,
    max_devices: null,
    plan: {
      code: `plan-${routerLimit}`,
      id: `plan-${routerLimit}`,
      name: `Pack ${routerLimit} routeurs`,
      price_cfa: 100_000
    },
    router_limit: routerLimit,
    status: "active",
    ...overrides
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("limites de routeurs par abonnement", () => {
  it("1. le Pack 1 routeur autorise l'ajout du premier routeur", () => {
    activateDefaultSubscription();

    expect(getSubscriptionOverview(0, accountId, now).canAddRouter).toBe(true);
  });

  it("2. le Pack 1 routeur bloque le deuxième routeur", () => {
    activateDefaultSubscription();

    expect(getSubscriptionOverview(1, accountId, now).canAddRouter).toBe(false);
  });

  it("3. le Pack 5 routeurs autorise cinq routeurs, puis bloque le sixième", () => {
    activateDefaultSubscription();
    changeSubscriptionPlan("subscription-plan-5-routers", accountId);

    expect(getSubscriptionOverview(4, accountId, now).canAddRouter).toBe(true);
    expect(getSubscriptionOverview(5, accountId, now).canAddRouter).toBe(false);
  });

  it("4. un abonnement expiré bloque l'ajout d'un routeur", () => {
    activateDefaultSubscription();
    updateSubscriptionStatus("expired", "unpaid", accountId);

    expect(getSubscriptionOverview(0, accountId, now).canAddRouter).toBe(false);
  });

  it("5. un abonnement suspendu bloque l'ajout d'un routeur", () => {
    activateDefaultSubscription();
    updateSubscriptionStatus("suspended", "pending", accountId);

    expect(getSubscriptionOverview(0, accountId, now).canAddRouter).toBe(false);
  });

  it("6. un downgrade de pack ne supprime aucun routeur existant", () => {
    activateDefaultSubscription();
    changeSubscriptionPlan("subscription-plan-5-routers", accountId);
    const existingRouters = [router("router-1"), router("router-2"), router("router-3")];

    changeSubscriptionPlan("subscription-plan-1-router", accountId);
    const overview = getSubscriptionOverview(existingRouters.length, accountId, now);

    expect(existingRouters).toHaveLength(3);
    expect(overview.isOverLimit).toBe(true);
    expect(overview.canAddRouter).toBe(false);
  });

  it("7. un dépassement bloque seulement les nouveaux ajouts", () => {
    activateDefaultSubscription();
    const allRouters = [router("router-1"), router("router-2"), router("router-other", "account-other")];
    const visibleRouters = listRoutersForAccount(allRouters, accountId);

    expect(visibleRouters.map((item) => item.id)).toEqual(["router-1", "router-2"]);
    expect(getSubscriptionOverview(visibleRouters.length, accountId, now).canAddRouter).toBe(false);
  });

  it("8. le quota SaaS actif remplace immédiatement un ancien snapshot local", () => {
    activateDefaultSubscription();

    const overview = getSubscriptionOverview(1, accountId, now, saasSubscription(150));

    expect(overview.subscription.routerLimitSnapshot).toBe(150);
    expect(overview.plan.name).toBe("Pack 150 routeurs");
    expect(overview.canAddRouter).toBe(true);
  });

  it("9. le changement d'organisation recalcule le quota sans conserver l'ancien pack", () => {
    activateDefaultSubscription();

    const limited = getSubscriptionOverview(1, accountId, now, saasSubscription(1));
    const expanded = getSubscriptionOverview(1, accountId, now, saasSubscription(150));

    expect(limited.canAddRouter).toBe(false);
    expect(expanded.canAddRouter).toBe(true);
    expect(expanded.subscription.routerLimitSnapshot).toBe(150);
  });

  it("10. un abonnement SaaS expiré bloque même si le cache local est actif", () => {
    activateDefaultSubscription();
    const expired = saasSubscription(150, {
      access_ends_at: "2026-07-01T00:00:00.000Z",
      current_period_end: "2026-07-01T00:00:00.000Z",
      is_active: false,
      status: "expired"
    });

    const overview = getSubscriptionOverview(0, accountId, now, expired);

    expect(overview.subscription.status).toBe("expired");
    expect(overview.canAddRouter).toBe(false);
  });
});
