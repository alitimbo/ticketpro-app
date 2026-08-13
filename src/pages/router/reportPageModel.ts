import {
  createDemoTickets,
  scopeTicketsForSession,
  type TicketListItem,
  type TicketListStatus
} from "./ticketsPageModel";
import type { AuthSession } from "../../domain/auth";

export type ReportTicket = TicketListItem & {
  currency: string;
  deletedAt: string | null;
  printedAt: string[];
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
  totalByCurrency: CurrencyTotals | null;
  value: number;
};

export type ReportGroupRow = {
  activated: number;
  completed: number;
  created: number;
  id: string;
  label: string;
  theoreticalByCurrency: CurrencyTotals;
  tickets: ReportTicket[];
};

export type ReportSummary = {
  activatedTheoreticalByCurrency: CurrencyTotals;
  createdTheoreticalByCurrency: CurrencyTotals;
  metrics: ReportMetric[];
  byDay: ReportGroupRow[];
  byOperator: ReportGroupRow[];
  byPlan: ReportGroupRow[];
};

export type CurrencyTotals = Record<string, number>;

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
      currency: "CFA",
      deletedAt,
      printedAt: ticket.printedCount > 0 ? [ticket.createdAt] : [],
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
    activatedTheoreticalByCurrency: sumTheoreticalValueByCurrency(activatedTickets),
    byDay: buildDailyGroupRows(filteredTickets, filters),
    byOperator: buildGroupRows(
      filteredTickets,
      filters,
      (ticket) => ticket.createdByProfileId,
      (ticket) => internalProfileLabel(ticket.createdByProfileId)
    ),
    byPlan: buildGroupRows(filteredTickets, filters, (ticket) => ticket.planId, (ticket) => ticket.planName),
    createdTheoreticalByCurrency: sumTheoreticalValueByCurrency(createdTickets),
    metrics
  };
}

export function getTicketsForMetric(
  tickets: ReportTicket[],
  metricId: ReportMetricId,
  filters: ReportFilters
): ReportTicket[] {
  return tickets.filter((ticket) => {
    return getMetricDates(ticket, metricId).some((eventDate) => isDateInPeriod(eventDate, filters));
  });
}

export function formatCfa(value: number | null): string {
  return formatMoney(value, "CFA");
}

export function formatMoney(value: number | null, currency: string): string {
  if (value === null) {
    return "Non défini";
  }

  return `${value.toLocaleString("fr-FR")} ${normalizeReportCurrency(currency)}`;
}

export function formatCurrencyTotals(totals: CurrencyTotals): string {
  const entries = Object.entries(totals).filter(([, value]) => value !== 0);
  return entries.length > 0
    ? entries.map(([currency, value]) => formatMoney(value, currency)).join(" · ")
    : "0";
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
  const cloudMarker = ":cloud-user:";
  if (profileId.includes(cloudMarker)) {
    return profileId.slice(profileId.indexOf(cloudMarker) + cloudMarker.length) || "Collaborateur";
  }
  const canonicalId = profileId.includes(":") ? profileId.slice(profileId.lastIndexOf(":") + 1) : profileId;
  const labels: Record<string, string> = {
    "internal-profile-admin": "Admin",
    "internal-profile-agent": "Agent",
    "internal-profile-guest": "Invité",
    "internal-profile-operator": "Opérateur"
  };

  return labels[canonicalId] ?? profileId;
}

