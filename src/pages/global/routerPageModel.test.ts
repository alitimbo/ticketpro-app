import { afterEach, describe, expect, it } from "vitest";
import {
  createRouterFromForm,
  demoRouters,
  emptyRouterFormValues,
  filterRouters,
  getRouterLimitMessage,
  listRoutersForAccount
} from "./routerPageModel";
import { countRoutersForSubscription, getSubscriptionOverview } from "./subscriptionPageModel";

describe("routerPageModel", () => {
  afterEach(() => {
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:billing_invoices");
  });

  it("filtre les routeurs par nom, IP ou modèle", () => {
    expect(filterRouters(demoRouters, "192.168.88.1", "all")).toHaveLength(1);
    expect(filterRouters(demoRouters, "hAP", "all")).toHaveLength(2);
    expect(filterRouters(demoRouters, "nord", "all")[0]).toMatchObject({
      id: "point-nord"
    });
  });

  it("filtre les routeurs par statut", () => {
    expect(filterRouters(demoRouters, "", "active").map((router) => router.id)).toEqual([
      "routeur-demo"
    ]);
    expect(filterRouters(demoRouters, "", "offline").map((router) => router.id)).toEqual([
      "point-nord"
    ]);
  });

  it("liste uniquement les routeurs du compte principal connectÃ©", () => {
    const accountRouters = listRoutersForAccount(demoRouters, "account-douma-demo");
    const overview = getSubscriptionOverview(countRoutersForSubscription(accountRouters));

    expect(accountRouters.map((router) => router.id)).toEqual(["routeur-demo"]);
    expect(overview.routersUsed).toBe(1);
    expect(overview.subscription.routerLimitSnapshot).toBe(1);
    expect(overview.canAddRouter).toBe(false);
    expect(getRouterLimitMessage(overview.canAddRouter)).toBe("Limite de routeurs atteinte pour votre abonnement.");
  });

  it("rattache un nouveau routeur au compte et au profil interne", () => {
    const router = createRouterFromForm(
      {
        ...emptyRouterFormValues,
        ipAddress: "192.168.99.1",
        name: "Zone test",
        password: "secret"
      },
      "secret://router-test/password",
      null,
      "router-test",
      {
        accountId: "account-douma-demo",
        createdByProfileId: "account-douma-demo:internal-profile-operator"
      }
    );

    expect(router).toMatchObject({
      accountId: "account-douma-demo",
      createdByProfileId: "account-douma-demo:internal-profile-operator",
      id: "router-test",
      subscriptionCounted: true
    });
  });
});
