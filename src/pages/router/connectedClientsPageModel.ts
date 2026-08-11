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
  downloadedBytes: number;
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

    return {
      downloadedBytes: activeUser.downloadedBytes,
      id: activeUser.id,
      ipAddress: activeUser.ipAddress,
      macAddress: activeUser.macAddress,
      planId: plan?.id ?? ticket?.planId ?? null,
      planName: plan?.name ?? ticket?.profileName ?? ticket?.planId ?? "Plan non identifié",
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: activeUser.sessionTimeLeft,
      status: "active",
      ticketStatus: ticket
        ? ticket.status === "disabled" || ticket.status === "expired"
          ? ticket.status
          : "active"
        : "unknown",
      totalBytes: activeUser.downloadedBytes + activeUser.uploadedBytes,
      uploadedBytes: activeUser.uploadedBytes,
      uptime: activeUser.uptime,
      uptimeMinutes: parseDurationToMinutes(activeUser.uptime),
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
    const downloadedBytes = cachedUser.downloaded_bytes;
    const uploadedBytes = cachedUser.uploaded_bytes;
    const uptime = cachedUser.uptime ?? "0s";

    return {
      downloadedBytes,
      id: cachedUser.id,
      ipAddress: cachedUser.ip_address ?? "",
      macAddress: cachedUser.mac_address ?? "",
      planId: plan?.id ?? ticket?.plan_id ?? null,
      planName: plan?.name ?? ticket?.plan_id ?? "Plan non identifié",
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: cachedUser.session_time_left ?? "Non disponible",
      status: "active",
      ticketStatus: ticketStatusFromRecord(ticket),
      totalBytes: downloadedBytes + uploadedBytes,
      uploadedBytes,
      uptime,
      uptimeMinutes: parseDurationToMinutes(uptime),
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

function parseDurationToMinutes(value: string): number {
  const normalized = value.toLowerCase();
  let minutes = 0;

  const weeks = normalized.match(/(\d+)\s*w/);
  const days = normalized.match(/(\d+)\s*d/);
  const hours = normalized.match(/(\d+)\s*h/);
  const mins = normalized.match(/(\d+)\s*m/);

  if (weeks) {
    minutes += Number(weeks[1]) * 10080;
  }

  if (days) {
    minutes += Number(days[1]) * 1440;
  }

  if (hours) {
    minutes += Number(hours[1]) * 60;
  }

  if (mins) {
    minutes += Number(mins[1]);
  }

  return minutes;
}

function ticketStatusFromRecord(
  ticket: TicketRecord | undefined
): ConnectedClientViewModel["ticketStatus"] {
  if (!ticket) return "unknown";
  if (ticket.status === "désactivé" || ticket.status === "disabled") return "disabled";
  if (ticket.status === "expiré" || ticket.status === "expired") return "expired";
  return "active";
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}
