import { afterEach, describe, expect, it } from "vitest";
import {
  completeFirstLaunch,
  defaultFirstLaunchState,
  validateFirstLaunchStep
} from "./firstLaunchModel";
import {
  firstLaunchFlagKey,
  hasProfilePasswordConfigured,
  mainAccountRecordKey,
  profilePasswordHashesKey,
  readMainAccountRecord,
  verifyMainAccount
} from "../../services/auth";
import { InMemoryDatabaseClient } from "../../services/database";

describe("firstLaunchModel", () => {
  afterEach(() => {
    localStorage.removeItem(firstLaunchFlagKey);
    localStorage.removeItem(mainAccountRecordKey);
    localStorage.removeItem(profilePasswordHashesKey);
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:internal_profiles");
  });

  it("valide les etapes obligatoires", () => {
    expect(validateFirstLaunchStep(1, defaultFirstLaunchState)).toBe("Entrez un email valide.");
    expect(
      validateFirstLaunchStep(3, {
        ...defaultFirstLaunchState,
        account: {
          companyName: "Douma",
          confirmPassword: "secret123",
          email: "douma@example.com",
          password: "secret123",
          phone: ""
        }
      })
    ).toBe("Le mot de passe Admin est obligatoire et doit contenir au moins 6 caractères.");
  });

  it("cree le compte principal, le pack et au moins le profil Admin", async () => {
    const summary = await completeFirstLaunch({
      ...defaultFirstLaunchState,
      account: {
        companyName: "Douma WiFi",
        confirmPassword: "secret123",
        email: "contact@douma.test",
        password: "secret123",
        phone: "+22790000000"
      },
      profilePasswords: {
        admin: "admin123",
        agent: "",
        guest: "",
        operator: "operateur123"
      },
      selectedPlanId: "subscription-plan-5-routers",
      subscriptionStatus: "trial"
    });

    expect(summary).toMatchObject({
      accountEmail: "contact@douma.test",
      companyName: "Douma WiFi",
      planName: "Pack 5 routeurs"
    });
    expect(readMainAccountRecord("contact@douma.test")).toMatchObject({
      companyName: "Douma WiFi",
      email: "contact@douma.test",
      status: "trial"
    });
    await expect(verifyMainAccount("contact@douma.test", "secret123")).resolves.toBe(true);
    expect(readMainAccountRecord("contact@douma.test")?.passwordHash).not.toContain("secret123");
    const accountId = "account-contact@douma.test";
    expect(hasProfilePasswordConfigured("admin", accountId)).toBe(true);
    expect(hasProfilePasswordConfigured("operator", accountId)).toBe(true);
    expect(hasProfilePasswordConfigured("agent", accountId)).toBe(false);
    expect(localStorage.getItem(firstLaunchFlagKey)).toBe("false");
  });

  it("initialise aussi les comptes, profils et abonnement dans SQLite", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();

    await completeFirstLaunch(
      {
        ...defaultFirstLaunchState,
        account: {
          companyName: "SQLite WiFi",
          confirmPassword: "secret123",
          email: "sqlite@douma.test",
          password: "secret123",
          phone: "70000000"
        },
        profilePasswords: { admin: "admin123", agent: "", guest: "", operator: "" }
      },
      database
    );

    await expect(database.query("SELECT * FROM accounts WHERE id = ?1", ["account-sqlite@douma.test"])).resolves.toMatchObject([
      expect.objectContaining({ company_name: "SQLite WiFi", email: "sqlite@douma.test" })
    ]);
    await expect(database.query("SELECT * FROM internal_profiles WHERE account_id = ?1", ["account-sqlite@douma.test"])).resolves.toHaveLength(4);
    await expect(database.query("SELECT * FROM account_subscriptions WHERE account_id = ?1", ["account-sqlite@douma.test"])).resolves.toHaveLength(1);
  });

  it("enregistre exactement l'offre renvoyée par le serveur de licences", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();

    await completeFirstLaunch(
      {
        ...defaultFirstLaunchState,
        account: {
          companyName: "Revendeur WiFi",
          confirmPassword: "secret123",
          email: "reseller@douma.test",
          password: "secret123",
          phone: ""
        },
        profilePasswords: { admin: "admin123", agent: "", guest: "", operator: "" },
        selectedPlanId: "reseller-dynamic",
        subscriptionStatus: "active_manual"
      },
      database,
      {
        billingPeriod: "monthly",
        description: "Offre administrée depuis le VPS",
        durationDays: 90,
        maxDevices: 25,
        planCode: "RESELLER-DYNAMIC",
        planId: "reseller-dynamic",
        planName: "Revendeur dynamique",
        priceCfa: 55000,
        routerLimit: 100
      }
    );

    await expect(database.query("SELECT * FROM subscription_plans WHERE id = ?1", ["reseller-dynamic"]))
      .resolves.toMatchObject([expect.objectContaining({ name: "Revendeur dynamique", router_limit: 100 })]);
    await expect(database.query("SELECT * FROM account_subscriptions WHERE account_id = ?1", ["account-reseller@douma.test"]))
      .resolves.toMatchObject([
        expect.objectContaining({
          router_limit_snapshot: 100,
          price_cfa_snapshot: 55000,
          subscription_plan_id: "reseller-dynamic"
        })
      ]);
  });
});
