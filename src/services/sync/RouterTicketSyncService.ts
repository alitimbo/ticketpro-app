import type { ActiveHotspotUser, HotspotUser, HotspotUserDraft } from "../../domain/router";
import { RouterServiceError, type RouterService } from "../router";
import { dataLimitMbToBytes, voucherQuotaMatches } from "../tickets/VoucherQuota";
import {
  canApplyPlanChangeToVoucher,
  resolveObservedTicketStatus
} from "../tickets/TicketLifecyclePolicy";

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
  planDurationMinutes?: number;
  dataLimitMb?: number | null;
  planProfileName?: string;
  planValidityMinutes?: number;
  serverName?: string;
  routerId: string;
  status: string;
  syncStatus: RouterTicketSyncStatus;
  completedAt?: string | null;
  downloadedBytes?: number;
  uploadedBytes?: number;
  expiresAt?: string | null;
  uptimeSeconds?: number;
  remainingSeconds?: number | null;
  dataRemainingBytes?: number | null;
  lastRouterSyncAt?: string | null;
  routerDeletedAt?: string | null;
  archivedAt?: string | null;
  exportedAt?: string | null;
  printedCount?: number;
};

export type SyncedTicketUpdate = {
  activatedAt?: string | null;
  completedAt?: string | null;
  downloadedBytes?: number;
  id: string;
  ipAddress?: string | null;
  macAddress?: string | null;
  mikrotikId?: string | null;
  status?: string;
  syncStatus: RouterTicketSyncStatus;
  uploadedBytes?: number;
  expiresAt?: string | null;
  uptimeSeconds?: number;
  remainingSeconds?: number | null;
  dataRemainingBytes?: number | null;
  lastRouterSyncAt?: string | null;
  routerDeletedAt?: string | null;
  serverName?: string;
  profileName?: string;
  archivedAt?: string | null;
};

export type RouterOnlyTicket = {
  code: string;
  mikrotikId: string;
  passwordSecretRef: string;
  planId: string;
  profileName: string;
  syncStatus: "local_missing";
  serverName: string;
};

