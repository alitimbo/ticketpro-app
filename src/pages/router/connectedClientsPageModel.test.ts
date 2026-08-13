import { describe, expect, it } from "vitest";
import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";
import {
  buildCachedConnectedClientViewModels,
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
      ticketStatus: "active",
      totalBytes: 55 * 1024 * 1024,
      username: "123456"
    });
  });

  it("conserve le plan et l'état local dans le cache hors ligne", () => {
    const clients = buildCachedConnectedClientViewModels(
      [{
        cached_at: "2026-07-29T10:00:00.000Z",
        created_at: "2026-07-29T10:00:00.000Z",
        deleted_at: null,
        downloaded_bytes: 4096,
        id: "router-1:*A",
        ip_address: "192.168.88.20",
        mac_address: "AA:BB:CC:DD:EE:FF",
        router_id: "router-1",
        session_time_left: "50m",
        sync_status: "synced",
        updated_at: "2026-07-29T10:00:00.000Z",
        uploaded_bytes: 1024,
        uptime: "10m",
        username: "voucher-1"
      }],
      [{
        account_id: "account-1",
        activated_at: null,
        batch_id: "batch-1",
        completed_at: null,
        created_at: "2026-07-29T09:00:00.000Z",
        created_by_profile: "admin",
        created_by_profile_id: "profile-1",
        deleted_at: null,
        downloaded_bytes: 0,
        expires_at: null,
        id: "ticket-1",
        ip_address: null,
        mac_address: null,
        mikrotik_id: "*U1",
        password_encrypted: "protected",
        plan_id: "plan-1h",
        printed_count: 0,
        router_id: "router-1",
        status: "désactivé",
        sync_status: "synced",
        updated_at: "2026-07-29T09:00:00.000Z",
        uploaded_bytes: 0,
        username: "voucher-1"
      }],
      [{
        created_at: "2026-07-29T09:00:00.000Z",
        created_by_profile_id: "profile-admin",
        currency: "CFA",
        data_limit_mb: null,
        deleted_at: null,
        download_limit: "5M",
        duration_minutes: 60,
        id: "plan-1h",
        last_synced_at: "2026-07-29T09:00:00.000Z",
        mikrotik_id: "*1",
        mikrotik_profile_name: "plan-1h",
        name: "Forfait 1h",
        price_hint: 100,
        router_id: "router-1",
        revision: 1,
        shared_users: 1,
        status: "active",
        sync_status: "synced",
        updated_at: "2026-07-29T09:00:00.000Z",
        updated_by_profile_id: "profile-admin",
        upload_limit: "2M",
        validity_minutes: 180
      }],
      { id: "router-1", name: "Routeur test" }
    );

    expect(clients[0]).toMatchObject({
      planName: "Forfait 1h",
      ticketStatus: "disabled",
      totalBytes: 5120,
      username: "voucher-1"
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
    expect(formatClientBytes(512)).toBe("512 o");
    expect(formatClientBytes(2048)).toBe("2.0 Ko");
  });

  it("associe le nom de profil RouterOS à l'identifiant interne du plan", () => {
    const remotePlans = [{
      ...plans[0],
      id: "*P1",
      name: "Forfait 1 heure",
      profileName: "plan-1h"
    }];
    const clients = buildConnectedClientViewModels(
      [activeUsers[0]],
      [hotspotUsers[0]],
      remotePlans,
      { id: "routeur-demo", name: "Routeur démo" }
    );

    expect(clients[0]).toMatchObject({
      planId: "*P1",
      planName: "Forfait 1 heure"
    });
    expect(getConnectedClientPlanOptions(clients, remotePlans)).toEqual([
      { id: "*P1", name: "Forfait 1 heure" }
    ]);
  });

  it("comprend les semaines RouterOS pour le filtre de durée", () => {
    const clients = buildConnectedClientViewModels(
      [{ ...activeUsers[0], id: "active-week", uptime: "1w2d3h", username: "weekly" }],
      [],
      [],
      { id: "routeur-demo", name: "Routeur démo" }
    );

    expect(filterConnectedClients(clients, {
      ...emptyConnectedClientFilters,
      duration: "long"
    })).toHaveLength(1);
  });

  it("affiche la consommation cumulée du voucher et la session courante séparément", () => {
    const clients = buildConnectedClientViewModels(
      [{ ...activeUsers[0], downloadedBytes: 20 * 1024 * 1024, uptime: "12m" }],
      [{
        ...hotspotUsers[0],
        downloadedBytes: 70 * 1024 * 1024,
        limitBytesTotal: 100 * 1024 * 1024,
        limitUptime: "1h",
        uploadedBytes: 5 * 1024 * 1024,
        uptime: "45m"
      }],
      plans,
      { id: "routeur-demo", name: "Routeur démo" }
    );

    expect(clients[0]).toMatchObject({
      consumptionPercent: 75,
      currentSessionUptime: "12m",
      dataRemainingBytes: 25 * 1024 * 1024,
      downloadedBytes: 70 * 1024 * 1024,
      sessionTimeLeft: "15 min",
      totalBytes: 75 * 1024 * 1024,
      uptime: "45 min"
    });
  });
});
