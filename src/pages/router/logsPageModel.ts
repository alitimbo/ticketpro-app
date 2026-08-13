import type { AuthSession, UserRole } from "../../domain/auth";
import type { AppLogRecord } from "../../domain/database";
import { parseTechnicalMessage, redactTechnicalMessage } from "../../services/logging";
import type { AppStatus } from "../../shared/ui";

export type AppLogCategory =
  | "authentification"
  | "clients_connectes"
  | "fichiers"
  | "impression"
  | "monitoring"
  | "plans"
  | "rapport"
  | "routeur"
  | "synchronisation"
  | "systeme"
  | "tickets";

export type AppLogLevel = "critical" | "error" | "info" | "warning";

export type AppLogEntry = {
  accountId: string;
  action: string | null;
  actorLabel?: string;
  category: AppLogCategory;
  createdAt: string;
  id: string;
  level: AppLogLevel;
  routerId: string | null;
  routerName: string | null;
  technicalDetail: string | null;
  userMessage: string;
  internalProfileId: string | null;
  userProfile: UserRole | null;
};

export type LogFilters = {
  category: "" | AppLogCategory;
  dateFrom: string;
  dateTo: string;
  level: "" | AppLogLevel;
  query: string;
  routerId: string;
  userProfile: "" | UserRole;
};

export const emptyLogFilters: LogFilters = {
  category: "",
  dateFrom: "",
  dateTo: "",
  level: "",
  query: "",
  routerId: "",
  userProfile: ""
};

export const logCategories: AppLogCategory[] = [
  "authentification",
  "routeur",
  "plans",
  "tickets",
  "fichiers",
  "rapport",
  "clients_connectes",
  "monitoring",
  "impression",
  "synchronisation",
  "systeme"
];

export const logLevels: AppLogLevel[] = ["info", "warning", "error", "critical"];

export function createDemoLogs(): AppLogEntry[] {
  const logs: Array<Omit<AppLogEntry, "accountId" | "internalProfileId"> & Partial<Pick<AppLogEntry, "accountId" | "internalProfileId">>> = [
    {
      action: "login",
      category: "authentification",
      createdAt: "2026-07-09T09:55:00.000Z",
      id: "log-auth-001",
      level: "info",
      routerId: null,
      routerName: null,
      technicalDetail: "profile=operator session=local",
      userMessage: "Connexion Opérateur réussie.",
      userProfile: "operator"
    },
    {
      action: "testConnection",
      category: "routeur",
      createdAt: "2026-07-09T09:56:12.000Z",
      id: "log-router-001",
      level: "error",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "timeout while opening API socket on 192.168.88.1:8728",
      userMessage: translateTechnicalError("timeout"),
      userProfile: "admin"
    },
    {
      action: "createPlan",
      category: "plans",
      createdAt: "2026-07-09T09:58:30.000Z",
      id: "log-plan-001",
      level: "info",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "plan=3h-2Go duration=180 validity=300",
      userMessage: "Plan 3h-2Go créé.",
      userProfile: "admin"
    },
    {
      action: "createTickets",
      category: "tickets",
      createdAt: "2026-07-09T10:01:45.000Z",
      id: "log-ticket-001",
      level: "warning",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "duplicate user returned for generated code; retry succeeded",
      userMessage: translateTechnicalError("duplicate user"),
      userProfile: "operator"
    },
    {
      action: "generatePdf",
      category: "fichiers",
      createdAt: "2026-07-09T10:02:20.000Z",
      id: "log-file-001",
      level: "info",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "file=tickets-batch-2026-07-09.pdf format=A4",
      userMessage: "PDF de tickets généré.",
      userProfile: "operator"
    },
    {
      action: "printBatch",
      category: "impression",
      createdAt: "2026-07-09T10:03:11.000Z",
      id: "log-print-001",
      level: "info",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "printer=thermal-80mm copies=1",
      userMessage: "Impression préparée.",
      userProfile: "operator"
    },
    {
      action: "disconnectClient",
      category: "clients_connectes",
      createdAt: "2026-07-09T10:04:05.000Z",
      id: "log-client-001",
      level: "info",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "username=VISITEUR-01 reason=manual_disconnect",
      userMessage: "Client déconnecté.",
      userProfile: "admin"
    },
    {
      action: "refreshMonitoring",
      category: "monitoring",
      createdAt: "2026-07-09T10:05:18.000Z",
      id: "log-monitoring-001",
      level: "warning",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "memory usage reached 84%",
      userMessage: "La mémoire du routeur est élevée.",
      userProfile: "operator"
    },
    {
      action: "syncTickets",
      category: "synchronisation",
      createdAt: "2026-07-09T10:06:40.000Z",
      id: "log-sync-001",
      level: "error",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "permission denied on /ip/hotspot/user/set",
      userMessage: translateTechnicalError("permission denied"),
      userProfile: "operator"
    },
    {
      action: "compareTickets",
      category: "synchronisation",
      createdAt: "2026-07-09T10:06:58.000Z",
      id: "log-sync-002",
      level: "warning",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "sync_status=router_missing username=654321",
      userMessage: "Ticket local absent du routeur.",
      userProfile: "operator"
    },
    {
      action: "exportReport",
      category: "rapport",
      createdAt: "2026-07-09T10:07:14.000Z",
      id: "log-report-001",
      level: "info",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      technicalDetail: "period=2026-07-09 format=csv",
      userMessage: "Rapport exporté.",
      userProfile: "admin"
    },
    {
      action: "startup",
      category: "systeme",
      createdAt: "2026-07-09T10:08:02.000Z",
      id: "log-system-001",
      level: "critical",
      routerId: null,
      routerName: null,
      technicalDetail: "local database opened in read-only mode",
      userMessage: "La base locale est accessible en lecture seule.",
      userProfile: null
    }
  ];

  return logs.map((log) => ({
    ...log,
    accountId: log.accountId ?? "account-douma-demo",
    internalProfileId:
      log.internalProfileId ?? (log.userProfile ? `account-douma-demo:internal-profile-${log.userProfile}` : null)
  }));
}

