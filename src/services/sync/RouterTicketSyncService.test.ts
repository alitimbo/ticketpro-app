import { describe, expect, it } from "vitest";
import type { ActiveHotspotUser, HotspotUser } from "../../domain/router";
import { vi } from "vitest";
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
          status: "disponible",
          syncStatus: "router_missing"
        })
      ])
    );
    expect(report.localMissing).toEqual([expect.objectContaining({ code: "999999", syncStatus: "local_missing" })]);
    expect(report.summary).toMatchObject({ localMissing: 1, routerMissing: 1, routerSynced: 1 });
  });

  it("resynchronise un ticket manquant en créant l'utilisateur sur le routeur", async () => {
    const createdUsers: Array<{
      limitBytesTotal?: number | null;
      limitUptime?: string | null;
      username: string;
      validityMinutes?: number | null;
    }> = [];
    const service = new RouterTicketSyncService({
      createHotspotUser: async (user) => {
        createdUsers.push(user);
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

    const report = await service.resyncTicket({
      ...localTickets[1],
      dataLimitMb: 500,
      planDurationMinutes: 60,
      planValidityMinutes: 180
    });

    expect(createdUsers).toEqual([expect.objectContaining({
      limitBytesTotal: 500 * 1024 * 1024,
      limitUptime: "1h",
      username: "654321",
      validityMinutes: 180
    })]);
    expect(report.updates[0]).toMatchObject({ mikrotikId: "*created", syncStatus: "router_synced" });
  });

  it("refuse de recréer un voucher activé, épuisé ou ayant déjà consommé des octets", async () => {
    let createCalls = 0;
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => {
        createCalls += 1;
        return routerUsers[0];
      },
      listActiveUsers: async () => [],
      listHotspotUsers: async () => []
    });

    for (const ticket of [
      { ...localTickets[0], activatedAt: "2026-08-13T10:00:00.000Z", status: "activé" },
      { ...localTickets[0], status: "consommé", uptimeSeconds: 3600 },
      { ...localTickets[0], downloadedBytes: 1, status: "disponible" },
      { ...localTickets[0], mikrotikId: "*OLD", status: "disponible", syncStatus: "router_synced" as const }
    ]) {
      const report = await service.resyncTicket(ticket);
      expect(report.updates[0]).toMatchObject({ status: ticket.status, syncStatus: "error" });
    }

    expect(createCalls).toBe(0);
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

  it("supprime un lot complet et conserve en erreur les vouchers non confirmés", async () => {
    const removedUsers: string[] = [];
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => routerUsers[0],
      listActiveUsers: async () => [],
      listHotspotUsers: async () => routerUsers,
      removeHotspotUser: async (username) => {
        removedUsers.push(username);
        if (username === "654321") throw new Error("routeur inaccessible");
      }
    });

    const report = await service.removeBatch(localTickets, "batch-1");

    expect(removedUsers).toEqual(["123456", "654321"]);
    expect(report.updates).toEqual([
      expect.objectContaining({ id: "ticket-1", status: "supprimé", syncStatus: "router_synced" }),
      expect.objectContaining({ id: "ticket-2", status: "disponible", syncStatus: "error" })
    ]);
    expect(report.summary.error).toBe(1);
    expect(report.logs[0]).toMatchObject({ level: "error" });
  });

  it("utilise une seule operation RouterOS groupee pour supprimer un grand lot", async () => {
    const removeHotspotUsersBatch = vi.fn(async (usernames: string[]) => [
      ...usernames.map((username) => ({
        message: username === "654321" ? "autorisation externe" : undefined,
        status: username === "654321" ? "error" as const : "removed" as const,
        username
      })),
      { status: "removed" as const, username: "voucher-orphelin" }
    ]);
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => routerUsers[0],
      listActiveUsers: async () => [],
      listHotspotUsers: async () => routerUsers,
      removeHotspotUsersBatch
    });

    const report = await service.removeBatch(localTickets, "batch-1");

    expect(removeHotspotUsersBatch).toHaveBeenCalledOnce();
    expect(removeHotspotUsersBatch).toHaveBeenCalledWith(["123456", "654321"], "batch-1");
    expect(report.updates).toEqual([
      expect.objectContaining({ id: "ticket-1", status: "supprimé", syncStatus: "router_synced" }),
      expect.objectContaining({ id: "ticket-2", status: "disponible", syncStatus: "error" })
    ]);
    expect(report.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", message: expect.stringContaining("autorisation externe") })
    ]));
    expect(report).toMatchObject({
      remoteBatchExtrasDiscovered: 1,
      remoteBatchExtrasRemoved: 1
    });
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
        limitBytesTotal: 5_000,
        uptime: "1h",
        status: "exhausted"
      }],
      []
    );

    expect(report.updates[0]).toMatchObject({
      completedAt: expect.any(String),
      downloadedBytes: 4_000,
      status: "consommé",
      uploadedBytes: 1_000
    });
  });

  it("distingue disponible, activé, expiré et archivé à partir de RouterOS", () => {
    const available = compareLocalAndRouterTickets(
      [localTickets[0]],
      [routerUsers[0]],
      []
    );
    expect(available.updates[0]?.status).toBe("disponible");

    const activated = compareLocalAndRouterTickets(
      [localTickets[0]],
      [{ ...routerUsers[0], uptime: "5m" }],
      []
    );
    expect(activated.updates[0]?.status).toBe("activé");

    const expired = compareLocalAndRouterTickets(
      [localTickets[0]],
      [{ ...routerUsers[0], comment: "TicketPro:v1;validity=60;expires=1;state=expired;", status: "expired" }],
      []
    );
    expect(expired.updates[0]).toMatchObject({ status: "expiré", archivedAt: undefined });

    const archived = compareLocalAndRouterTickets(
      [{ ...localTickets[0], status: "expiré", archivedAt: "2026-08-01T10:00:00.000Z" }],
      [],
      []
    );
    expect(archived.updates[0]).toMatchObject({
      archivedAt: "2026-08-01T10:00:00.000Z",
      status: "archivé",
      syncStatus: "router_synced"
    });
    expect(archived.summary.routerMissing).toBe(0);
  });

  it("archive localement un voucher supprimé automatiquement après son expiration", () => {
    const report = compareLocalAndRouterTickets(
      [{
        ...localTickets[0],
        activatedAt: "2026-08-01T10:00:00.000Z",
        expiresAt: "2026-08-01T11:00:00.000Z",
        planValidityMinutes: 60,
        status: "activé"
      }],
      [],
      []
    );

    expect(report.updates[0]).toMatchObject({
      archivedAt: expect.any(String),
      completedAt: "2026-08-01T11:00:00.000Z",
      routerDeletedAt: expect.any(String),
      status: "archivé",
      syncStatus: "router_synced"
    });
    expect(report.logs[0]).toMatchObject({ level: "info" });
    expect(report.summary).toMatchObject({ routerMissing: 0, routerSynced: 1 });
  });

  it("refuse de confirmer la suppression si une session active résiduelle subsiste", () => {
    const report = compareLocalAndRouterTickets(
      [{
        ...localTickets[0],
        activatedAt: "2026-08-01T10:00:00.000Z",
        expiresAt: "2026-08-01T11:00:00.000Z",
        planValidityMinutes: 60,
        status: "expiré"
      }],
      [],
      [{ ...activeUsers[0], username: localTickets[0].code }]
    );

    expect(report.updates[0]).toMatchObject({ status: "expiré", syncStatus: "error" });
    expect(report.logs[0]).toMatchObject({ level: "error" });
  });

  it("ne recrée jamais un voucher terminal sans preuve de suppression à l'expiration", async () => {
    let createCalls = 0;
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => {
        createCalls += 1;
        return routerUsers[0];
      },
      listActiveUsers: async () => [],
      listHotspotUsers: async () => []
    });

    const report = await service.resyncTicket({ ...localTickets[0], status: "expiré" });

    expect(createCalls).toBe(0);
    expect(report.updates[0]).toMatchObject({ status: "expiré", syncStatus: "error" });
  });

  it("refuse une remise à zéro observée sur RouterOS", () => {
    const report = compareLocalAndRouterTickets(
      [{
        ...localTickets[0],
        activatedAt: "2026-08-27T10:00:00.000Z",
        completedAt: "2026-08-27T11:00:00.000Z",
        status: "consommé",
        uptimeSeconds: 3600
      }],
      [{ ...routerUsers[0], uptime: "0s", status: "available" }],
      []
    );

    expect(report.updates[0]).toMatchObject({
      status: "consommé",
      syncStatus: "conflict",
      uptimeSeconds: 3600
    });
    expect(report.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", ticketCode: "123456" })
    ]));
  });

  it("refuse de changer le profil d'un voucher déjà imprimé ou activé", async () => {
    const updateHotspotUser = vi.fn(async () => routerUsers[0]);
    const service = new RouterTicketSyncService({
      createHotspotUser: async () => routerUsers[0],
      listActiveUsers: async () => [],
      listHotspotUsers: async () => routerUsers,
      updateHotspotUser
    });

    for (const ticket of [
      { ...localTickets[0], planProfileName: "plan-local", printedCount: 1 },
      {
        ...localTickets[0],
        activatedAt: "2026-08-27T10:00:00.000Z",
        planProfileName: "plan-local",
        status: "activé"
      }
    ]) {
      const report = await service.resolveConflict(ticket);
      expect(report.updates[0]).toMatchObject({ status: ticket.status, syncStatus: "error" });
    }
    expect(updateHotspotUser).not.toHaveBeenCalled();
  });

  it("conserve l'etat metier quand le nettoyage RouterOS est en erreur", () => {
    const report = compareLocalAndRouterTickets(
      [{ ...localTickets[0], status: "consommÃ©", uptimeSeconds: 3600 }],
      [{
        ...routerUsers[0],
        comment: "TicketPro:v1;validity=180;expires=1;state=cleanup-error;",
        status: "error",
        uptime: "1h"
      }],
      []
    );

    expect(report.updates[0]).toMatchObject({
      status: "consommÃ©",
      syncStatus: "error",
      uptimeSeconds: 3600
    });
    expect(report.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", ticketCode: "123456" })
    ]));
  });
});
