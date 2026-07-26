import type { ActiveHotspotUser, HotspotUser, HotspotUserDraft } from "../../domain/router";
import type { RouterService } from "../router";

export type RouterTicketSyncStatus =
  | "conflict"
  | "error"
  | "local_missing"
  | "local_only"
  | "router_missing"
  | "router_synced";

export type SyncableLocalTicket = {
  activatedAt: string | null;
  batchId: string;
  code: string;
  id: string;
  ipAddress: string | null;
  macAddress: string | null;
  mikrotikId: string | null;
  passwordSecretRef: string;
  planId: string;
  planProfileName?: string;
  routerId: string;
  status: string;
  syncStatus: RouterTicketSyncStatus;
};

export type SyncedTicketUpdate = {
  activatedAt?: string | null;
  id: string;
  ipAddress?: string | null;
  macAddress?: string | null;
  mikrotikId?: string | null;
  status?: string;
  syncStatus: RouterTicketSyncStatus;
};

export type RouterOnlyTicket = {
  code: string;
  mikrotikId: string;
  passwordSecretRef: string;
  planId: string;
  profileName: string;
  syncStatus: "local_missing";
};

export type TicketSyncReport = {
  localMissing: RouterOnlyTicket[];
  logs: TicketSyncLog[];
  summary: TicketSyncSummary;
  updates: SyncedTicketUpdate[];
};

export type TicketSyncLog = {
  level: "error" | "info" | "warning";
  message: string;
  ticketCode?: string;
};

export type TicketSyncSummary = {
  conflict: number;
  error: number;
  localMissing: number;
  localOnly: number;
  routerMissing: number;
  routerSynced: number;
  totalLocal: number;
};

export class RouterTicketSyncService {
  constructor(
    private readonly routerService: Pick<RouterService, "createHotspotUser" | "listActiveUsers" | "listHotspotUsers"> &
      Partial<Pick<RouterService, "removeHotspotUser" | "updateHotspotUser">>
  ) {}

  async compareTickets(localTickets: SyncableLocalTicket[]): Promise<TicketSyncReport> {
    const [routerUsers, activeUsers] = await Promise.all([
      this.routerService.listHotspotUsers(),
      this.routerService.listActiveUsers()
    ]);

    return compareLocalAndRouterTickets(localTickets, routerUsers, activeUsers);
  }

  async resyncTicket(ticket: SyncableLocalTicket): Promise<TicketSyncReport> {
    const report = await this.compareTickets([ticket]);
    const update = report.updates.find((item) => item.id === ticket.id);

    if (update?.syncStatus !== "router_missing") {
      return report;
    }

    try {
      const created = await this.routerService.createHotspotUser(localTicketToDraft(ticket));
      const updates = report.updates.map((item) =>
        item.id === ticket.id
          ? {
              ...item,
              mikrotikId: created.id,
              syncStatus: "router_synced" as const
            }
          : item
      );

      return {
        ...report,
        logs: [
          {
            level: "info",
            message: "Ticket recréé sur le routeur.",
            ticketCode: ticket.code
          },
          ...report.logs
        ],
        summary: buildSummary(updates, report.localMissing),
        updates
      };
    } catch {
      const reconciled = await this.reconcileAfterWriteFailure(ticket);

      if (reconciled) {
        return {
          ...reconciled,
          logs: [
            {
              level: "warning",
              message: "Le ticket était déjà présent après la reprise réseau.",
              ticketCode: ticket.code
            },
            ...reconciled.logs
          ]
        };
      }

      const updates = report.updates.map((item) =>
        item.id === ticket.id ? { ...item, status: "erreur_sync", syncStatus: "error" as const } : item
      );

      return {
        ...report,
        logs: [
          {
            level: "error",
            message: "Resynchronisation impossible. Le ticket reste en erreur.",
            ticketCode: ticket.code
          },
          ...report.logs
        ],
        summary: buildSummary(updates, report.localMissing),
        updates
      };
    }
  }