export function scopeLogsForSession(logs: AppLogEntry[], session: AuthSession | null | undefined): AppLogEntry[] {
  if (!session) {
    return [];
  }

  const accountLogs = logs.filter((log) => log.accountId === session.account_id);

  if (session.permissions.includes("router.logs.read")) {
    return accountLogs;
  }

  return accountLogs.filter((log) => log.internalProfileId === session.internal_profile_id);
}

export function filterLogs(logs: AppLogEntry[], filters: LogFilters): AppLogEntry[] {
  const from = filters.dateFrom ? startOfDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDay(filters.dateTo) : null;
  const query = normalize(filters.query);

  return logs.filter((log) => {
    const createdAt = new Date(log.createdAt).getTime();

    if (from !== null && createdAt < from) {
      return false;
    }

    if (to !== null && createdAt > to) {
      return false;
    }

    if (filters.level && log.level !== filters.level) {
      return false;
    }

    if (filters.category && log.category !== filters.category) {
      return false;
    }

    if (filters.routerId && log.routerId !== filters.routerId) {
      return false;
    }

    if (filters.userProfile && log.userProfile !== filters.userProfile) {
      return false;
    }

    if (
      query &&
      ![
        log.action,
        log.category,
        log.routerName,
        log.technicalDetail,
        log.userMessage,
        log.userProfile
      ].some((value) => normalize(value ?? "").includes(query))
    ) {
      return false;
    }

    return true;
  }).sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
}

export function appLogFromRecord(
  record: AppLogRecord,
  routerNames: ReadonlyMap<string, string>
): AppLogEntry {
  const prefixedMessage = parseLegacyMessage(record.user_message);
  const technical = parseTechnicalMessage(record.technical_message);
  const technicalDetail = [technical.code, technical.detail].filter(Boolean).join(": ") || null;

  return {
    accountId: record.account_id ?? "",
    action: prefixedMessage.action ?? technical.action ?? technical.code,
    actorLabel: cloudActorLabel(record.internal_profile_id),
    category: normalizeCategory(record.category),
    createdAt: record.created_at,
    id: record.id,
    internalProfileId: record.internal_profile_id,
    level: record.level,
    routerId: record.router_id,
    routerName: record.router_id ? routerNames.get(record.router_id) ?? record.router_id : null,
    technicalDetail: technicalDetail ? redactTechnicalMessage(technicalDetail) : null,
    userMessage: prefixedMessage.message,
    userProfile: normalizeProfile(record.created_by_profile, record.internal_profile_id)
  };
}

export function paginateLogs(logs: AppLogEntry[], page: number, pageSize: number): AppLogEntry[] {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safePage = Math.max(1, Math.floor(page));
  return logs.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

export function getLogPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, Math.floor(pageSize))));
}

