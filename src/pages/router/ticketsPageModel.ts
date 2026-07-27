import type { AppStatus } from "../../shared/ui";
import type { AuthSession } from "../../domain/auth";
import type { HotspotPlanRecord, TicketRecord } from "../../domain/database";
import type { RouterTicketSyncStatus } from "../../services/sync";

export type TicketListStatus =
  | "activé"
  | "complété"
  | "disponible"
  | "erreur_sync"
  | "expiré"
  | "imprimé"
  | "supprimé";

export type TicketListItem = {
  accountId: string;
  activatedAt: string | null;
  batchId: string;
  code: string;
  completedAt: string | null;
  createdAt: string;
  dataLimitMb: number | null;
  downloadedBytes: number;
  expiresAt: string | null;
  generatedFileName: string | null;
  hasPdf: boolean;
  id: string;
  ipAddress: string | null;
  macAddress: string | null;
  mikrotikId: string | null;
  operatorProfile: string;
  passwordSecretRef: string;
  createdByProfileId: string;
  planDurationMinutes: number;
  planValidityMinutes: number;
  planId: string;
  planProfileName?: string;
  planName: string;
  printedCount: number;
  routerId: string;
  routerName: string;
  status: TicketListStatus;
  syncStatus: RouterTicketSyncStatus;
  uploadedBytes: number;
};

export type TicketLifecycleLog = {
  createdAt: string;
  id: string;
  level: "info" | "warning" | "error";
  message: string;
};

export function ticketFromRecord(
  record: TicketRecord,
  plan: HotspotPlanRecord | null,
  routerName: string,
  generatedFileName: string | null = null
): TicketListItem {
  return {
    accountId: record.account_id,
    activatedAt: record.activated_at,
    batchId: record.batch_id,
    code: record.username,
    completedAt: record.completed_at,
    createdAt: record.created_at,
    dataLimitMb: plan?.data_limit_mb ?? null,
    downloadedBytes: record.downloaded_bytes,
    expiresAt: record.expires_at,
    generatedFileName,
    hasPdf: Boolean(generatedFileName),
    id: record.id,
    ipAddress: record.ip_address,
    macAddress: record.mac_address,
    mikrotikId: record.mikrotik_id,
    operatorProfile: record.created_by_profile,
    passwordSecretRef: record.password_encrypted,
    createdByProfileId: record.created_by_profile_id,
    planDurationMinutes: plan?.duration_minutes ?? 0,
    planValidityMinutes: plan?.validity_minutes ?? plan?.duration_minutes ?? 0,
    planId: record.plan_id,
    planProfileName: plan?.mikrotik_profile_name ?? undefined,
    planName: plan?.name ?? "Plan supprimé",
    printedCount: record.printed_count,
    routerId: record.router_id,
    routerName,
    status: record.status as TicketListStatus,
    syncStatus: databaseSyncStatusToTicketSyncStatus(record.sync_status),
    uploadedBytes: record.uploaded_bytes
  };
}

export type TicketFilters = {
  batchId: string;
  code: string;
  dateFrom: string;
  dateTo: string;
  macAddress: string;
  operatorProfile: string;
  planId: string;
  routerId: string;
  status: "" | TicketListStatus;
};

export const emptyTicketFilters: TicketFilters = {
  batchId: "",
  code: "",
  dateFrom: "",
  dateTo: "",
  macAddress: "",
  operatorProfile: "",
  planId: "",
  routerId: "",
  status: ""
};

export const ticketPageSize = 25;

export function filterTickets(tickets: TicketListItem[], filters: TicketFilters): TicketListItem[] {
  const code = normalizeSearch(filters.code);
  const mac = normalizeSearch(filters.macAddress);
  const from = filters.dateFrom ? startOfDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDay(filters.dateTo) : null;

  return tickets.filter((ticket) => {
    if (ticket.status === "supprimé" && filters.status !== "supprimé") return false;

    const createdAt = new Date(ticket.createdAt).getTime();
    if (from !== null && createdAt < from) return false;
    if (to !== null && createdAt > to) return false;
    if (filters.planId && ticket.planId !== filters.planId) return false;
    if (filters.operatorProfile && ticket.operatorProfile !== filters.operatorProfile) return false;
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.batchId && ticket.batchId !== filters.batchId) return false;
    if (filters.routerId && ticket.routerId !== filters.routerId) return false;
    if (code && !normalizeSearch(ticket.code).includes(code)) return false;
    if (mac && !normalizeSearch(ticket.macAddress ?? "").includes(mac)) return false;
    return true;
  });
}

