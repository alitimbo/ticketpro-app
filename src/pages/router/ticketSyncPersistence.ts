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
import type { TicketListItem, TicketListStatus } from "./ticketsPageModel";

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
  const changedTickets = nextTickets.filter((ticket) => updates.has(ticket.id));

  await Promise.all(
    changedTickets.map((ticket) => ticketRepository.update(ticketToCreateInput(ticket)))
  );

  await Promise.all(
    changedTickets.flatMap((nextTicket) => {
      const previous = tickets.find((ticket) => ticket.id === nextTicket.id);
      if (!previous || previous.status === nextTicket.status) return [];
      return [
        ticketHistoryRepository.record({
          account_id: nextTicket.accountId,
          created_by_profile_id: actorProfileId,
          message: `${previous.status} → ${nextTicket.status} après lecture RouterOS.`,
          next_status: nextTicket.status,
          previous_status: previous.status,
          router_id: nextTicket.routerId,
          source: "router_sync",
          ticket_id: nextTicket.id
        })
      ];
    })
  );

  const affectedBatchIds = Array.from(new Set(changedTickets.map((ticket) => ticket.batchId)));
  await Promise.all(
    affectedBatchIds.map(async (batchId) => {
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
    })
  );

  return nextTickets;
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
    data_remaining_bytes: ticket.dataRemainingBytes,
    deleted_at:
      ticket.status === "supprimé"
        ? ticket.deletedAt ?? ticket.routerDeletedAt ?? new Date().toISOString()
        : null,
    downloaded_bytes: ticket.downloadedBytes,
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
    sync_status: ticketSyncStatusToDatabase(ticket.syncStatus),
    uploaded_bytes: ticket.uploadedBytes,
    uptime_seconds: ticket.uptimeSeconds,
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
