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
});
