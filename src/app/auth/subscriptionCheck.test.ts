import { afterEach, describe, expect, it } from "vitest";
import { SaasRequestError } from "../../services/saas";
import { cachedSubscriptionAllowsAccess } from "../../pages/global/subscriptionPageModel";
import { isRejectedSaasSession, subscriptionRetryDelayMs } from "./AuthProvider";

const storageKey = "hotspot:account_subscriptions_by_account";

describe("vérification de l'abonnement", () => {
  afterEach(() => localStorage.clear());

  it("ne considère un abonnement absent que si le serveur a refusé la session", () => {
    expect(isRejectedSaasSession(new SaasRequestError("unauthorized", 401))).toBe(true);
    expect(isRejectedSaasSession(new SaasRequestError("forbidden", 403))).toBe(true);
    // Server error, timeout or network failure: unknown, never expired.
    expect(isRejectedSaasSession(new SaasRequestError("Erreur TicketPro (502).", 502))).toBe(false);
    expect(isRejectedSaasSession(new DOMException("The operation was aborted.", "AbortError"))).toBe(false);
    expect(isRejectedSaasSession(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("réessaie de plus en plus espacé, puis chaque minute", () => {
    expect([0, 1, 2, 3, 10].map(subscriptionRetryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
  });

  it("hors ligne, s'appuie seulement sur le dernier abonnement confirmé et jusqu'à sa date de fin", () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    const save = (subscription: Record<string, unknown>) =>
      localStorage.setItem(storageKey, JSON.stringify({ a1: subscription }));

    // Never confirmed on this device: no offline access.
    expect(cachedSubscriptionAllowsAccess("a1", now)).toBe(false);

    save({ currentPeriodEnd: "2027-10-01T00:00:00.000Z", status: "active" });
    expect(cachedSubscriptionAllowsAccess("a1", now)).toBe(true);
    expect(cachedSubscriptionAllowsAccess("autre-compte", now)).toBe(false);

    save({ currentPeriodEnd: "2026-10-01T00:00:00.000Z", status: "active" });
    expect(cachedSubscriptionAllowsAccess("a1", now)).toBe(false);

    save({ currentPeriodEnd: "2027-10-01T00:00:00.000Z", status: "expired" });
    expect(cachedSubscriptionAllowsAccess("a1", now)).toBe(false);
  });
});
