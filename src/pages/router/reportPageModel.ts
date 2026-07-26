import {
  createDemoTickets,
  scopeTicketsForSession,
  type TicketListItem,
  type TicketListStatus
} from "./ticketsPageModel";
import type { AuthSession } from "../../domain/auth";

export type ReportTicket = TicketListItem & {
  deletedAt: string | null;
  priceHint: number | null;
};

export type ReportFilters = {
  dateFrom: string;
  dateTo: string;
  internalProfileId: string;
  operatorProfile: string;
  planId: string;
  routerId: string;
};

export type ReportMetricId =
  | "activated"
  | "available"
  | "completed"
  | "created"
  | "deleted"
  | "expired"
  | "printed";

export type ReportMetric = {
  hint: string;
  id: ReportMetricId;
  label: string;
  totalCfa: number | null;
  value: number;
};

export type ReportGroupRow = {
  activated: number;
  completed: number;
  created: number;
  id: string;
  label: string;
  theoreticalCfa: number;
  tickets: ReportTicket[];
};

export type ReportSummary = {
  activatedTheoreticalCfa: number;
  createdTheoreticalCfa: number;
  metrics: ReportMetric[];
  byDay: ReportGroupRow[];
  byOperator: ReportGroupRow[];
  byPlan: ReportGroupRow[];
};

export const emptyReportFilters: ReportFilters = {
  dateFrom: "2026-07-08",
  dateTo: "2026-07-08",
  internalProfileId: "",
  operatorProfile: "",
  planId: "",
  routerId: ""
};

const planPrices: Record<string, number> = {
  "plan-1h": 100,
  "plan-3h": 200,
  "plan-jour": 500
};

export function createDemoReportTickets(): ReportTicket[] {
  return createDemoTickets().map((ticket, index) => {
    const deletedAt = index % 17 === 0 ? new Date(new Date(ticket.createdAt).getTime() + 25 * 60 * 1000).toISOString() : null;
    const status: TicketListStatus = deletedAt ? "supprimé" : ticket.status;

    return {
      ...ticket,
      deletedAt,
      priceHint: planPrices[ticket.planId] ?? null,
      status
    };
  });
}

export function scopeReportTicketsForSession(
  tickets: ReportTicket[],
  session: AuthSession | null | undefined
): ReportTicket[] {
  return scopeTicketsForSession(tickets, session) as ReportTicket[];
}

export function filterReportTickets(tickets: ReportTicket[], filters: ReportFilters): ReportTicket[] {
  const from = filters.dateFrom ? startOfDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDay(filters.dateTo) : null;

  return tickets.filter((ticket) => {
    if (filters.operatorProfile && ticket.operatorProfile !== filters.operatorProfile) {
      return false;
    }

    if (filters.internalProfileId && ticket.createdByProfileId !== filters.internalProfileId) {
      return false;
    }

    if (filters.planId && ticket.planId !== filters.planId) {
      return false;
    }

    if (filters.routerId && ticket.routerId !== filters.routerId) {
      return false;
    }

    if (from === null && to === null) {
      return true;
    }

    return getTicketActivityDates(ticket).some((dateValue) => {
      const time = new Date(dateValue).getTime();
      return (from === null || time >= from) && (to === null || time <= to);
    });
  });
}

export function buildReportSummary(tickets: ReportTicket[], filters: ReportFilters): ReportSummary {
  const filteredTickets = filterReportTickets(tickets, filters);
  const metrics: ReportMetric[] = [
    buildMetric("created", "Tickets créés", "Créés sur la période", filteredTickets, filters),
    buildMetric("printed", "Tickets imprimés", "Marqués imprimés", filteredTickets, filters),
    buildMetric("activated", "Tickets activés", "Utilisés par un client", filteredTickets, filters),
    buildMetric("completed", "Tickets complétés", "Sessions terminées", filteredTickets, filters),
    buildMetric("expired", "Tickets expirés", "Fin de validité atteinte", filteredTickets, filters),
    buildMetric("deleted", "Tickets supprimés", "Suppression contrôlée", filteredTickets, filters),
    buildMetric("available", "Tickets disponibles", "Encore non utilisés", filteredTickets, filters)
  ];
  const activatedTickets = getTicketsForMetric(filteredTickets, "activated", filters);
  const createdTickets = getTicketsForMetric(filteredTickets, "created", filters);

  return {
    activatedTheoreticalCfa: sumTheoreticalValue(activatedTickets),
    byDay: buildGroupRows(filteredTickets, filters, (ticket) => dateKey(ticket.createdAt), (ticket) => dateKey(ticket.createdAt)),
    byOperator: buildGroupRows(
      filteredTickets,
      filters,
      (ticket) => ticket.createdByProfileId,
      (ticket) => internalProfileLabel(ticket.createdByProfileId)
    ),
    byPlan: buildGroupRows(filteredTickets, filters, (ticket) => ticket.planId, (ticket) => ticket.planName),
    createdTheoreticalCfa: sumTheoreticalValue(createdTickets),
    metrics
  };
}

