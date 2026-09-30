import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";
import type {
  ActiveSessionCacheRecord,
  HotspotPlanRecord,
  TicketRecord
} from "../../domain/database";

export type ClientDurationFilter = "" | "short" | "medium" | "long";

export type ConnectedClientFilters = {
  code: string;
  duration: ClientDurationFilter;
  ipAddress: string;
  macAddress: string;
  planId: string;
};

export type ConnectedClientViewModel = {
  consumptionPercent: number | null;
  currentSessionUptime: string;
  dataLimitBytes: number | null;
  dataRemainingBytes: number | null;
  downloadedBytes: number;
  expiresAt: string | null;
  id: string;
  ipAddress: string;
  macAddress: string;
  planId: string | null;
  planName: string;
  routerId: string;
  routerName: string;
  sessionTimeLeft: string;
  status: "active";
  ticketStatus: HotspotUser["status"] | "unknown";
  totalBytes: number;
  uploadedBytes: number;
  uptime: string;
  uptimeMinutes: number;
  username: string;
};

export type ConnectedClientPlanOption = {
  id: string;
  name: string;
};

export const emptyConnectedClientFilters: ConnectedClientFilters = {
  code: "",
  duration: "",
  ipAddress: "",
  macAddress: "",
  planId: ""
};

export function buildConnectedClientViewModels(
  activeUsers: ActiveHotspotUser[],
  hotspotUsers: HotspotUser[],
  plans: HotspotPlan[],
  router: { id: string; name: string }
): ConnectedClientViewModel[] {
  const ticketsByUsername = new Map(hotspotUsers.map((user) => [user.username, user]));

  return activeUsers.map((activeUser) => {
    const ticket = ticketsByUsername.get(activeUser.username);
    const plan = ticket
      ? plans.find((candidate) =>
          candidate.id === ticket.planId
          || candidate.profileName === ticket.planId
          || candidate.profileName === ticket.profileName
          || candidate.name === ticket.planId
        )
      : undefined;

    const uptimeSeconds = Math.max(
      parseDurationToSeconds(activeUser.uptime),
      parseDurationToSeconds(ticket?.uptime ?? null)
    );
    const durationLimitSeconds = parseDurationToSeconds(ticket?.limitUptime ?? null)
      || Math.max(0, (plan?.durationMinutes ?? 0) * 60);
    const downloadedBytes = Math.max(activeUser.downloadedBytes, ticket?.downloadedBytes ?? 0);
    const uploadedBytes = Math.max(activeUser.uploadedBytes, ticket?.uploadedBytes ?? 0);
    const totalBytes = downloadedBytes + uploadedBytes;
    const dataLimitBytes = resolveDataLimitBytes(ticket?.limitBytesTotal, plan?.dataLimitMb);
    const expiresAt = lifecycleExpirationIso(ticket?.comment);
    const timeConsumed = durationLimitSeconds > 0 && uptimeSeconds >= durationLimitSeconds;
    const quotaConsumed = dataLimitBytes !== null && totalBytes >= dataLimitBytes;
    const validityExpired = expiresAt !== null && Date.parse(expiresAt) <= Date.now();

    return {
      consumptionPercent: calculateConsumptionPercent(
        uptimeSeconds,
        durationLimitSeconds,
        totalBytes,
        dataLimitBytes
      ),
      currentSessionUptime: activeUser.uptime,
      dataLimitBytes,
      dataRemainingBytes: dataLimitBytes === null ? null : Math.max(0, dataLimitBytes - totalBytes),
      downloadedBytes,
      expiresAt,
      id: activeUser.id,
      ipAddress: activeUser.ipAddress,
      macAddress: activeUser.macAddress,
      planId: plan?.id ?? ticket?.planId ?? null,
      planName: plan?.name ?? ticket?.profileName ?? ticket?.planId ?? "Plan non identifié",
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: durationLimitSeconds > 0
        ? formatClientDuration(Math.max(0, durationLimitSeconds - uptimeSeconds))
        : activeUser.sessionTimeLeft,
      status: "active",
      ticketStatus: ticket
        ? ticket.status === "disabled" || ticket.status === "expired"
          ? ticket.status
          : validityExpired
            ? "expired"
            : timeConsumed || quotaConsumed || ticket.status === "exhausted"
              ? "exhausted"
              : "active"
        : "unknown",
      totalBytes,
      uploadedBytes,
      uptime: formatClientDuration(uptimeSeconds),
      uptimeMinutes: Math.floor(uptimeSeconds / 60),
      username: activeUser.username
    };
  });
}

