import type { CreateTicketInput } from "../../domain/database";
import type {
  TicketBatchRepository,
  TicketRepository,
  TicketStateHistoryRepository
} from "../../services/database";
import type {
  RouterTicketSyncStatus,
  SyncedTicketUpdate,
  TicketSyncReport
} from "../../services/sync";
import { ticketLifecyclePhase } from "../../services/tickets";
import type { TicketListItem, TicketListStatus } from "./ticketsPageModel";
import { forEachCooperative } from "./cooperativeWork";

export function hasTicketDataChanges(previous: TicketListItem, next: TicketListItem): boolean {
  const before = ticketToCreateInput(previous);
  const after = ticketToCreateInput(next);
  return (Object.keys(after) as Array<keyof CreateTicketInput>).some(key =>
    key !== "last_router_sync_at" && before[key] !== after[key]
  );
}

export type PersistTicketSyncReportInput = {
  actorProfileId: string;
  batchRepository: TicketBatchRepository;
  report: TicketSyncReport;
  ticketHistoryRepository: TicketStateHistoryRepository;
  ticketRepository: TicketRepository;
  tickets: TicketListItem[];
};

export async function persistTicketSyncReport({
  actorProfileId,
  batchRepository,
  report,
  ticketHistoryRepository,
  ticketRepository,
  tickets
}: PersistTicketSyncReportInput): Promise<TicketListItem[]> {
  const updates = new Map(report.updates.map((update) => [update.id, update]));
  const nextTickets = tickets.map((ticket) => mergeTicketUpdate(ticket, updates.get(ticket.id)));
  const previousById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const observedTickets = nextTickets.filter(ticket => updates.has(ticket.id));
  const changedTickets = observedTickets.filter(ticket => hasTicketDataChanges(previousById.get(ticket.id)!, ticket));

  await forEachCooperative(changedTickets, ticket => ticketRepository.update(ticketToCreateInput(ticket)));
  await ticketRepository.saveRouterObservations(observedTickets.map(ticket => ({
    id: ticket.id, accountId: ticket.accountId, routerId: ticket.routerId,
    status: ticket.syncStatus, observedAt: ticket.routerObservationAt!
  })));

  await forEachCooperative(changedTickets, async (nextTicket) => {
      const previous = previousById.get(nextTicket.id);
      if (!previous || previous.status === nextTicket.status) return;
      for (const transition of ticketHistoryTransitions(previous, nextTicket)) {
        await ticketHistoryRepository.record({
          account_id: nextTicket.accountId,
          created_by_profile_id: actorProfileId,
          message: transition.message,
          next_status: transition.nextStatus,
          previous_status: transition.previousStatus,
          router_id: nextTicket.routerId,
          source: transition.source,
          ticket_id: nextTicket.id
        });
      }
    });

  // Reconcile aggregate state even after a previous attempt saved tickets but
  // failed before updating the batch. This is one read per batch, not per ticket.
  const affectedBatchIds = Array.from(new Set(observedTickets.map((ticket) => ticket.batchId)));
  await forEachCooperative(affectedBatchIds, async (batchId) => {
      const batchTickets = await ticketRepository.listByBatch(batchId);
      const accountId = batchTickets[0]?.account_id;
      if (!accountId) return;
      const allSynced = batchTickets.every((ticket) => ticket.sync_status === "synced");
      const hasConflict = batchTickets.some((ticket) => ticket.sync_status === "conflict");
      await batchRepository.updateState(
        batchId,
        accountId,
        allSynced ? "terminé" : "partiel",
        allSynced ? "synced" : hasConflict ? "conflict" : "pending"
      );
    });

  return nextTickets;
}

export function ticketHistoryTransitions(
  previous: TicketListItem,
  next: TicketListItem
): Array<{
  message: string;
  nextStatus: string;
  previousStatus: string;
  source: string;
}> {
  if (previous.status === next.status) return [];
  if (next.status !== "archivé" || !next.routerDeletedAt || !next.archivedAt) {
    return [{
      message: `${previous.status} → ${next.status} après lecture RouterOS.`,
      nextStatus: next.status,
      previousStatus: previous.status,
      source: "router_sync"
    }];
  }

  const transitions: ReturnType<typeof ticketHistoryTransitions> = [];
  let current = previous.status;
  const previousPhase = ticketLifecyclePhase(previous.status);
  if (previousPhase !== "exhausted" && previousPhase !== "expired") {
    transitions.push({
      message: "La validité calendaire du voucher est arrivée à son terme.",
      nextStatus: "expiré",
      previousStatus: current,
      source: "router_lifecycle"
    });
    current = "expiré";
  }
  transitions.push({
    message: "La suppression physique du compte Hotspot a été confirmée sur RouterOS.",
    nextStatus: "supprimé_routeur",
    previousStatus: current,
    source: "router_lifecycle"
  });
  transitions.push({
    message: "Le dernier snapshot connu est conservé dans les archives TicketPro.",
    nextStatus: "archivé",
    previousStatus: "supprimé_routeur",
    source: "router_lifecycle"
  });
  return transitions;
}

