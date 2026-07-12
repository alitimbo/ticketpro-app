import { afterEach, describe, expect, it } from "vitest";
import {
  authSessionKey,
  createSession,
  getConfiguredSessionTimeoutMs,
  isSessionExpired,
  readStoredSession
} from "./session";

describe("session", () => {
  afterEach(() => {
    localStorage.removeItem(authSessionKey);
    localStorage.removeItem("hotspot:app_settings");
  });

  it("migre une ancienne session de profil vers l'identité compte + profil canonique", () => {
    localStorage.setItem(
      authSessionKey,
      JSON.stringify({
        accountEmail: "doumacorporation@gmail.com",
        accountId: "account-douma-demo",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        label: "Opérateur",
        lastActivityAt: Date.now(),
        profileId: "internal-profile-operator",
        role: "operator"
      })
    );

    expect(readStoredSession()).toMatchObject({
      account_id: "account-douma-demo",
      account_email: "doumacorporation@gmail.com",
      internal_profile_id: "account-douma-demo:internal-profile-operator",
      internal_profile_role: "operator"
    });
    expect(localStorage.getItem(authSessionKey)).not.toContain('"profileId"');
  });

  it("utilise le délai de session configuré", () => {
    localStorage.setItem("hotspot:app_settings", JSON.stringify({ sessionTimeoutMinutes: 10 }));

    const session = createSession("admin", "doumacorporation@gmail.com", 1_000);

    expect(getConfiguredSessionTimeoutMs()).toBe(10 * 60 * 1000);
    expect(session.account_email).toBe("doumacorporation@gmail.com");
    expect(session.account_id).toBe("account-douma-demo");
    expect(session.internal_profile_id).toBe("account-douma-demo:internal-profile-admin");
    expect(session.internal_profile_role).toBe("admin");
    expect(session.permissions).toContain("global.settings.profiles");
    expect(session.expires_at).toBe(601_000);
    expect(isSessionExpired(session, 600_000)).toBe(false);
    expect(isSessionExpired(session, 601_000)).toBe(true);
  });
});
