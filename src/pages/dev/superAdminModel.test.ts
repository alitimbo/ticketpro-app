import { describe, expect, it, beforeEach } from "vitest";
import { mainAccountRecordsKey, mainAccountRecordKey, saveMainAccountRecord } from "../../services/auth";
import {
  activateSuperAdmin,
  createInvoiceForDevelopment,
  createSuperAdminSession,
  isSuperAdminAvailable,
  listSuperAdminAccounts,
  markInvoicePaidForDevelopment,
  readSuperAdminSession,
  setAccountStatusForDevelopment,
  superAdminConfigKey,
  updateAccountPlanForDevelopment,
  verifySuperAdminPassword
} from "./superAdminModel";

describe("superAdminModel", () => {
  beforeEach(() => {
    localStorage.removeItem(superAdminConfigKey);
    localStorage.removeItem(mainAccountRecordKey);
    localStorage.removeItem(mainAccountRecordsKey);
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:account_subscriptions_by_account");
    localStorage.removeItem("hotspot:billing_invoices");
    localStorage.removeItem("hotspot:billing_invoices_by_account");
    localStorage.removeItem("hotspot:account_security_logs");
    sessionStorage.clear();
  });

  it("reste disponible uniquement en developpement et demande un mot de passe local", async () => {
    expect(isSuperAdminAvailable()).toBe(true);
    expect(await verifySuperAdminPassword("supersecret")).toBe(false);

    const weak = await activateSuperAdmin("court");
    expect(weak.ok).toBe(false);

    const activated = await activateSuperAdmin("supersecret");
    expect(activated.ok).toBe(true);
    await expect(verifySuperAdminPassword("supersecret")).resolves.toBe(true);
    await expect(verifySuperAdminPassword("mauvais")).resolves.toBe(false);
  });

  it("modifie le pack, cree une facture et suspend un compte local", async () => {
    saveMainAccountRecord({
      companyName: "Douma WiFi",
      createdAt: "2026-07-11T00:00:00.000Z",
      displayName: "Douma WiFi",
      email: "contact@douma.test",
      id: "account-douma-test",
      lastLoginAt: null,
      passwordHash: "hash-local",
      phone: "",
      status: "active",
      updatedAt: "2026-07-11T00:00:00.000Z"
    });

    updateAccountPlanForDevelopment("account-douma-test", "subscription-plan-5-routers");
    let account = listSuperAdminAccounts().find((item) => item.account.id === "account-douma-test");
    expect(account?.plan.name).toBe("Pack 5 routeurs");
    expect(account?.subscription.routerLimitSnapshot).toBe(5);

    const invoices = createInvoiceForDevelopment("account-douma-test", new Date("2026-07-11T12:00:00.000Z"));
    expect(invoices[0]).toMatchObject({
      amountCfa: 6000,
      packName: "Pack 5 routeurs",
      status: "draft"
    });

    markInvoicePaidForDevelopment("account-douma-test", invoices[0].id, "2026-07-11T13:00:00.000Z");
    account = listSuperAdminAccounts().find((item) => item.account.id === "account-douma-test");
    expect(account?.lastInvoice?.status).toBe("paid");

    setAccountStatusForDevelopment("account-douma-test", "suspended");
    account = listSuperAdminAccounts().find((item) => item.account.id === "account-douma-test");
    expect(account?.account.status).toBe("suspended");
  });

  it("cree une session courte apres validation", () => {
    createSuperAdminSession(1000);
    expect(readSuperAdminSession(1000)).toMatchObject({ createdAt: 1000 });
    expect(readSuperAdminSession(1000 + 31 * 60 * 1000)).toBeNull();
  });
});