  async resyncBatch(localTickets: SyncableLocalTicket[], batchId: string): Promise<TicketSyncReport> {
    return this.resyncMany(localTickets.filter((ticket) => ticket.batchId === batchId));
  }

  async resyncRouter(localTickets: SyncableLocalTicket[]): Promise<TicketSyncReport> {
    return this.resyncMany(localTickets);
  }

  private async reconcileAfterWriteFailure(ticket: SyncableLocalTicket): Promise<TicketSyncReport | null> {
    try {
      const report = await this.compareTickets([ticket]);
      return report.updates.some((update) => update.id === ticket.id && update.syncStatus !== "router_missing")
        ? report
        : null;
    } catch {
      return null;
    }
  }

  async resolveConflict(ticket: SyncableLocalTicket): Promise<TicketSyncReport> {
    if (!ticket.planProfileName) {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "Le plan local n'a pas de profil MikroTik exploitable.", ticketCode: ticket.code }],
        summary: buildSummary([], []),
        updates: [{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }]
      };
    }

    try {
      if (!this.routerService.updateHotspotUser) {
        throw new Error("La mise à jour des tickets n'est pas disponible.");
      }
      await this.routerService.updateHotspotUser(ticket.code, ticket.planProfileName);
      return this.compareTickets([ticket]);
    } catch {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "Le conflit n'a pas pu être résolu sur le routeur.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }]
      };
    }
  }

  async removeTicket(ticket: SyncableLocalTicket): Promise<TicketSyncReport> {
    if (!this.routerService.removeHotspotUser) {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "La suppression distante n'est pas disponible.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }]
      };
    }

    try {
      await this.routerService.removeHotspotUser(ticket.code);
      return {
        localMissing: [],
        logs: [{ level: "info", message: "Ticket supprimé du routeur.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: "supprimé", syncStatus: "router_synced" }], []),
        updates: [{ id: ticket.id, status: "supprimé", syncStatus: "router_synced" }]
      };
    } catch {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "Suppression impossible sur le routeur.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: "erreur_sync", syncStatus: "error" }]
      };
    }
  }

  private async resyncMany(localTickets: SyncableLocalTicket[]): Promise<TicketSyncReport> {
    const initialReport = await this.compareTickets(localTickets);
    const missingTickets = localTickets.filter((ticket) =>
      initialReport.updates.some((update) => update.id === ticket.id && update.syncStatus === "router_missing")
    );
    const updates = [...initialReport.updates];
    const logs = [...initialReport.logs];

    for (const ticket of missingTickets) {
      try {
        const created = await this.routerService.createHotspotUser(localTicketToDraft(ticket));
        const index = updates.findIndex((update) => update.id === ticket.id);

        if (index >= 0) {
          updates[index] = { ...updates[index], mikrotikId: created.id, syncStatus: "router_synced" };
        }

        logs.unshift({ level: "info", message: "Ticket recréé sur le routeur.", ticketCode: ticket.code });
      } catch {
        const reconciled = await this.reconcileAfterWriteFailure(ticket);
        const reconciledUpdate = reconciled?.updates.find((update) => update.id === ticket.id);

        if (reconciledUpdate && reconciledUpdate.syncStatus !== "router_missing") {
          const reconciledIndex = updates.findIndex((update) => update.id === ticket.id);

          if (reconciledIndex >= 0) {
            updates[reconciledIndex] = reconciledUpdate;
          }

          logs.unshift({
            level: "warning",
            message: "Le ticket était déjà présent après la reprise réseau.",
            ticketCode: ticket.code
          });
          continue;
        }

        const index = updates.findIndex((update) => update.id === ticket.id);

        if (index >= 0) {
          updates[index] = { ...updates[index], status: "erreur_sync", syncStatus: "error" };
        }

        logs.unshift({ level: "error", message: "Resynchronisation impossible.", ticketCode: ticket.code });
      }
    }

    return {
      ...initialReport,
      logs,
      summary: buildSummary(updates, initialReport.localMissing),
      updates
    };
  }
}

