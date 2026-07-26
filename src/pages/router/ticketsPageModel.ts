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
    const createdAt = new Date(ticket.createdAt).getTime();

    if (from !== null && createdAt < from) {
      return false;
    }

    if (to !== null && createdAt > to) {
      return false;
    }

    if (filters.planId && ticket.planId !== filters.planId) {
      return false;
    }

    if (filters.operatorProfile && ticket.operatorProfile !== filters.operatorProfile) {
      return false;
    }

    if (filters.status && ticket.status !== filters.status) {
      return false;
    }

    if (filters.batchId && ticket.batchId !== filters.batchId) {
      return false;
    }

    if (filters.routerId && ticket.routerId !== filters.routerId) {
      return false;
    }

    if (code && !normalizeSearch(ticket.code).includes(code)) {
      return false;
    }

    if (mac && !normalizeSearch(ticket.macAddress ?? "").includes(mac)) {
      return false;
    }

    return true;
  });
}

export function scopeTicketsForSession(tickets: TicketListItem[], session: AuthSession | null | undefined): TicketListItem[] {
  if (!session) {
    return [];
  }

  const accountTickets = tickets.filter((ticket) => ticket.accountId === session.account_id);

  if (session.permissions.includes("router.tickets.read")) {
    return accountTickets;
  }

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

  return logs.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
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
  if (status === "erreur_sync") {
    return "error";
  }

  if (status === "activé") {
    return "active";
  }

  if (status === "disponible" || status === "complété") {
    return "success";
  }

  if (status === "imprimé") {
    return "warning";
  }

  return "offline";
}

export function formatDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440} j`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }

  return `${minutes} min`;
}

export function formatDataLimit(megabytes: number | null): string {
  if (megabytes === null) {
    return "Illimité";
  }

  if (megabytes >= 1024 && megabytes % 1024 === 0) {
    return `${megabytes / 1024} Go`;
  }

  return `${megabytes} MB`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 MB";
  }

  const megabytes = bytes / 1024 / 1024;

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} Go`;
  }

  return `${Math.round(megabytes)} MB`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Non disponible";
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function createDemoTickets(): TicketListItem[] {
  const plans = [
    { dataLimitMb: null, duration: 1440, id: "plan-jour", name: "Journée", validity: 1440 },
    { dataLimitMb: 2048, duration: 180, id: "plan-3h", name: "3h-2Go", validity: 300 },
    { dataLimitMb: 1024, duration: 60, id: "plan-1h", name: "1h", validity: 180 }
  ];
  const statuses: TicketListStatus[] = [
    "disponible",
    "imprimé",
    "activé",
    "complété",
    "expiré",
    "erreur_sync"
  ];
  const now = new Date("2026-07-08T10:00:00.000Z").getTime();
  const demoCodes = createDemoTicketCodes(64);

  return Array.from({ length: 64 }, (_, index) => {
    const plan = plans[index % plans.length];
    const status = statuses[index % statuses.length];
    const createdAt = new Date(now - index * 43 * 60 * 1000).toISOString();
    const activatedAt =
      status === "activé" || status === "complété" || status === "expiré"
        ? new Date(new Date(createdAt).getTime() + 15 * 60 * 1000).toISOString()
        : null;
    const expiresAt = activatedAt ? new Date(new Date(activatedAt).getTime() + plan.validity * 60 * 1000).toISOString() : null;

    return {
      accountId: index % 13 === 0 ? "account-autre-demo" : "account-douma-demo",
      activatedAt,
      batchId: index < 24 ? "batch-jour-20" : index < 48 ? "batch-3h-30" : "batch-agent-14",
      code: demoCodes[index],
      completedAt: status === "complété" ? expiresAt : null,
      createdAt,
      dataLimitMb: plan.dataLimitMb,
      downloadedBytes: status === "activé" || status === "complété" ? (index + 1) * 18_874_368 : 0,
      expiresAt,
      generatedFileName: index % 4 !== 3 ? `tickets-${index < 24 ? "jour" : index < 48 ? "3h" : "agent"}.pdf` : null,
      hasPdf: index % 4 !== 3,
      id: `ticket-demo-${String(index + 1).padStart(3, "0")}`,
      ipAddress: status === "activé" ? `192.168.88.${20 + index}` : null,
      macAddress: status === "activé" ? `A8:6B:AD:73:11:${String(index).padStart(2, "0")}` : null,
      mikrotikId: status === "disponible" ? null : `*${1000 + index}`,
      operatorProfile: index % 5 === 0 ? "agent" : "operator",
      passwordSecretRef: `secret://routeur-demo/${demoCodes[index]}/password`,
      createdByProfileId:
        index % 5 === 0
          ? "account-douma-demo:internal-profile-agent"
          : "account-douma-demo:internal-profile-operator",
      planDurationMinutes: plan.duration,
      planValidityMinutes: plan.validity,
      planId: plan.id,
      planName: plan.name,
      printedCount: status === "imprimé" ? 1 : 0,
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      status,
      syncStatus: index % 9 === 0 ? "conflict" : index % 6 === 0 ? "router_missing" : "router_synced",
      uploadedBytes: status === "activé" || status === "complété" ? (index + 1) * 2_621_440 : 0
    };
  });
}

function createDemoTicketCodes(quantity: number): string[] {
  const codes = new Set<string>();
  let seed = 483_271;

  while (codes.size < quantity) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    codes.add(String(200_000 + (seed % 800_000)));
  }

  return Array.from(codes);
}

function normalizeSearch(value: string): string {
  return value.trim().toUpperCase();
}

function startOfDay(date: string): number {
  return new Date(`${date}T00:00:00.000`).getTime();
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function databaseSyncStatusToTicketSyncStatus(status: TicketRecord["sync_status"]): RouterTicketSyncStatus {
  if (status === "synced") {
    return "router_synced";
  }

  if (status === "conflict") {
    return "conflict";
  }

  if (status === "pending") {
    return "local_only";
  }

  return "local_only";
}