export function translateTechnicalError(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, " ");

  if (normalized.includes("timeout")) {
    return "Le routeur ne répond pas. Vérifiez la connexion réseau.";
  }

  if (normalized.includes("connection refused")) {
    return "Le routeur refuse la connexion. Vérifiez que l’API MikroTik est activée.";
  }

  if (normalized.includes("authentication failed")) {
    return "Identifiant ou mot de passe MikroTik incorrect.";
  }

  if (normalized.includes("permission denied")) {
    return "Le compte MikroTik n’a pas les droits nécessaires.";
  }

  if (normalized.includes("duplicate user")) {
    return "Ce code existe déjà sur le routeur.";
  }

  if (normalized.includes("hotspot not found")) {
    return "Aucun Hotspot actif n’a été détecté sur ce routeur.";
  }

  if (normalized.includes("remote not configured")) {
    return "La connexion a distance n'est pas configuree.";
  }

  if (normalized.includes("remote unavailable")) {
    return "La connexion distante securisee n'est pas encore disponible.";
  }

  if (normalized.includes("vpn required")) {
    return "Connectez le VPN avant de joindre ce routeur.";
  }

  return "Une action n’a pas pu être terminée.";
}

export function levelLabel(level: AppLogLevel): string {
  const labels: Record<AppLogLevel, string> = {
    critical: "Critique",
    error: "Erreur",
    info: "Info",
    warning: "Avertissement"
  };

  return labels[level];
}

export function levelStatus(level: AppLogLevel): AppStatus {
  if (level === "info") {
    return "success";
  }

  if (level === "warning") {
    return "warning";
  }

  return "error";
}

export function categoryLabel(category: AppLogCategory): string {
  const labels: Record<AppLogCategory, string> = {
    authentification: "Authentification",
    clients_connectes: "Clients connectés",
    fichiers: "Fichiers",
    impression: "Impression",
    monitoring: "Monitoring",
    plans: "Plans",
    rapport: "Rapport",
    routeur: "Routeur",
    synchronisation: "Synchronisation",
    systeme: "Système",
    tickets: "Tickets"
  };

  return labels[category];
}

export function profileLabel(profile: UserRole | null): string {
  const labels: Record<UserRole, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return profile ? labels[profile] : "Système";
}

export function formatLogDate(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function getLogFilterOptions(logs: AppLogEntry[]) {
  const routers = new Map<string, string>();
  const profiles = new Set<UserRole>();

  logs.forEach((log) => {
    if (log.routerId) {
      routers.set(log.routerId, log.routerName ?? log.routerId);
    }

    if (log.userProfile) {
      profiles.add(log.userProfile);
    }
  });

  return {
    profiles: Array.from(profiles),
    routers: Array.from(routers.entries()).map(([id, name]) => ({ id, name }))
  };
}

export function exportLogsToCsv(logs: AppLogEntry[]): string {
  const headers = ["date", "niveau", "categorie", "message", "routeur", "profil", "action"];
  const rows = logs.map((log) => [
    formatLogDate(log.createdAt),
    levelLabel(log.level),
    categoryLabel(log.category),
    log.userMessage,
    log.routerName ?? "",
    log.actorLabel ? `${log.actorLabel} (${profileLabel(log.userProfile)})` : profileLabel(log.userProfile),
    log.action ?? ""
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function cloudActorLabel(profileId: string | null): string | undefined {
  if (!profileId) return undefined;
  const marker = ":cloud-user:";
  if (!profileId.includes(marker)) return undefined;
  return profileId.slice(profileId.indexOf(marker) + marker.length) || undefined;
}

export function canCleanLogs(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

function normalizeCategory(value: string): AppLogCategory {
  return logCategories.includes(value as AppLogCategory)
    ? value as AppLogCategory
    : "systeme";
}

function normalizeProfile(
  createdByProfile: string | null,
  internalProfileId: string | null
): UserRole | null {
  const candidates = [createdByProfile, internalProfileId].filter(
    (value): value is string => Boolean(value)
  );

  return (["admin", "operator", "agent", "guest"] as UserRole[]).find((role) =>
    candidates.some(
      (candidate) =>
        candidate === role ||
        candidate.endsWith(`-${role}`) ||
        candidate.endsWith(`:${role}`)
    )
  ) ?? null;
}

function parseLegacyMessage(value: string): { action: string | null; message: string } {
  const match = value.match(/^\[([^\]]+)\]\s*(.+)$/);
  return match
    ? { action: match[1].trim() || null, message: match[2].trim() || value }
    : { action: null, message: value };
}

function escapeCsv(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafeValue.replace(/"/g, '""')}"`;
}

function startOfDay(date: string): number {
  return new Date(`${date}T00:00:00.000`).getTime();
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("fr");
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
