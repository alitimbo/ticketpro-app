import { describe, expect, it } from "vitest";
import type { ActiveHotspotUser, HotspotUser } from "../../domain/router";
import { RouterServiceError } from "../router";
import { compareLocalAndRouterTickets, RouterTicketSyncService, type SyncableLocalTicket } from "./RouterTicketSyncService";

const localTickets: SyncableLocalTicket[] = [
  {
    activatedAt: null,
    batchId: "batch-1",
    code: "123456",
    id: "ticket-1",
    ipAddress: null,
    macAddress: null,
    mikrotikId: null,
    passwordSecretRef: "secret://routeur-demo/123456/password",
    planId: "plan-1",
    routerId: "routeur-demo",
    status: "disponible",
    syncStatus: "local_only"
  },
  {
    activatedAt: null,
    batchId: "batch-1",
    code: "654321",
    id: "ticket-2",
    ipAddress: null,
    macAddress: null,
    mikrotikId: null,
    passwordSecretRef: "secret://routeur-demo/654321/password",
    planId: "plan-1",
    routerId: "routeur-demo",
    status: "disponible",
    syncStatus: "local_only"
  }
];

const routerUsers: HotspotUser[] = [
  {
    comment: null,
    createdAt: "2026-07-09T10:00:00.000Z",
    id: "*1",
    passwordSecretRef: "secret://router/123456/password",
    planId: "plan-1",
    profileName: "plan-1",
    status: "available",
    username: "123456"
  },
  {
    comment: null,
    createdAt: "2026-07-09T10:00:00.000Z",
    id: "*2",
    passwordSecretRef: "secret://router/999999/password",
    planId: "plan-2",
    profileName: "plan-2",
    status: "available",
    username: "999999"
  }
];

const activeUsers: ActiveHotspotUser[] = [
  {
    downloadedBytes: 10,
    id: "*A",
    ipAddress: "192.168.88.20",
    macAddress: "AA:BB:CC:DD:EE:FF",
    sessionTimeLeft: "1h",
    uploadedBytes: 5,
    uptime: "5m",
    username: "123456"
  }
];

describe("RouterTicketSyncService", () => {
  it("compare les tickets locaux et ceux du routeur", () => {
    const report = compareLocalAndRouterTickets(localTickets, routerUsers, activeUsers);

    expect(report.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ticket-1",
          ipAddress: "192.168.88.20",
          macAddress: "AA:BB:CC:DD:EE:FF",
          syncStatus: "router_synced"
        }),
        expect.objectContaining({
          id: "ticket-2",
          status: "erreur_sync",
          syncStatus: "router_missing"
        })
      ])
    );
    expect(report.localMissing).toEqual([expect.objectContaining({ code: "999999", syncStatus: "local_missing" })]);
    expect(report.summary).toMatchObject({ localMissing: 1, routerMissing: 1, routerSynced: 1 });
  });

  it("resynchronise un ticket manquant en créant l'utilisateur sur le routeur", async () => {
    const createdUsers: string[] = [];
    const service = new RouterTicketSyncService({
      createHotspotUser: async (user) => {
        createdUsers.push(user.username);
        return {
          comment: user.comment ?? null,
          createdAt: "2026-07-09T10:00:00.000Z",
          id: "*created",
          passwordSecretRef: user.passwordSecretRef,
          planId: user.planId,
          profileName: user.planId,
          status: "available",
          username: user.username
        };
      },
      listActiveUsers: async () => [],
      listHotspotUsers: async () => []
    });

    const report = await service.resyncTicket(localTickets[1]);

    expect(createdUsers).toEqual(["654321"]);
    expect(report.updates[0]).toMatchObject({ mikrotikId: "*created", syncStatus: "router_synced" });
  });

  it("distingue la désactivation manuelle d'une limite consommée", () => {
    const report = compareLocalAndRouterTickets(
      [localTickets[0]],
      [{ ...routerUsers[0], status: "disabled" }],
      []
    );

    expect(report.updates[0]).toMatchObject({ id: "ticket-1", status: "désactivé", syncStatus: "router_synced" });
  });

  it("supprime un ticket sur le routeur avant sa suppression locale", async () => {
    const removedUsers: string[] = [];
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => routerUsers[0],
      listActiveUsers: async () => [],
      listHotspotUsers: async () => routerUsers,
      removeHotspotUser: async (username) => {
        removedUsers.push(username);
      }
    });

    const report = await service.removeTicket(localTickets[0]);

    expect(removedUsers).toEqual(["123456"]);
    expect(report.updates[0]).toMatchObject({ id: "ticket-1", status: "supprimé", syncStatus: "router_synced" });
  });

  it("considère comme supprimé un voucher déjà absent de RouterOS", async () => {
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => routerUsers[0],
      listActiveUsers: async () => [],
      listHotspotUsers: async () => [],
      removeHotspotUser: async () => {
        throw new RouterServiceError("hotspot_not_found", "Absent");
      }
    });

    const report = await service.removeTicket(localTickets[0]);

    expect(report.updates[0]).toMatchObject({
      id: "ticket-1",
      status: "supprimé",
      syncStatus: "router_synced"
    });
    expect(report.logs[0]).toMatchObject({ level: "warning" });
  });

  it("récupère un ticket créé malgré une erreur réseau de confirmation", async () => {
    let listCalls = 0;
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => {
        throw new Error("timeout après création");
      },
      listActiveUsers: async () => [],
      listHotspotUsers: async () => {
        listCalls += 1;
        return listCalls === 1 ? [] : [{ ...routerUsers[1], planId: "plan-1", profileName: "plan-1", username: "654321" }];
      }
    });

    const report = await service.resyncTicket(localTickets[1]);

    expect(report.updates[0]).toMatchObject({ id: "ticket-2", syncStatus: "router_synced" });
    expect(report.logs[0]).toMatchObject({ level: "warning" });
  });

  it("importe les compteurs cumulés et détecte une limite atteinte", () => {
    const report = compareLocalAndRouterTickets(
      [{ ...localTickets[0], downloadedBytes: 10, uploadedBytes: 5 }],
      [{
        ...routerUsers[0],
        downloadedBytes: 4_000,
        uploadedBytes: 1_000,
        uptime: "1h",
        status: "expired"
      }],
      []
    );

    expect(report.updates[0]).toMatchObject({
      completedAt: expect.any(String),
      downloadedBytes: 4_000,
      status: "complété",
      uploadedBytes: 1_000
    });
  });
});