export function mergeTicketUpdate(
  ticket: TicketListItem,
  update?: SyncedTicketUpdate
): TicketListItem {
  if (!update) return ticket;
  const status = (update.status as TicketListStatus | undefined) ?? ticket.status;
  return {
    ...ticket,
    activatedAt: update.activatedAt === undefined ? ticket.activatedAt : update.activatedAt,
    archivedAt: update.archivedAt === undefined ? ticket.archivedAt : update.archivedAt,
    completedAt: update.completedAt === undefined ? ticket.completedAt : update.completedAt,
    dataRemainingBytes:
      update.dataRemainingBytes === undefined ? ticket.dataRemainingBytes : update.dataRemainingBytes,
    deletedAt:
      status === "supprimé"
        ? ticket.deletedAt ?? update.routerDeletedAt ?? new Date().toISOString()
        : ticket.deletedAt,
    downloadedBytes: update.downloadedBytes ?? ticket.downloadedBytes,
    expiresAt: update.expiresAt === undefined ? ticket.expiresAt : update.expiresAt,
    ipAddress: update.ipAddress === undefined ? ticket.ipAddress : update.ipAddress,
    lastRouterSyncAt:
      update.lastRouterSyncAt === undefined ? ticket.lastRouterSyncAt : update.lastRouterSyncAt,
    macAddress: update.macAddress === undefined ? ticket.macAddress : update.macAddress,
    mikrotikId: update.mikrotikId === undefined ? ticket.mikrotikId : update.mikrotikId,
    profileName: update.profileName ?? ticket.profileName,
    remainingSeconds:
      update.remainingSeconds === undefined ? ticket.remainingSeconds : update.remainingSeconds,
    routerDeletedAt:
      update.routerDeletedAt === undefined ? ticket.routerDeletedAt : update.routerDeletedAt,
    serverName: update.serverName ?? ticket.serverName,
    status,
    syncStatus: update.syncStatus,
    routerObservationAt: update.lastRouterSyncAt ?? new Date().toISOString(),
    uploadedBytes: update.uploadedBytes ?? ticket.uploadedBytes,
    uptimeSeconds: update.uptimeSeconds ?? ticket.uptimeSeconds
  };
}

export function ticketToCreateInput(ticket: TicketListItem): CreateTicketInput {
  return {
    account_id: ticket.accountId,
    activated_at: ticket.activatedAt,
    archived_at: ticket.archivedAt,
    batch_id: ticket.batchId,
    completed_at: ticket.completedAt,
    created_by_profile: ticket.operatorProfile as CreateTicketInput["created_by_profile"],
    created_by_profile_id: ticket.createdByProfileId,
    data_limit_mb_snapshot: ticket.dataLimitMb,
    data_remaining_bytes: ticket.dataRemainingBytes,
    deleted_at:
      ticket.status === "supprimé"
        ? ticket.deletedAt ?? ticket.routerDeletedAt ?? new Date().toISOString()
        : null,
    downloaded_bytes: ticket.downloadedBytes,
    download_limit_snapshot: ticket.planDownloadLimit ?? null,
    duration_minutes_snapshot: ticket.planDurationMinutes,
    expires_at: ticket.expiresAt,
    exported_at: ticket.exportedAt,
    hotspot_server_name: ticket.serverName,
    id: ticket.id,
    ip_address: ticket.ipAddress,
    last_router_sync_at: ticket.lastRouterSyncAt,
    mac_address: ticket.macAddress,
    mikrotik_id: ticket.mikrotikId,
    mikrotik_profile_name: ticket.profileName,
    password_encrypted: ticket.passwordSecretRef,
    plan_id: ticket.planId,
    printed_count: ticket.printedCount,
    remaining_seconds: ticket.remainingSeconds,
    router_deleted_at: ticket.routerDeletedAt,
    router_id: ticket.routerId,
    status: ticket.status,
    shared_users_snapshot: ticket.planSharedUsers ?? null,
    sync_status: ticketSyncStatusToDatabase(ticket.syncStatus),
    uploaded_bytes: ticket.uploadedBytes,
    upload_limit_snapshot: ticket.planUploadLimit ?? null,
    uptime_seconds: ticket.uptimeSeconds,
    validity_minutes_snapshot: ticket.planValidityMinutes,
    username: ticket.code
  };
}

export function ticketSyncStatusToDatabase(
  status: RouterTicketSyncStatus
): "conflict" | "local" | "pending" | "synced" {
  if (status === "router_synced") return "synced";
  if (status === "conflict" || status === "local_missing") return "conflict";
  if (status === "error" || status === "router_missing") return "pending";
  return "local";
}