export function getTicketsForMetric(
  tickets: ReportTicket[],
  metricId: ReportMetricId,
  filters: ReportFilters
): ReportTicket[] {
  return tickets.filter((ticket) => {
    const eventDate = getMetricDate(ticket, metricId);

    if (!eventDate) {
      return false;
    }

    return isDateInPeriod(eventDate, filters);
  });
}

export function formatCfa(value: number | null): string {
  if (value === null) {
    return "Non défini";
  }

  return `${value.toLocaleString("fr-FR")} CFA`;
}

export function formatReportDate(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function profileLabel(profile: string): string {
  const labels: Record<string, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[profile] ?? profile;
}

export function internalProfileLabel(profileId: string): string {
  const canonicalId = profileId.includes(":") ? profileId.slice(profileId.lastIndexOf(":") + 1) : profileId;
  const labels: Record<string, string> = {
    "internal-profile-admin": "Admin",
    "internal-profile-agent": "Agent",
    "internal-profile-guest": "InvitÃ©",
    "internal-profile-operator": "OpÃ©rateur"
  };

  return labels[canonicalId] ?? profileId;
}

export function buildReportCsv(tickets: ReportTicket[]): string {
  const header = ["Code", "Plan", "Statut", "Routeur", "Profil", "Créé le", "Activé le", "Terminé le", "Prix théorique CFA"];
  const rows = tickets.map((ticket) => [
    ticket.code,
    ticket.planName,
    ticket.status,
    ticket.routerName,
    internalProfileLabel(ticket.createdByProfileId),
    ticket.createdAt,
    ticket.activatedAt ?? "",
    ticket.completedAt ?? "",
    ticket.priceHint === null ? "" : String(ticket.priceHint)
  ]);

  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsvCell).join(";")).join("\r\n")}\r\n`;
}

function buildMetric(
  id: ReportMetricId,
  label: string,
  hint: string,
  tickets: ReportTicket[],
  filters: ReportFilters
): ReportMetric {
  const metricTickets = getTicketsForMetric(tickets, id, filters);
  const totalCfa = id === "activated" || id === "created" ? sumTheoreticalValue(metricTickets) : null;

  return {
    hint,
    id,
    label,
    totalCfa,
    value: metricTickets.length
  };
}

function escapeCsvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildGroupRows(
  tickets: ReportTicket[],
  filters: ReportFilters,
  getId: (ticket: ReportTicket) => string,
  getLabel: (ticket: ReportTicket) => string
): ReportGroupRow[] {
  const rows = new Map<string, ReportGroupRow>();

  tickets.forEach((ticket) => {
    const id = getId(ticket);
    const row =
      rows.get(id) ??
      {
        activated: 0,
        completed: 0,
        created: 0,
        id,
        label: getLabel(ticket),
        theoreticalCfa: 0,
        tickets: []
      };

    row.tickets.push(ticket);

    if (isDateInPeriod(ticket.createdAt, filters)) {
      row.created += 1;
      row.theoreticalCfa += ticket.priceHint ?? 0;
    }

    if (ticket.activatedAt && isDateInPeriod(ticket.activatedAt, filters)) {
      row.activated += 1;
    }

    if (ticket.completedAt && isDateInPeriod(ticket.completedAt, filters)) {
      row.completed += 1;
    }

    rows.set(id, row);
  });

  return Array.from(rows.values()).sort((left, right) => right.created - left.created || left.label.localeCompare(right.label));
}

function getMetricDate(ticket: ReportTicket, metricId: ReportMetricId): string | null {
  if (metricId === "created") {
    return ticket.createdAt;
  }

  if (metricId === "printed") {
    return ticket.printedCount > 0 ? ticket.createdAt : null;
  }

  if (metricId === "activated") {
    return ticket.activatedAt;
  }

  if (metricId === "completed") {
    return ticket.completedAt;
  }

  if (metricId === "expired") {
    return ticket.status === "expiré" ? ticket.expiresAt : null;
  }

  if (metricId === "deleted") {
    return ticket.deletedAt;
  }

  return ticket.status === "disponible" ? ticket.createdAt : null;
}

function getTicketActivityDates(ticket: ReportTicket): string[] {
  return [
    ticket.createdAt,
    ticket.activatedAt,
    ticket.completedAt,
    ticket.expiresAt,
    ticket.deletedAt
  ].filter((value): value is string => Boolean(value));
}

function sumTheoreticalValue(tickets: ReportTicket[]): number {
  return tickets.reduce((sum, ticket) => sum + (ticket.priceHint ?? 0), 0);
}

function isDateInPeriod(value: string, filters: ReportFilters): boolean {
  const from = filters.dateFrom ? startOfDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDay(filters.dateTo) : null;
  const time = new Date(value).getTime();

  return (from === null || time >= from) && (to === null || time <= to);
}

function dateKey(value: string): string {
  return formatReportDate(value);
}

function startOfDay(date: string): number {
  return new Date(`${date}T00:00:00.000`).getTime();
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}
