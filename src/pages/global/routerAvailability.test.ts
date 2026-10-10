import { describe, expect, it } from "vitest";
import {
  describeRouterAvailability,
  nextRouterHealthCheckDelayMs,
  routerAvailabilityFromTest,
  routerAvailabilityMaxAgeMs,
  routerHealthOnlineIntervalMs,
  routerHealthRetryIntervalMs
} from "./routerPageModel";
import { routerLiveDelayMs, routerReloadDelayMs } from "../router/RouterHomePage";

describe("disponibilité des routeurs", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");

  it("n'affiche jamais le point vert sans test confirmé pendant la session", () => {
    const display = describeRouterAvailability(undefined, "09/10/2026 08:00", now);
    expect(display.dot).toBe("checking");
    expect(display.label).toBe("Connexion en cours");
    expect(display.title).toContain("Dernière connexion confirmée : 09/10/2026 08:00");
  });

  it("distingue en ligne, joignable sans données, hors ligne et refus", () => {
    expect(routerAvailabilityFromTest("connected", false)).toBe("online");
    expect(routerAvailabilityFromTest("connected", true)).toBe("degraded");
    expect(routerAvailabilityFromTest("timeout", false)).toBe("offline");
    expect(routerAvailabilityFromTest("authentication_failed", false)).toBe("attention");

    expect(describeRouterAvailability({ checkedAt: now, state: "online" }, "", now)).toMatchObject({ dot: "active", label: "En ligne" });
    expect(describeRouterAvailability({ checkedAt: now, state: "degraded" }, "", now)).toMatchObject({ dot: "warning", label: "Données non actualisées" });
    expect(describeRouterAvailability({ checkedAt: now, state: "offline" }, "", now)).toMatchObject({ dot: "offline", label: "Hors ligne" });
    expect(describeRouterAvailability({ checkedAt: now, state: "attention" }, "", now)).toMatchObject({ dot: "warning", label: "À vérifier" });
  });

  it("retire le point vert quand la confirmation est trop ancienne", () => {
    const old = { checkedAt: now - routerAvailabilityMaxAgeMs - 1, state: "online" as const };
    expect(describeRouterAvailability(old, "", now)).toMatchObject({ dot: "warning", label: "Données non actualisées" });
  });

  it("revérifie plus vite un routeur hors ligne ou non confirmé", () => {
    expect(nextRouterHealthCheckDelayMs(["a", "b"], {
      a: { checkedAt: now, state: "online" },
      b: { checkedAt: now, state: "online" }
    })).toBe(routerHealthOnlineIntervalMs);
    expect(nextRouterHealthCheckDelayMs(["a", "b"], { a: { checkedAt: now, state: "online" } })).toBe(routerHealthRetryIntervalMs);
    expect(nextRouterHealthCheckDelayMs(["a"], { a: { checkedAt: now, state: "offline" } })).toBe(routerHealthRetryIntervalMs);
  });

  it("borne la cadence du live et des reprises après erreur", () => {
    expect([0, 1, 2, 3, 8].map(routerLiveDelayMs)).toEqual([15_000, 5_000, 10_000, 20_000, 30_000]);
    expect([1, 2, 3, 4, 10].map(routerReloadDelayMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
  });
});
