import { afterEach, describe, expect, it } from "vitest";
import {
  billingPeriodLabel,
  changeSubscriptionPlan,
  countRoutersForSubscription,
  formatCfa,
  formatPlanDuration,
  getSubscriptionOverview,
  markSubscriptionPaymentManual
} from "./subscriptionPageModel";
import type { RouterCardData } from "./routerPageModel";

const routers = [
  { accountId: "account-douma-demo", createdByProfileId: "account-douma-demo:internal-profile-admin", id: "active-1", status: "active", subscriptionCounted: true },
  { accountId: "account-douma-demo", createdByProfileId: "account-douma-demo:internal-profile-admin", id: "offline-1", status: "offline", subscriptionCounted: true },
  { accountId: "account-douma-demo", createdByProfileId: "account-douma-demo:internal-profile-admin", id: "warning-1", status: "warning", subscriptionCounted: false }
] as RouterCardData[];

describe("subscriptionPageModel", () => {
  afterEach(() => {
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:billing_invoices");
  });

  it("prépare le pack 1 routeur par défaut", () => {
    const overview = getSubscriptionOverview(
      1,
      undefined,
      Date.parse("2026-07-15T00:00:00.000Z")
    );

    expect(overview.plan.name).toBe("Pack 1 routeur");
    expect(overview.routersUsed).toBe(1);
    expect(overview.canAddRouter).toBe(false);
    expect(formatCfa(1500)).toBe("1 500 CFA");
    expect(formatPlanDuration(1)).toBe("1 jour");
    expect(formatPlanDuration(30)).toBe("30 jours");
    expect(billingPeriodLabel("monthly")).toBe("mois");
  });

  it("change de pack et augmente la limite routeurs", () => {
    changeSubscriptionPlan("subscription-plan-5-routers");

    const overview = getSubscriptionOverview(
      1,
      undefined,
      Date.parse("2026-07-15T00:00:00.000Z")
    );

    expect(overview.plan.name).toBe("Pack 5 routeurs");
    expect(overview.plan.priceCfa).toBe(6000);
    expect(overview.plan.pricePerRouterCfa).toBe(1200);
    expect(overview.plan.isRecommended).toBe(true);
    expect(overview.subscription.routerLimitSnapshot).toBe(5);
    expect(overview.subscription.priceCfaSnapshot).toBe(6000);
    expect(overview.subscription.pricePerRouterCfaSnapshot).toBe(1200);
    expect(overview.canAddRouter).toBe(true);
  });

  it("compte les routeurs utilisés dans les données de démonstration", () => {
    expect(countRoutersForSubscription(routers)).toBe(2);
  });

  it("marque le paiement manuel sans intégrer de paiement en ligne", () => {
    const subscription = markSubscriptionPaymentManual();

    expect(subscription.paymentStatus).toBe("manual");
    expect(subscription.status).toBe("active");
  });
});
