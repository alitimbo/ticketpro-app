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
  constructor(private readonly routerService: Pick<RouterService, "createHotspotUser" | "listActiveUsers" | "listHotspotUsers">) {}

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

    const hasConflict = Boolean(ticket.planId && routerUser.planId && ticket.planId !== routerUser.planId);

    updates.push({
      activatedAt: activeUser ? ticket.activatedAt ?? new Date().toISOString() : ticket.activatedAt,
      id: ticket.id,
      ipAddress: activeUser?.ipAddress ?? ticket.ipAddress,
      macAddress: activeUser?.macAddress ?? ticket.macAddress,
      mikrotikId: routerUser.id,
      status: activeUser ? "activé" : ticket.status === "erreur_sync" ? "disponible" : ticket.status,
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
    planId: ticket.planId,
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