export function scopeTicketsForSession(tickets: TicketListItem[], session: AuthSession | null | undefined): TicketListItem[] {
  if (!session) return [];
  const accountTickets = tickets.filter((ticket) => ticket.accountId === session.account_id);
  if (session.permissions.includes("router.tickets.read")) return accountTickets;
  if (session.permissions.includes("router.tickets.own")) {
    return accountTickets.filter((ticket) => ticket.createdByProfileId === session.internal_profile_id);
  }
  return [];
}

export function paginateTickets(tickets: TicketListItem[], page: number, pageSize = ticketPageSize): TicketListItem[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return tickets.slice(start, start + pageSize);
}

export function getPageCount(totalItems: number, pageSize = ticketPageSize): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function canDeleteTicket(ticket: TicketListItem): boolean {
  return ticket.status === "disponible" && !ticket.activatedAt && ticket.printedCount === 0;
}

export function buildTicketLifecycleLogs(ticket: TicketListItem): TicketLifecycleLog[] {
  const logs: TicketLifecycleLog[] = [
    {
      createdAt: ticket.createdAt,
      id: `${ticket.id}-created`,
      level: "info",
      message: `Ticket créé dans le lot ${ticket.batchId}.`
    }
  ];

  if (ticket.printedCount > 0) {
    logs.push({
      createdAt: ticket.createdAt,
      id: `${ticket.id}-printed`,
      level: "info",
      message: `${ticket.printedCount} impression${ticket.printedCount > 1 ? "s" : ""} enregistrée${ticket.printedCount > 1 ? "s" : ""}.`
    });
  }

  if (ticket.activatedAt) {
    logs.push({
      createdAt: ticket.activatedAt,
      id: `${ticket.id}-activated`,
      level: "info",
      message: "Ticket activé par un client."
    });
  }

  if (ticket.completedAt) {
    logs.push({
      createdAt: ticket.completedAt,
      id: `${ticket.id}-completed`,
      level: "info",
      message: "Session complétée."
    });
  }

  if (ticket.expiresAt && ticket.status === "expiré") {
    logs.push({
      createdAt: ticket.expiresAt,
      id: `${ticket.id}-expired`,
      level: "warning",
      message: "Ticket expiré."
    });
  }

  if (ticket.status === "supprimé") {
    logs.push({
      createdAt: ticket.createdAt,
      id: `${ticket.id}-deleted`,
      level: "warning",
      message: "Ticket supprimé de RouterOS et masqué de la liste active."
    });
  }

  if (ticket.status === "erreur_sync") {
    logs.push({
      createdAt: ticket.createdAt,
      id: `${ticket.id}-sync-error`,
      level: "error",
      message: "Synchronisation à reprendre."
    });
  }

  if (ticket.generatedFileName) {
    logs.push({
      createdAt: ticket.createdAt,
      id: `${ticket.id}-file`,
      level: "info",
      message: `Fichier lié : ${ticket.generatedFileName}.`
    });
  }

  return logs;
}

export function ticketStatusLabel(status: TicketListStatus): string {
  const labels: Record<TicketListStatus, string> = {
    activé: "Activé",
    complété: "Complété",
    disponible: "Disponible",
    erreur_sync: "Erreur sync",
    expiré: "Expiré",
    imprimé: "Imprimé",
    supprimé: "Supprimé"
  };
  return labels[status];
}

export function ticketStatusToBadge(status: TicketListStatus): AppStatus {
  if (status === "erreur_sync") return "error";
  if (status === "activé") return "active";
  if (status === "imprimé") return "warning";
  if (status === "disponible" || status === "complété") return "success";
  return "offline";
}

export function formatBytes(value: number): string {
  if (value <= 0) return "0 octet";
  if (value < 1024) return `${value} octets`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

export function formatDataLimit(value: number | null): string {
  return value === null ? "Illimité" : `${value} Mo`;
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "Non définie";
  if (minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Non disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

function databaseSyncStatusToTicketSyncStatus(status: TicketRecord["sync_status"]): RouterTicketSyncStatus {
  if (status === "synced") return "router_synced";
  if (status === "conflict") return "conflict";
  if (status === "pending") return "error";
  return "local_only";
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function startOfDay(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function endOfDay(value: string): number {
  return new Date(`${value}T23:59:59.999`).getTime();
}