export function buildReportCsv(tickets: ReportTicket[]): string {
  const header = [
    "Code",
    "Lot",
    "Plan",
    "Statut",
    "Routeur",
    "Rôle",
    "Profil interne",
    "Créé le",
    "Imprimé le",
    "Activé le",
    "Terminé le",
    "Expire le",
    "Supprimé le",
    "Nombre d'impressions",
    "Adresse IP",
    "Adresse MAC",
    "Téléchargé (octets)",
    "Envoyé (octets)",
    "Prix théorique",
    "Devise"
  ];
  const rows = tickets.map((ticket) => [
    ticket.code,
    ticket.batchId,
    ticket.planName,
    ticket.status,
    ticket.routerName,
    profileLabel(ticket.operatorProfile),
    internalProfileLabel(ticket.createdByProfileId),
    ticket.createdAt,
    ticket.printedAt.join(" | "),
    ticket.activatedAt ?? "",
    ticket.completedAt ?? "",
    ticket.expiresAt ?? "",
    ticket.deletedAt ?? "",
    String(ticket.printedCount),
    ticket.ipAddress ?? "",
    ticket.macAddress ?? "",
    String(ticket.downloadedBytes),
    String(ticket.uploadedBytes),
    ticket.priceHint === null ? "" : String(ticket.priceHint),
    normalizeReportCurrency(ticket.currency)
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
  const totalByCurrency = id === "activated" || id === "created"
    ? sumTheoreticalValueByCurrency(metricTickets)
    : null;

  return {
    hint,
    id,
    label,
    totalByCurrency,
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
        theoreticalByCurrency: {},
        tickets: []
      };

    row.tickets.push(ticket);

    if (isDateInPeriod(ticket.createdAt, filters)) {
      row.created += 1;
      addTheoreticalValue(row.theoreticalByCurrency, ticket);
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

function getMetricDates(ticket: ReportTicket, metricId: ReportMetricId): string[] {
  if (metricId === "created") {
    return [ticket.createdAt];
  }

  if (metricId === "printed") {
    return ticket.printedAt.length > 0
      ? ticket.printedAt
      : ticket.printedCount > 0
        ? [ticket.createdAt]
        : [];
  }

  if (metricId === "activated") {
    return ticket.activatedAt ? [ticket.activatedAt] : [];
  }

  if (metricId === "completed") {
    return ticket.completedAt ? [ticket.completedAt] : [];
  }

  if (metricId === "expired") {
    return ticket.status === "expiré" && ticket.expiresAt ? [ticket.expiresAt] : [];
  }

  if (metricId === "deleted") {
    return ticket.deletedAt ? [ticket.deletedAt] : [];
  }

  return ticket.status === "disponible" ? [ticket.createdAt] : [];
}

function getTicketActivityDates(ticket: ReportTicket): string[] {
  return [
    ticket.createdAt,
    ...ticket.printedAt,
    ticket.activatedAt,
    ticket.completedAt,
    ticket.expiresAt,
    ticket.deletedAt
  ].filter((value): value is string => Boolean(value));
}

function buildDailyGroupRows(tickets: ReportTicket[], filters: ReportFilters): ReportGroupRow[] {
  const rows = new Map<string, ReportGroupRow>();

  const getRow = (date: string) => {
    const id = dateKey(date);
    const row =
      rows.get(id) ?? {
        activated: 0,
        completed: 0,
        created: 0,
        id,
        label: id,
        theoreticalByCurrency: {},
        tickets: []
      };
    rows.set(id, row);
    return row;
  };
  const addTicket = (row: ReportGroupRow, ticket: ReportTicket) => {
    if (!row.tickets.some((item) => item.id === ticket.id)) {
      row.tickets.push(ticket);
    }
  };

  tickets.forEach((ticket) => {
    if (isDateInPeriod(ticket.createdAt, filters)) {
      const row = getRow(ticket.createdAt);
      row.created += 1;
      addTheoreticalValue(row.theoreticalByCurrency, ticket);
      addTicket(row, ticket);
    }

    if (ticket.activatedAt && isDateInPeriod(ticket.activatedAt, filters)) {
      const row = getRow(ticket.activatedAt);
      row.activated += 1;
      addTicket(row, ticket);
    }

    if (ticket.completedAt && isDateInPeriod(ticket.completedAt, filters)) {
      const row = getRow(ticket.completedAt);
      row.completed += 1;
      addTicket(row, ticket);
    }
  });

  return Array.from(rows.values()).sort((left, right) => right.id.localeCompare(left.id));
}

function sumTheoreticalValueByCurrency(tickets: ReportTicket[]): CurrencyTotals {
  const totals: CurrencyTotals = {};
  tickets.forEach((ticket) => addTheoreticalValue(totals, ticket));
  return totals;
}

function addTheoreticalValue(totals: CurrencyTotals, ticket: ReportTicket): void {
  if (ticket.priceHint === null) return;
  const currency = normalizeReportCurrency(ticket.currency);
  totals[currency] = (totals[currency] ?? 0) + ticket.priceHint;
}

function normalizeReportCurrency(value: string | null | undefined): string {
  return value?.trim().slice(0, 12) || "CFA";
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
