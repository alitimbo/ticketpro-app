import { describe, expect, it } from "vitest";
import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";
import {
  buildCachedConnectedClientViewModels,
  buildConnectedClientViewModels,
  describeClientDataQuota,
  deviceLockLabel,
  emptyConnectedClientFilters,
  filterConnectedClients,
  formatClientBytes,
  findVouchersMissingQuota,
  formatDeviceLockSummary,
  getConnectedClientPlanOptions,
  summarizeDeviceLocks
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
        data_limit_mb_snapshot: 10,
        download_limit_snapshot: "2M",
        duration_minutes_snapshot: 180,
        expires_at: null,
        id: "ticket-1",
        ip_address: null,
        mac_address: null,
        mikrotik_id: "*U1",
        mikrotik_profile_name: "voucher-3h",
        password_encrypted: "protected",
        plan_id: "plan-1h",
        printed_count: 0,
        router_id: "router-1",
        status: "désactivé",
        sync_status: "synced",
        shared_users_snapshot: 2,
        updated_at: "2026-07-29T09:00:00.000Z",
        uploaded_bytes: 0,
        upload_limit_snapshot: "1M",
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
      dataLimitBytes: 10 * 1024 * 1024,
      dataRemainingBytes: (10 * 1024 * 1024) - 5120,
      downloadLimit: "2M",
      planName: "Forfait 1h",
      profileName: "voucher-3h",
      sessionTimeLeft: "2 h 50 min",
      sharedUsers: 2,
      ticketStatus: "disabled",
      totalBytes: 5120,
      uploadLimit: "1M",
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

describe("verrouillage MAC des clients connectés", () => {
  const router = { id: "routeur-demo", name: "Routeur démo" };
  const session = (username: string, mac: string, id = `a-${username}-${mac}`): ActiveHotspotUser => ({
    ...activeUsers[0], id, macAddress: mac, username
  });
  const user = (username: string, macAddress: string | null, comment: string | null = "TicketPro:v1;validity=60;expires=0;state=new;"): HotspotUser => ({
    ...hotspotUsers[0], comment, id: `u-${username}`, macAddress, username
  });

  it("compte des vouchers uniques lus sur RouterOS et isole les sessions hors vouchers", () => {
    const clients = buildConnectedClientViewModels(
      [
        session("V1", "AA:00:00:00:00:01"),
        session("V2", "aa-00-00-00-00-02"),
        session("V3", "AA:00:00:00:00:03"),
        session("V3", "AA:00:00:00:00:33"),
        session("V4", "AA:00:00:00:00:04"),
        session("admin", "AA:00:00:00:00:05"),
        session("trial", "AA:00:00:00:00:06")
      ],
      [
        user("V1", "AA:00:00:00:00:01"),
        user("V2", "AA:00:00:00:00:02"),
        user("V3", "AA:00:00:00:00:03"),
        user("V4", null, null),
        user("admin", null, null)
      ],
      plans,
      router,
      undefined,
      new Set(["V1", "V2", "V3", "V4"])
    );

    expect(clients.map((client) => client.deviceLock.state)).toEqual([
      "locked", "locked", "locked", "mismatch", "unlocked", "not_voucher", "not_voucher"
    ]);
    const summary = summarizeDeviceLocks(clients);
    expect(summary).toEqual({
      concernedVouchers: 4,
      lockedVouchers: 2,
      mismatchVouchers: 1,
      outsideSessions: 2,
      sessions: 7,
      unlockedVouchers: 1,
      unverifiedVouchers: 0
    });
    expect(formatDeviceLockSummary(summary)).toBe(
      "2 ticket(s) verrouillé(s) sur 4 ticket(s) TicketPro concerné(s) · 1 non verrouillé(s) · 1 appareil(s) différent(s) du verrou · 2 session(s) hors vouchers TicketPro — 7 session(s) affichée(s)."
    );
  });

  it("ne déclare jamais un verrou vérifié depuis le cache", () => {
    const [client] = buildCachedConnectedClientViewModels(
      [{ cached_at: "2026-07-29T09:00:00.000Z", created_at: "2026-07-29T09:00:00.000Z", deleted_at: null,
        downloaded_bytes: 0, id: "c1", ip_address: null, mac_address: "AA:00:00:00:00:01", router_id: "router-1",
        session_time_left: null, sync_status: "synced", updated_at: "2026-07-29T09:00:00.000Z",
        uploaded_bytes: 0, uptime: "1m", username: "inconnu" }],
      [],
      [],
      router
    );
    expect(client.deviceLock.state).toBe("not_voucher");
    expect(deviceLockLabel({ lockedMacAddress: "AA:00:00:00:00:01", state: "unverified" })).toBe("Non vérifié (cache : AA:00:00:00:00:01)");
  });
});

describe("quota data des clients connectés", () => {
  const router = { id: "routeur-demo", name: "Routeur démo" };
  const quotaPlan: HotspotPlan = { ...plans[0], dataLimitMb: 2048, id: "plan-6h-2g", name: "6H-2G", profileName: "6H-2G" };
  const unlimitedPlan: HotspotPlan = { ...plans[0], dataLimitMb: null, id: "plan-6h", name: "6H", profileName: "6H" };
  const voucher = (overrides: Partial<HotspotUser>): HotspotUser => ({
    ...hotspotUsers[0],
    downloadedBytes: 300 * 1024 * 1024,
    uploadedBytes: 100 * 1024 * 1024,
    ...overrides
  });

  it("affiche quota total et volume restant lus sur RouterOS (2G = 2 × 1024³ octets, montant + descendant)", () => {
    const [client] = buildConnectedClientViewModels(
      [{ ...activeUsers[0], downloadedBytes: 0, uploadedBytes: 0 }],
      [voucher({ limitBytesTotal: 2 * 1024 ** 3, planId: "6H-2G", profileName: "6H-2G" })],
      [quotaPlan],
      router
    );

    expect(client).toMatchObject({ dataLimitBytes: 2 * 1024 ** 3, dataQuotaState: "limited", dataRemainingBytes: 2 * 1024 ** 3 - 400 * 1024 ** 2 });
    expect(describeClientDataQuota(client)).toEqual({ remaining: "1.6 Go", total: "2.0 Go" });
  });

  it("ne présente jamais un voucher non lu comme illimité", () => {
    const [client] = buildConnectedClientViewModels([activeUsers[0]], [], [quotaPlan], router);

    expect(client.dataQuotaState).toBe("unavailable");
    expect(describeClientDataQuota(client)).toEqual({ remaining: "Non disponible", total: "Non disponible" });
  });

  it("signale un plan avec quota dont le voucher RouterOS n'a pas de limit-bytes-total", () => {
    const [client] = buildConnectedClientViewModels(
      [activeUsers[0]],
      [voucher({ limitBytesTotal: null, planId: "6H-2G", profileName: "6H-2G" })],
      [quotaPlan],
      router
    );

    expect(client).toMatchObject({ dataLimitBytes: null, dataQuotaState: "missing_on_router", planDataLimitBytes: 2 * 1024 ** 3 });
    expect(describeClientDataQuota(client).total).toBe("Aucun quota sur le routeur (plan : 2.0 Go)");
    expect(describeClientDataQuota(client).remaining).not.toBe("Illimité");
  });

  it("réserve « Illimité » à un voucher lu sans limite dont le plan n'a pas de quota", () => {
    const [client] = buildConnectedClientViewModels(
      [activeUsers[0]],
      [voucher({ limitBytesTotal: null, planId: "6H", profileName: "6H" })],
      [unlimitedPlan],
      router
    );

    expect(client.dataQuotaState).toBe("unlimited");
    expect(describeClientDataQuota(client)).toEqual({ remaining: "Illimité", total: "Illimité" });
  });

  it("en cache, n'affiche pas « Illimité » faute de confirmation RouterOS", () => {
    const [client] = buildCachedConnectedClientViewModels(
      [{ cached_at: "2026-07-29T09:00:00.000Z", created_at: "2026-07-29T09:00:00.000Z", deleted_at: null,
        downloaded_bytes: 0, id: "c1", ip_address: null, mac_address: null, router_id: "router-1",
        session_time_left: null, sync_status: "synced", updated_at: "2026-07-29T09:00:00.000Z",
        uploaded_bytes: 0, uptime: "1m", username: "inconnu" }],
      [],
      [],
      router
    );

    expect(client.dataQuotaState).toBe("unavailable");
    expect(describeClientDataQuota(client).total).toBe("Non disponible");
  });
});

describe("findVouchersMissingQuota", () => {
  const plan = { data_limit_mb: 2048, deleted_at: null, mikrotik_profile_name: "6H-2G", name: "6H-2G" };
  const user = (username: string, overrides: Partial<HotspotUser> = {}): HotspotUser => ({
    ...hotspotUsers[0], planId: "6H-2G", profileName: "6H-2G", username, ...overrides
  });

  it("liste les vouchers d'un plan à quota sans limit-bytes-total, connectés ou non", () => {
    const candidates = findVouchersMissingQuota(
      [
        user("A", { limitBytesTotal: null, downloadedBytes: 100, uploadedBytes: 50 }),
        user("B", { limitBytesTotal: 2 * 1024 ** 3 }),
        user("C", { limitBytesTotal: null, downloadedBytes: 3 * 1024 ** 3 }),
        user("D", { limitBytesTotal: null, profileName: "autre", planId: "autre" })
      ],
      [plan, { data_limit_mb: null, deleted_at: null, mikrotik_profile_name: "autre", name: "Autre" }],
      new Set(["A"])
    );
    expect(candidates).toEqual([
      { exceedsQuota: false, isConnected: true, limitBytesTotal: 2 * 1024 ** 3, planName: "6H-2G", usedBytes: 150, username: "A" },
      { exceedsQuota: true, isConnected: false, limitBytesTotal: 2 * 1024 ** 3, planName: "6H-2G", usedBytes: 3 * 1024 ** 3, username: "C" }
    ]);
  });
});

describe("nom de plan après renommage dans TicketPro", () => {
  it("affiche le nom TicketPro actuel d'un profil RouterOS inchangé", () => {
    const [client] = buildConnectedClientViewModels(
      [activeUsers[0]],
      [{ ...hotspotUsers[0], planId: "4H", profileName: "4H" }],
      [{ ...plans[0], id: "*P4", name: "4H", profileName: "4H" }],
      { id: "routeur-demo", name: "Routeur démo" },
      new Map([["4H", "6H"]])
    );
    expect(client).toMatchObject({ planName: "6H", profileName: "4H" });
  });
});
