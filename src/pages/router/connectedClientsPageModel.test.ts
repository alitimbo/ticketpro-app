import { describe, expect, it } from "vitest";
import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";
import {
  buildConnectedClientViewModels,
  emptyConnectedClientFilters,
  filterConnectedClients,
  formatClientBytes,
  getConnectedClientPlanOptions
} from "./connectedClientsPageModel";

const activeUsers: ActiveHotspotUser[] = [
  {
    downloadedBytes: 50 * 1024 * 1024,
    id: "active-1",
    ipAddress: "192.168.88.24",
    macAddress: "AA:BB:CC:DD:EE:01",
    sessionTimeLeft: "2h 12m",
    uploadedBytes: 5 * 1024 * 1024,
    uptime: "12m",
    username: "123456"
  },
  {
    downloadedBytes: 2 * 1024 * 1024 * 1024,
    id: "active-2",
    ipAddress: "192.168.88.40",
    macAddress: "AA:BB:CC:DD:EE:02",
    sessionTimeLeft: "20m",
    uploadedBytes: 100 * 1024 * 1024,
    uptime: "1h 20m",
    username: "654321"
  }
];

const hotspotUsers: HotspotUser[] = [
  {
    comment: null,
    createdAt: "2026-07-08T10:00:00.000Z",
    id: "ticket-1",
    passwordSecretRef: "secret://ticket-1/password",
    planId: "plan-1h",
    profileName: "plan-1h",
    status: "active",
    username: "123456"
  },
  {
    comment: null,
    createdAt: "2026-07-08T10:00:00.000Z",
    id: "ticket-2",
    passwordSecretRef: "secret://ticket-2/password",
    planId: "plan-jour",
    profileName: "plan-jour",
    status: "active",
    username: "654321"
  }
];

const plans: HotspotPlan[] = [
  {
    dataLimitMb: null,
    downloadLimit: "5M",
    durationMinutes: 60,
    id: "plan-1h",
    name: "1h",
    priceHint: 100,
    profileName: "plan-1h",
    sharedUsers: 1,
    status: "active",
    uploadLimit: "2M",
    validityMinutes: 180
  },
  {
    dataLimitMb: null,
    downloadLimit: "5M",
    durationMinutes: 1440,
    id: "plan-jour",
    name: "Journée",
    priceHint: 500,
    profileName: "plan-jour",
    sharedUsers: 1,
    status: "active",
    uploadLimit: "2M",
    validityMinutes: 1440
  }
];

describe("connectedClientsPageModel", () => {
  it("associe les clients actifs à leurs tickets et plans", () => {
    const clients = buildConnectedClientViewModels(activeUsers, hotspotUsers, plans, {
      id: "routeur-demo",
      name: "Routeur démo"
    });

    expect(clients[0]).toMatchObject({
      planName: "1h",
      routerName: "Routeur démo",
      totalBytes: 55 * 1024 * 1024,
      username: "123456"
    });
  });

  it("filtre par code, MAC, IP, plan et durée", () => {
    const clients = buildConnectedClientViewModels(activeUsers, hotspotUsers, plans, {
      id: "routeur-demo",
      name: "Routeur démo"
    });

    expect(filterConnectedClients(clients, { ...emptyConnectedClientFilters, code: "654" })).toHaveLength(1);
    expect(filterConnectedClients(clients, { ...emptyConnectedClientFilters, macAddress: "EE:01" })).toHaveLength(1);
    expect(filterConnectedClients(clients, { ...emptyConnectedClientFilters, ipAddress: ".40" })).toHaveLength(1);
    expect(filterConnectedClients(clients, { ...emptyConnectedClientFilters, planId: "plan-1h" })).toHaveLength(1);
    expect(filterConnectedClients(clients, { ...emptyConnectedClientFilters, duration: "long" })).toHaveLength(1);
  });

  it("prépare les options de plans et les volumes lisibles", () => {
    const clients = buildConnectedClientViewModels(activeUsers, hotspotUsers, plans, {
      id: "routeur-demo",
      name: "Routeur démo"
    });

    expect(getConnectedClientPlanOptions(clients)).toEqual([
      { id: "plan-1h", name: "1h" },
      { id: "plan-jour", name: "Journée" }
    ]);
    expect(formatClientBytes(55 * 1024 * 1024)).toBe("55 MB");
    expect(formatClientBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 Go");
  });
});