export type TicketSyncReport = {
  localMissing: RouterOnlyTicket[];
  logs: TicketSyncLog[];
  remoteBatchExtrasDiscovered?: number;
  remoteBatchExtrasRemoved?: number;
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
      Partial<Pick<RouterService, "removeHotspotUser" | "removeHotspotUsersBatch" | "updateHotspotUser">>
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

    if (!canSafelyRecreateTicket(ticket)) {
      const updates = report.updates.map((item) =>
        item.id === ticket.id ? { ...item, status: ticket.status, syncStatus: "error" as const } : item
      );
      return {
        ...report,
        logs: [{
          level: "error",
          message: "Ce ticket a déjà été utilisé ou activé. TicketPro refuse de le recréer pour ne pas réinitialiser ses compteurs.",
          ticketCode: ticket.code
        }, ...report.logs],
        summary: buildSummary(updates, report.localMissing),
        updates
      };
    }

    try {
      const created = await this.routerService.createHotspotUser(localTicketToDraft(ticket));
      const updates = report.updates.map((item) =>
        item.id === ticket.id
          ? {
              ...item,
              mikrotikId: created.id,
              routerDeletedAt: null,
              status: ticket.status,
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
        item.id === ticket.id ? { ...item, status: ticket.status, syncStatus: "error" as const } : item
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
        updates: [{ id: ticket.id, status: ticket.status, syncStatus: "error" }]
      };
    }

    if (!canSafelyChangeTicketPlan(ticket)) {
      return {
        localMissing: [],
        logs: [{
          level: "error",
          message: "Le plan d'un voucher déjà émis ou utilisé est immuable. La correction doit porter sur les futurs vouchers.",
          ticketCode: ticket.code
        }],
        summary: buildSummary([{ id: ticket.id, status: ticket.status, syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: ticket.status, syncStatus: "error" }]
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
        summary: buildSummary([{ id: ticket.id, status: ticket.status, syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: ticket.status, syncStatus: "error" }]
      };
    }
  }

  async removeTicket(ticket: SyncableLocalTicket): Promise<TicketSyncReport> {
    if (!this.routerService.removeHotspotUser) {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "La suppression distante n'est pas disponible.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: ticket.status, syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: ticket.status, syncStatus: "error" }]
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
    } catch (error) {
      if (error instanceof RouterServiceError && error.code === "hotspot_not_found") {
        return {
          localMissing: [],
          logs: [{ level: "warning", message: "Le ticket était déjà absent du routeur.", ticketCode: ticket.code }],
          summary: buildSummary([{ id: ticket.id, status: "supprimé", syncStatus: "router_synced" }], []),
          updates: [{ id: ticket.id, status: "supprimé", syncStatus: "router_synced" }]
        };
      }
      return {
        localMissing: [],
        logs: [{ level: "error", message: "Suppression impossible sur le routeur.", ticketCode: ticket.code }],
        summary: buildSummary([{ id: ticket.id, status: ticket.status, syncStatus: "error" }], []),
        updates: [{ id: ticket.id, status: ticket.status, syncStatus: "error" }]
      };
    }
  }

  async removeBatch(
    localTickets: SyncableLocalTicket[],
    batchId: string,
    onProgress?: Parameters<RouterService["removeHotspotUsersBatch"]>[2]
  ): Promise<TicketSyncReport> {
    const batchTickets = localTickets.filter((ticket) => ticket.batchId === batchId);
    if (batchTickets.length === 0) {
      return {
        localMissing: [],
        logs: [{ level: "error", message: "Aucun voucher local ne correspond à ce lot." }],
        summary: buildSummary([], []),
        updates: []
      };
    }

    const updates: SyncedTicketUpdate[] = [];
    const logs: TicketSyncLog[] = [];
    let remoteBatchExtrasDiscovered = 0;
    let remoteBatchExtrasRemoved = 0;
    if (this.routerService.removeHotspotUsersBatch) {
      try {
        const usernames = batchTickets.map((ticket) => ticket.code);
        const removalResults = onProgress
          ? await this.routerService.removeHotspotUsersBatch(usernames, batchId, onProgress)
          : await this.routerService.removeHotspotUsersBatch(usernames, batchId);
        const resultByUsername = new Map(removalResults.map((result) => [result.username, result]));
        const localUsernames = new Set(batchTickets.map((ticket) => ticket.code));
        const remoteExtras = removalResults.filter((result) => !localUsernames.has(result.username));
        remoteBatchExtrasDiscovered = remoteExtras.length;
        remoteBatchExtrasRemoved = remoteExtras.filter((result) => result.status === "removed").length;
        for (const result of remoteExtras) {
          logs.push({
            level: result.status === "removed" ? "warning" : "error",
            message: result.status === "removed"
              ? "Voucher orphelin du lot confirmé absent du routeur."
              : `Suppression du voucher orphelin impossible${result.message ? ` : ${result.message.slice(0, 180)}` : "."}`,
            ticketCode: result.username
          });
        }
        for (const ticket of batchTickets) {
          const result = resultByUsername.get(ticket.code);
          const removed = result?.status === "removed";
          updates.push({
            id: ticket.id,
            status: removed ? "supprimé" : ticket.status,
            syncStatus: removed ? "router_synced" : "error"
          });
          logs.push({
            level: removed ? "info" : "error",
            message: removed
              ? "Ticket confirmé absent du routeur."
              : `Suppression impossible sur le routeur${result?.message ? ` : ${result.message.slice(0, 180)}` : "."}`,
            ticketCode: ticket.code
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 180) : "routeur inaccessible";
        for (const ticket of batchTickets) {
          updates.push({ id: ticket.id, status: ticket.status, syncStatus: "error" });
          logs.push({
            level: "error",
            message: `Suppression du lot interrompue : ${detail}`,
            ticketCode: ticket.code
          });
        }
      }
    } else {
      for (const ticket of batchTickets) {
        const report = await this.removeTicket(ticket);
        updates.push(...report.updates);
        logs.push(...report.logs);
      }
    }
    const localErrorCount = updates.filter((update) => update.syncStatus === "error").length;
    const errorCount = logs.filter((log) => log.level === "error").length;
    const confirmedCount = updates.length - localErrorCount + remoteBatchExtrasRemoved;
    const expectedCount = updates.length + remoteBatchExtrasDiscovered;
    logs.unshift({
      level: errorCount > 0 ? "error" : "info",
      message: errorCount > 0
        ? `Suppression partielle : ${confirmedCount}/${expectedCount} voucher(s) confirmés absents de RouterOS.`
        : `${confirmedCount} voucher(s) du lot confirmés absents de RouterOS.`
    });
    return {
      localMissing: [],
      logs,
      remoteBatchExtrasDiscovered,
      remoteBatchExtrasRemoved,
      summary: buildSummary(updates, []),
      updates
    };
  }

  private async resyncMany(localTickets: SyncableLocalTicket[]): Promise<TicketSyncReport> {
    const initialReport = await this.compareTickets(localTickets);
    const missingTickets = localTickets.filter((ticket) =>
      initialReport.updates.some((update) => update.id === ticket.id && update.syncStatus === "router_missing")
    );
    const updates = [...initialReport.updates];
    const logs = [...initialReport.logs];

    for (const ticket of missingTickets) {
      if (!canSafelyRecreateTicket(ticket)) {
        const index = updates.findIndex((update) => update.id === ticket.id);
        if (index >= 0) {
          updates[index] = { ...updates[index], status: ticket.status, syncStatus: "error" };
        }
        logs.unshift({
          level: "error",
          message: "Réparation refusée : un ticket déjà activé ne peut jamais être recréé avec des compteurs remis à zéro.",
          ticketCode: ticket.code
        });
        continue;
      }
      try {
        const created = await this.routerService.createHotspotUser(localTicketToDraft(ticket));
        const index = updates.findIndex((update) => update.id === ticket.id);

        if (index >= 0) {
          updates[index] = {
            ...updates[index],
            mikrotikId: created.id,
            routerDeletedAt: null,
            status: ticket.status,
            syncStatus: "router_synced"
          };
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
          updates[index] = { ...updates[index], status: ticket.status, syncStatus: "error" };
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
      const synchronizedAt = new Date().toISOString();
      const manuallyDeleted = ticket.status === "supprimé";
      const residualSession = Boolean(activeUser);
      const automaticallyCleaned = !residualSession
        && isExpectedRouterCleanup(ticket, Date.parse(synchronizedAt));
      updates.push({
        activatedAt: ticket.activatedAt ?? inferActivationAt(ticket.expiresAt ?? null, ticket.planValidityMinutes),
        archivedAt: automaticallyCleaned ? ticket.archivedAt ?? synchronizedAt : ticket.archivedAt,
        completedAt: automaticallyCleaned
          ? ticket.completedAt ?? ticket.expiresAt ?? synchronizedAt
          : ticket.completedAt,
        id: ticket.id,
        lastRouterSyncAt: synchronizedAt,
        routerDeletedAt: (manuallyDeleted && !residualSession) || automaticallyCleaned
          ? ticket.routerDeletedAt ?? synchronizedAt
          : ticket.routerDeletedAt,
        status: manuallyDeleted ? "supprimé" : automaticallyCleaned ? "archivé" : ticket.status,
        syncStatus: residualSession ? "error" : manuallyDeleted || automaticallyCleaned ? "router_synced" : "router_missing"
      });
      logs.push({
        level: manuallyDeleted || automaticallyCleaned ? "info" : "error",
        message: residualSession
          ? "Le compte Hotspot est absent mais une session réseau résiduelle existe encore. Suppression non confirmée."
          : manuallyDeleted
          ? "Suppression du voucher confirmée sur RouterOS."
          : automaticallyCleaned
          ? "Voucher arrivé en fin de vie, supprimé de RouterOS et conservé dans les archives TicketPro."
          : "Ticket absent de RouterOS avant la fin de sa validité. Aucune recréation automatique n'est autorisée.",
        ticketCode: ticket.code
      });
      return;
    }

    const hasConflict = ticket.planProfileName
      ? ticket.planProfileName !== routerUser.profileName
      : Boolean(ticket.planId && routerUser.planId && ticket.planId !== routerUser.planId);

    const hasQuotaConflict = ticket.dataLimitMb !== undefined
      && !voucherQuotaMatches(routerUser, dataLimitMbToBytes(ticket.dataLimitMb));
    const usage = deriveTicketRuntime(routerUser, activeUser);
    const lifecycle = resolveObservedTicketStatus(ticket.status, usage.status);
    const routerLifecycleError = routerUser.status === "error";
    updates.push({
      archivedAt: ticket.archivedAt,
      activatedAt:
        activeUser || routerOsDurationHasElapsed(routerUser.uptime) || usage.expiresAt
          ? ticket.activatedAt ?? inferActivationAt(usage.expiresAt, ticket.planValidityMinutes) ?? new Date().toISOString()
          : ticket.activatedAt,
      completedAt:
        usage.status === "consommé" || usage.status === "expiré"
          ? ticket.completedAt ?? new Date().toISOString()
          : ticket.completedAt,
      downloadedBytes: Math.max(
        ticket.downloadedBytes ?? 0,
        routerUser.downloadedBytes ?? 0,
        activeUser?.downloadedBytes ?? 0
      ),
      id: ticket.id,
      dataRemainingBytes: minimumKnownRemaining(
        ticket.dataRemainingBytes,
        usage.dataRemainingBytes
      ),
      expiresAt: usage.expiresAt ?? ticket.expiresAt,
      ipAddress: activeUser?.ipAddress ?? ticket.ipAddress,
      macAddress: activeUser?.macAddress ?? ticket.macAddress,
      mikrotikId: routerUser.id,
      profileName: routerUser.profileName,
      remainingSeconds: minimumKnownRemaining(
        ticket.remainingSeconds,
        usage.remainingSeconds
      ),
      serverName: routerUser.serverName ?? "all",
      status: lifecycle.status,
      syncStatus: routerLifecycleError
        ? "error"
        : hasConflict || hasQuotaConflict || lifecycle.regression
          ? "conflict"
          : "router_synced",
      lastRouterSyncAt: new Date().toISOString(),
      routerDeletedAt: null,
      uptimeSeconds: Math.max(ticket.uptimeSeconds ?? 0, usage.uptimeSeconds),
      uploadedBytes: Math.max(
        ticket.uploadedBytes ?? 0,
        routerUser.uploadedBytes ?? 0,
        activeUser?.uploadedBytes ?? 0
      )
    });

    if (hasQuotaConflict) {
      logs.push({
        level: "error",
        message: "Le quota RouterOS ne correspond pas au volume fixé à la création du ticket. Synchronisation non confirmée.",
        ticketCode: ticket.code
      });
    }
    if (hasConflict) {
      logs.push({
        level: "warning",
        message: "Conflit détecté entre le plan local et le routeur.",
        ticketCode: ticket.code
      });
    }
    if (lifecycle.regression) {
      logs.push({
        level: "error",
        message: "Régression RouterOS refusée : le voucher local reste dans son état le plus avancé et ne sera jamais recréé.",
        ticketCode: ticket.code
      });
    }
    if (routerLifecycleError) {
      logs.push({
        level: "error",
        message: "Le nettoyage RouterOS du voucher a échoué. Son état commercial est conservé et aucune suppression n'est confirmée.",
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
      serverName: user.serverName ?? "all",
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

function routerOsDurationHasElapsed(value: string | null | undefined): boolean {
  return routerOsDurationToSeconds(value) > 0;
}

function isExpectedRouterCleanup(ticket: SyncableLocalTicket, nowMs: number): boolean {
  if (ticket.status === "archivé" || Boolean(ticket.archivedAt)) {
    return true;
  }

  const expiresAtMs = ticket.expiresAt ? Date.parse(ticket.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return true;
  }

  const activatedAtMs = ticket.activatedAt ? Date.parse(ticket.activatedAt) : Number.NaN;
  if (
    Number.isFinite(activatedAtMs)
    && Boolean(ticket.planValidityMinutes && ticket.planValidityMinutes > 0)
    && activatedAtMs + (ticket.planValidityMinutes ?? 0) * 60_000 <= nowMs
  ) {
    return true;
  }

  return false;
}

function deriveTicketRuntime(user: HotspotUser, active: ActiveHotspotUser | undefined): {
  dataRemainingBytes: number | null;
  expiresAt: string | null;
  remainingSeconds: number | null;
  status: string;
  uptimeSeconds: number;
} {
  const uptimeSeconds = Math.max(
    routerOsDurationToSeconds(user.uptime),
    routerOsDurationToSeconds(active?.uptime)
  );
  const limitSeconds = routerOsDurationToSeconds(user.limitUptime);
  const usedBytes = Math.max(
    (user.downloadedBytes ?? 0) + (user.uploadedBytes ?? 0),
    (active?.downloadedBytes ?? 0) + (active?.uploadedBytes ?? 0)
  );
  const dataLimit = user.limitBytesTotal ?? 0;
  const quotaConsumed = dataLimit > 0 && usedBytes >= dataLimit;
  const timeConsumed = limitSeconds > 0 && uptimeSeconds >= limitSeconds;
  const lifecycleExpired = user.comment?.includes(";state=expired;") ?? false;
  const expiresAt = lifecycleExpirationIso(user.comment);
  const remainingSeconds = limitSeconds > 0 ? Math.max(0, limitSeconds - uptimeSeconds) : null;
  const dataRemainingBytes = dataLimit > 0 ? Math.max(0, dataLimit - usedBytes) : null;

  return {
    dataRemainingBytes,
    expiresAt,
    remainingSeconds,
    status: user.status === "error"
      ? "erreur_sync"
      : lifecycleExpired || user.status === "expired"
      ? "expiré"
      : quotaConsumed || timeConsumed || user.status === "exhausted"
        ? "consommé"
        : active
          ? "en_cours_utilisation"
          : user.status === "disabled"
            ? "désactivé"
              : uptimeSeconds > 0 ? "activé" : "disponible",
    uptimeSeconds
  };
}

function routerOsDurationToSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const clock = value.match(/^(?:(\d+)w)?(?:(\d+)d)?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (clock) {
    if (Number(clock[4]) >= 60 || Number(clock[5]) >= 60) return 0;
    return Number(clock[1] ?? 0) * 604800 + Number(clock[2] ?? 0) * 86400
      + Number(clock[3]) * 3600 + Number(clock[4]) * 60 + Number(clock[5]);
  }
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let seconds = 0;
  for (const match of value.matchAll(/(\d+)(w|d|h|m|s)/g)) {
    seconds += Number(match[1]) * units[match[2]];
  }
  return seconds;
}

function lifecycleExpirationIso(comment: string | null | undefined): string | null {
  const raw = comment?.match(/;expires=(\d+);/)?.[1];
  if (!raw || raw === "0") return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const milliseconds = numeric > 10_000_000_000_000 ? numeric / 1_000_000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferActivationAt(expiresAt: string | null, validityMinutes: number | undefined): string | null {
  if (!expiresAt || !validityMinutes || validityMinutes <= 0) return null;
  return new Date(Date.parse(expiresAt) - validityMinutes * 60_000).toISOString();
}

function minimumKnownRemaining(
  current: number | null | undefined,
  observed: number | null | undefined
): number | null {
  if (current === null || current === undefined) return observed ?? null;
  if (observed === null || observed === undefined) return current;
  return Math.min(current, observed);
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
    limitBytesTotal: dataLimitMbToBytes(ticket.dataLimitMb),
    limitUptime: minutesToRouterOsDuration(ticket.planDurationMinutes),
    passwordSecretRef: ticket.passwordSecretRef,
    planId: ticket.planProfileName ?? ticket.planId,
    serverName: ticket.serverName ?? "all",
    username: ticket.code,
    validityMinutes: ticket.planValidityMinutes ?? null
  };
}

export function canSafelyRecreateTicket(ticket: SyncableLocalTicket): boolean {
  const neverActivated = !ticket.activatedAt
    && !ticket.completedAt
    && !ticket.expiresAt
    && !ticket.mikrotikId
    && !ticket.lastRouterSyncAt
    && (ticket.uptimeSeconds ?? 0) === 0
    && (ticket.downloadedBytes ?? 0) === 0
    && (ticket.uploadedBytes ?? 0) === 0;
  return neverActivated
    && ["local_only", "error"].includes(ticket.syncStatus)
    && ["disponible", "imprimé"].includes(ticket.status);
}

export function canSafelyChangeTicketPlan(ticket: SyncableLocalTicket): boolean {
  return canApplyPlanChangeToVoucher({
    activated_at: ticket.activatedAt,
    completed_at: ticket.completedAt ?? null,
    downloaded_bytes: ticket.downloadedBytes ?? 0,
    expires_at: ticket.expiresAt ?? null,
    exported_at: ticket.exportedAt ?? null,
    printed_count: ticket.printedCount ?? 0,
    status: ticket.status,
    uploaded_bytes: ticket.uploadedBytes ?? 0,
    uptime_seconds: ticket.uptimeSeconds ?? 0
  });
}

function minutesToRouterOsDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const totalSeconds = Math.max(60, Math.round(minutes * 60));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", remainingMinutes > 0 ? `${remainingMinutes}m` : ""]
    .filter(Boolean)
    .join("") || "1m";
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
