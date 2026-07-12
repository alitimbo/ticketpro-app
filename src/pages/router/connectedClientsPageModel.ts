import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";

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
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));

  return activeUsers.map((activeUser) => {
    const ticket = ticketsByUsername.get(activeUser.username);
    const plan = ticket ? plansById.get(ticket.planId) : undefined;

    return {
      downloadedBytes: activeUser.downloadedBytes,
      id: activeUser.id,
      ipAddress: activeUser.ipAddress,
      macAddress: activeUser.macAddress,
      planId: ticket?.planId ?? null,
      planName: plan?.name ?? "Plan non identifié",
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: activeUser.sessionTimeLeft,
      status: "active",
      ticketStatus: ticket?.status ?? "unknown",
      totalBytes: activeUser.downloadedBytes + activeUser.uploadedBytes,
      uploadedBytes: activeUser.uploadedBytes,
      uptime: activeUser.uptime,
      uptimeMinutes: parseDurationToMinutes(activeUser.uptime),
      username: activeUser.username
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

export function getConnectedClientPlanOptions(clients: ConnectedClientViewModel[]) {
  const options = new Map<string, string>();

  clients.forEach((client) => {
    if (client.planId) {
      options.set(client.planId, client.planName);
    }
  });

  return Array.from(options.entries()).map(([id, name]) => ({ id, name }));
}

export function formatClientBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 MB";
  }

  const megabytes = bytes / 1024 / 1024;

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} Go`;
  }

  return `${Math.round(megabytes)} MB`;
}

function parseDurationToMinutes(value: string): number {
  const normalized = value.toLowerCase();
  let minutes = 0;

  const days = normalized.match(/(\d+)\s*d/);
  const hours = normalized.match(/(\d+)\s*h/);
  const mins = normalized.match(/(\d+)\s*m/);

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

function normalize(value: string): string {
  return value.trim().toUpperCase();
}