export function buildCachedConnectedClientViewModels(
  cachedUsers: ActiveSessionCacheRecord[],
  tickets: TicketRecord[],
  plans: HotspotPlanRecord[],
  router: { id: string; name: string }
): ConnectedClientViewModel[] {
  const ticketsByUsername = new Map(tickets.map((ticket) => [ticket.username, ticket]));

  return cachedUsers.map((cachedUser) => {
    const ticket = ticketsByUsername.get(cachedUser.username);
    const plan = ticket
      ? plans.find((candidate) =>
          candidate.id === ticket.plan_id
          || candidate.mikrotik_profile_name === ticket.plan_id
          || candidate.name === ticket.plan_id
        ) ?? null
      : null;
    const downloadedBytes = Math.max(cachedUser.downloaded_bytes, ticket?.downloaded_bytes ?? 0);
    const uploadedBytes = Math.max(cachedUser.uploaded_bytes, ticket?.uploaded_bytes ?? 0);
    const uptimeSeconds = Math.max(
      parseDurationToSeconds(cachedUser.uptime),
      ticket?.uptime_seconds ?? 0
    );
    const durationLimitSeconds = Math.max(0, (plan?.duration_minutes ?? 0) * 60);
    const totalBytes = downloadedBytes + uploadedBytes;
    const dataLimitBytes = resolveDataLimitBytes(null, plan?.data_limit_mb);

    return {
      consumptionPercent: calculateConsumptionPercent(
        uptimeSeconds,
        durationLimitSeconds,
        totalBytes,
        dataLimitBytes
      ),
      currentSessionUptime: cachedUser.uptime ?? "0s",
      dataLimitBytes,
      dataRemainingBytes: ticket?.data_remaining_bytes
        ?? (dataLimitBytes === null ? null : Math.max(0, dataLimitBytes - totalBytes)),
      downloadedBytes,
      expiresAt: ticket?.expires_at ?? null,
      id: cachedUser.id,
      ipAddress: cachedUser.ip_address ?? "",
      macAddress: cachedUser.mac_address ?? "",
      planId: plan?.id ?? ticket?.plan_id ?? null,
      planName: plan?.name ?? ticket?.plan_id ?? "Plan non identifié",
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: ticket?.remaining_seconds !== null && ticket?.remaining_seconds !== undefined
        ? formatClientDuration(ticket.remaining_seconds)
        : durationLimitSeconds > 0
          ? formatClientDuration(Math.max(0, durationLimitSeconds - uptimeSeconds))
          : cachedUser.session_time_left ?? "Non disponible",
      status: "active",
      ticketStatus: ticketStatusFromRecord(ticket),
      totalBytes,
      uploadedBytes,
      uptime: formatClientDuration(uptimeSeconds),
      uptimeMinutes: Math.floor(uptimeSeconds / 60),
      username: cachedUser.username
    };
  });
}

export function filterConnectedClients(
  clients: ConnectedClientViewModel[],
  filters: ConnectedClientFilters
): ConnectedClientViewModel[] {
  const code = normalize(filters.code);
  const macAddress = normalize(filters.macAddress);
  const ipAddress = normalize(filters.ipAddress);

  return clients.filter((client) => {
    if (filters.planId && client.planId !== filters.planId) {
      return false;
    }

    if (code && !normalize(client.username).includes(code)) {
      return false;
    }

    if (macAddress && !normalize(client.macAddress).includes(macAddress)) {
      return false;
    }

    if (ipAddress && !normalize(client.ipAddress).includes(ipAddress)) {
      return false;
    }

    if (filters.duration === "short" && client.uptimeMinutes >= 15) {
      return false;
    }

    if (filters.duration === "medium" && (client.uptimeMinutes < 15 || client.uptimeMinutes > 60)) {
      return false;
    }

    if (filters.duration === "long" && client.uptimeMinutes <= 60) {
      return false;
    }

    return true;
  });
}

export function getConnectedClientPlanOptions(
  clients: ConnectedClientViewModel[],
  catalog: ConnectedClientPlanOption[] = []
) {
  const options = new Map<string, string>();

  catalog.forEach((plan) => {
    if (plan.id && plan.name) {
      options.set(plan.id, plan.name);
    }
  });

  clients.forEach((client) => {
    if (client.planId && !options.has(client.planId)) {
      options.set(client.planId, client.planName);
    }
  });

  return Array.from(options.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export function formatClientBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 o";
  }

  if (bytes < 1024) return `${Math.round(bytes)} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;

  const megabytes = bytes / 1024 / 1024;

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} Go`;
  }

  return `${Math.round(megabytes)} MB`;
}

export function parseClientDurationToSeconds(value: string | null | undefined): number {
  return parseDurationToSeconds(value);
}

export function formatClientDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 s";
  const rounded = Math.floor(seconds);
  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return [
    days > 0 ? `${days} j` : null,
    hours > 0 ? `${hours} h` : null,
    minutes > 0 ? `${minutes} min` : null,
    remainingSeconds > 0 ? `${remainingSeconds} s` : null
  ].filter(Boolean).join(" ");
}

function parseDurationToSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let seconds = 0;
  for (const match of value.toLowerCase().matchAll(/(\d+)\s*(w|d|h|m|s)/g)) {
    seconds += Number(match[1]) * units[match[2]];
  }
  return seconds;
}

function resolveDataLimitBytes(
  routerLimit: number | null | undefined,
  planLimitMb: number | null | undefined
): number | null {
  if (routerLimit !== undefined) return routerLimit && routerLimit > 0 ? routerLimit : null;
  if (planLimitMb && planLimitMb > 0) return Math.round(planLimitMb * 1024 * 1024);
  return null;
}

function calculateConsumptionPercent(
  uptimeSeconds: number,
  durationLimitSeconds: number,
  totalBytes: number,
  dataLimitBytes: number | null
): number | null {
  const ratios: number[] = [];
  if (durationLimitSeconds > 0) ratios.push(uptimeSeconds / durationLimitSeconds);
  if (dataLimitBytes !== null && dataLimitBytes > 0) ratios.push(totalBytes / dataLimitBytes);
  if (ratios.length === 0) return null;
  return Math.min(100, Math.max(0, Math.round(Math.max(...ratios) * 100)));
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

function ticketStatusFromRecord(
  ticket: TicketRecord | undefined
): ConnectedClientViewModel["ticketStatus"] {
  if (!ticket) return "unknown";
  if (ticket.status === "désactivé" || ticket.status === "disabled") return "disabled";
  if (ticket.status === "expiré" || ticket.status === "expired") return "expired";
  if (ticket.status === "consommé" || ticket.status === "exhausted") return "exhausted";
  return "active";
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}