export function compareLocalAndRouterTickets(
  localTickets: SyncableLocalTicket[],
  routerUsers: HotspotUser[],
  activeUsers: ActiveHotspotUser[]
): TicketSyncReport {
  const localByCode = new Map(localTickets.map((ticket) => [ticket.code, ticket]));
  const routerByCode = new Map(routerUsers.map((user) => [user.username, user]));
  const activeByCode = new Map(activeUsers.map((user) => [user.username, user]));
  const updates: SyncedTicketUpdate[] = [];
  const logs: TicketSyncLog[] = [];
  const localMissing: RouterOnlyTicket[] = [];

  localTickets.forEach((ticket) => {
    const routerUser = routerByCode.get(ticket.code);
    const activeUser = activeByCode.get(ticket.code);

    if (!routerUser) {
      updates.push({ id: ticket.id, status: "erreur_sync", syncStatus: "router_missing" });
      logs.push({
        level: "warning",
        message: "Ticket local absent du routeur.",
        ticketCode: ticket.code
      });
      return;
    }

    const hasConflict = ticket.planProfileName
      ? ticket.planProfileName !== routerUser.profileName
      : Boolean(ticket.planId && routerUser.planId && ticket.planId !== routerUser.planId);

    updates.push({
      activatedAt: activeUser ? ticket.activatedAt ?? new Date().toISOString() : ticket.activatedAt,
      id: ticket.id,
      ipAddress: activeUser?.ipAddress ?? ticket.ipAddress,
      macAddress: activeUser?.macAddress ?? ticket.macAddress,
      mikrotikId: routerUser.id,
      status:
        activeUser
          ? "activé"
          : routerUser.status === "disabled" || routerUser.status === "expired"
            ? "expiré"
            : ticket.status === "erreur_sync"
              ? "disponible"
              : ticket.status,
      syncStatus: hasConflict ? "conflict" : "router_synced"
    });

    if (hasConflict) {
      logs.push({
        level: "warning",
        message: "Conflit détecté entre le plan local et le routeur.",
        ticketCode: ticket.code
      });
    }
  });

  routerUsers.forEach((user) => {
    if (localByCode.has(user.username)) {
      return;
    }

    localMissing.push({
      code: user.username,
      mikrotikId: user.id,
      passwordSecretRef: user.passwordSecretRef,
      planId: user.planId,
      profileName: user.profileName,
      syncStatus: "local_missing"
    });
    logs.push({
      level: "warning",
      message: "Ticket présent sur le routeur mais absent localement.",
      ticketCode: user.username
    });
  });

  return {
    localMissing,
    logs,
    summary: buildSummary(updates, localMissing),
    updates
  };
}

export function syncStatusLabel(status: RouterTicketSyncStatus): string {
  const labels: Record<RouterTicketSyncStatus, string> = {
    conflict: "Conflit",
    error: "Erreur sync",
    local_missing: "Absent localement",
    local_only: "Local seulement",
    router_missing: "Absent routeur",
    router_synced: "Synchronisé"
  };

  return labels[status];
}

function localTicketToDraft(ticket: SyncableLocalTicket): HotspotUserDraft {
  return {
    comment: `Resynchronisation lot ${ticket.batchId}`,
    passwordSecretRef: ticket.passwordSecretRef,
    planId: ticket.planProfileName ?? ticket.planId,
    username: ticket.code
  };
}

function buildSummary(updates: SyncedTicketUpdate[], localMissing: RouterOnlyTicket[]): TicketSyncSummary {
  return {
    conflict: updates.filter((update) => update.syncStatus === "conflict").length,
    error: updates.filter((update) => update.syncStatus === "error").length,
    localMissing: localMissing.length,
    localOnly: updates.filter((update) => update.syncStatus === "local_only").length,
    routerMissing: updates.filter((update) => update.syncStatus === "router_missing").length,
    routerSynced: updates.filter((update) => update.syncStatus === "router_synced").length,
    totalLocal: updates.length
  };
}
