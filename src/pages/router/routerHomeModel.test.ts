import { describe, expect, it } from "vitest";
import {
  buildRouterHomeIndicators,
  formatBytes,
  getRouterQuickActions,
  shouldShowDeviceProtectionNotice
} from "./routerHomeModel";

describe("routerHomeModel", () => {
  it("adapte les actions rapides selon le rôle", () => {
    expect(getRouterQuickActions("operator", "demo").map((action) => action.id)).toEqual([
      "createTickets",
      "tickets",
      "clients",
      "report",
      "testRouter"
    ]);

    expect(getRouterQuickActions("agent", "demo").map((action) => action.id)).toEqual([
      "createTickets",
      "tickets",
      "report",
      "testRouter"
    ]);

    expect(getRouterQuickActions("guest", "demo").map((action) => action.id)).toEqual([
      "tickets",
      "report"
    ]);
  });

  it("formate les volumes mémoire", () => {
    expect(formatBytes(84 * 1024 * 1024)).toBe("84 Mo");
    expect(formatBytes(256 * 1024 * 1024)).toBe("256 Mo");
  });

  it("signale tant que le blocage TTL strict n'est pas activé", () => {
    expect(shouldShowDeviceProtectionNotice(null)).toBe(false);
    expect(shouldShowDeviceProtectionNotice({
      antiSharingMode: "observe",
      monitorIpv4Ttl: false
    })).toBe(true);
    expect(shouldShowDeviceProtectionNotice({
      antiSharingMode: "strict",
      monitorIpv4Ttl: false
    })).toBe(true);
    expect(shouldShowDeviceProtectionNotice({
      antiSharingMode: "strict",
      monitorIpv4Ttl: true
    })).toBe(false);
  });

  it("sépare les vouchers locaux, les comptes RouterOS et les sessions actives", () => {
    const indicators = buildRouterHomeIndicators({
      activeUsers: [{}, {}],
      generatedPdfCount: 4,
      localVoucherCount: 12,
      plans: [{ status: "active" }, { status: "disabled" }, { status: "active" }],
      routerUsers: [{}, {}, {}, {}, {}]
    } as Parameters<typeof buildRouterHomeIndicators>[0]);

    expect(indicators).toEqual({
      activePlanCount: 2,
      connectedClientCount: 2,
      generatedPdfCount: 4,
      localVoucherCount: 12,
      routerPlanCount: 3,
      routerVoucherCount: 5
    });
  });
});
