import { afterEach, describe, expect, it } from "vitest";
import {
  accountSecurityLogKey,
  appendAccountSecurityLog,
  changeMainAccountPassword,
  createMainAccountSession,
  isMainAccountSessionExpired,
  mainAccountRecordKey,
  mainAccountSessionKey,
  readAccountSecurityLogs,
  readMainAccountRecord,
  recordMainAccountLogin,
  updateMainAccountDetails,
  verifyMainAccount
} from "./mainAccount";

describe("main account authentication", () => {
  afterEach(() => {
    localStorage.removeItem(mainAccountSessionKey);
    localStorage.removeItem(mainAccountRecordKey);
    localStorage.removeItem(accountSecurityLogKey);
    localStorage.removeItem("hotspot:app_settings");
  });

  it("valide le compte principal de développement avec un mot de passe hashé", async () => {
    await expect(verifyMainAccount("doumacorporation@gmail.com", "test123")).resolves.toBe(true);
    await expect(verifyMainAccount("doumacorporation@gmail.com", "mauvais")).resolves.toBe(false);
    await expect(verifyMainAccount("autre@example.com", "test123")).resolves.toBe(false);
  });

  it("expire la session du compte principal selon le délai configuré", () => {
    localStorage.setItem("hotspot:app_settings", JSON.stringify({ sessionTimeoutMinutes: 10 }));

    const session = createMainAccountSession("doumacorporation@gmail.com", 1_000);

    expect(session.email).toBe("doumacorporation@gmail.com");
    expect(session.accountId).toBe("account-douma-demo");
    expect(session.expiresAt).toBe(601_000);
    expect(isMainAccountSessionExpired(session, 600_000)).toBe(false);
    expect(isMainAccountSessionExpired(session, 601_000)).toBe(true);
  });
  it("met a jour les informations du compte principal sans toucher au hash", () => {
    const before = readMainAccountRecord("doumacorporation@gmail.com")!;
    const updated = updateMainAccountDetails({
      companyName: "Douma WiFi",
      displayName: "Douma",
      email: "doumacorporation@gmail.com",
      phone: "+22790000000"
    });

    expect(updated).toMatchObject({
      companyName: "Douma WiFi",
      displayName: "Douma",
      phone: "+22790000000"
    });
    expect(updated.passwordHash).toBe(before.passwordHash);
  });

  it("change le mot de passe principal avec ancien mot de passe et garde un hash", async () => {
    await expect(verifyMainAccount("doumacorporation@gmail.com", "test123")).resolves.toBe(true);

    const result = await changeMainAccountPassword({
      email: "doumacorporation@gmail.com",
      newPassword: "nouveau123",
      oldPassword: "test123"
    });

    expect(result.ok).toBe(true);
    await expect(verifyMainAccount("doumacorporation@gmail.com", "test123")).resolves.toBe(false);
    await expect(verifyMainAccount("doumacorporation@gmail.com", "nouveau123")).resolves.toBe(true);
    expect(readMainAccountRecord("doumacorporation@gmail.com")?.passwordHash).not.toContain("nouveau123");
  });

  it("enregistre la derniere connexion et un log de securite sans secret", () => {
    recordMainAccountLogin("doumacorporation@gmail.com", "2026-07-10T10:00:00.000Z");
    appendAccountSecurityLog({
      accountId: "account-douma-demo",
      internalProfileId: "internal-profile-admin",
      message: "Mot de passe principal modifié."
    });

    expect(readMainAccountRecord("doumacorporation@gmail.com")?.lastLoginAt).toBe("2026-07-10T10:00:00.000Z");
    expect(readAccountSecurityLogs()[0]).toMatchObject({
      accountId: "account-douma-demo",
      internalProfileId: "internal-profile-admin"
    });
    expect(JSON.stringify(readAccountSecurityLogs())).not.toContain("test123");
  });
});
