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
  downloadLimit: string | null;
  downloadedBytes: number;
  expiresAt: string | null;
  id: string;
  ipAddress: string;
  macAddress: string;
  /** Device lock read on RouterOS (/ip hotspot user mac-address). */
  deviceLock: ClientDeviceLock;
  planId: string | null;
  planName: string;
  profileName: string | null;
  routerId: string;
  routerName: string;
  sessionTimeLeft: string;
  status: "active";
  sharedUsers: number | null;
  ticketStatus: HotspotUser["status"] | "unknown";
  totalBytes: number;
  uploadedBytes: number;
  uploadLimit: string | null;
  uptime: string;
  uptimeMinutes: number;
  username: string;
};

/**
 * - locked: the RouterOS user carries the MAC of this session; RouterOS refuses
 *   the voucher from any other device.
 * - mismatch: the RouterOS user carries another MAC than this session.
 * - unlocked: the RouterOS user has no MAC; any device can use the voucher.
 * - not_voucher: no TicketPro voucher on RouterOS for this session (other
 *   hotspot account, trial, bypass…); the first-device rule does not apply.
 * - unverified: only the local cache is available.
 */
export type ClientDeviceLockState = "locked" | "mismatch" | "unlocked" | "not_voucher" | "unverified";

export type ClientDeviceLock = {
  lockedMacAddress: string | null;
  state: ClientDeviceLockState;
};

export type DeviceLockSummary = {
  /** Unique TicketPro vouchers among the listed sessions. */
  concernedVouchers: number;
  lockedVouchers: number;
  mismatchVouchers: number;
  /** Listed sessions that are not TicketPro vouchers. */
  outsideSessions: number;
  sessions: number;
  unlockedVouchers: number;
  unverifiedVouchers: number;
};

const ticketProVoucherCommentPrefix = "TicketPro:v1;";

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
    const deviceLock = resolveDeviceLock(ticket, activeUser.macAddress, managedVoucherUsernames);

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
      downloadLimit: plan?.downloadLimit ?? null,
      downloadedBytes,
      expiresAt,
      id: activeUser.id,
      ipAddress: activeUser.ipAddress,
      macAddress: activeUser.macAddress,
      deviceLock,
      planId: plan?.id ?? ticket?.planId ?? null,
      planName: (ticket?.profileName ? localPlanNamesByProfile?.get(ticket.profileName) : undefined)
        ?? plan?.name ?? ticket?.profileName ?? ticket?.planId ?? "Plan non identifié",
      profileName: ticket?.profileName ?? plan?.profileName ?? null,
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: durationLimitSeconds > 0
        ? formatClientDuration(Math.max(0, durationLimitSeconds - uptimeSeconds))
        : activeUser.sessionTimeLeft,
      status: "active",
      sharedUsers: plan?.sharedUsers ?? null,
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
      uploadLimit: plan?.uploadLimit ?? null,
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
    const durationLimitSeconds = Math.max(0, (ticket?.duration_minutes_snapshot ?? plan?.duration_minutes ?? 0) * 60);
    const totalBytes = downloadedBytes + uploadedBytes;
    const dataLimitBytes = ticket?.data_limit_mb_snapshot !== undefined
      ? resolveDataLimitBytes(undefined, ticket.data_limit_mb_snapshot)
      : resolveDataLimitBytes(undefined, plan?.data_limit_mb);

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
      downloadLimit: ticket?.download_limit_snapshot ?? plan?.download_limit ?? null,
      downloadedBytes,
      expiresAt: ticket?.expires_at ?? null,
      id: cachedUser.id,
      ipAddress: cachedUser.ip_address ?? "",
      macAddress: cachedUser.mac_address ?? "",
      deviceLock: {
        lockedMacAddress: ticket?.mac_address ?? null,
        state: ticket ? "unverified" : "not_voucher"
      },
      planId: plan?.id ?? ticket?.plan_id ?? null,
      planName: plan?.name ?? ticket?.plan_id ?? "Plan non identifié",
      profileName: ticket?.mikrotik_profile_name ?? plan?.mikrotik_profile_name ?? null,
      routerId: router.id,
      routerName: router.name,
      sessionTimeLeft: ticket?.remaining_seconds !== null && ticket?.remaining_seconds !== undefined
        ? formatClientDuration(ticket.remaining_seconds)
        : durationLimitSeconds > 0
          ? formatClientDuration(Math.max(0, durationLimitSeconds - uptimeSeconds))
          : cachedUser.session_time_left ?? "Non disponible",
      status: "active",
      sharedUsers: ticket?.shared_users_snapshot ?? plan?.shared_users ?? null,
      ticketStatus: ticketStatusFromRecord(ticket),
      totalBytes,
      uploadedBytes,
      uploadLimit: ticket?.upload_limit_snapshot ?? plan?.upload_limit ?? null,
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

/**
 * Counts unique vouchers (not sessions) so a voucher shared by two sessions is
 * counted once, and sessions outside TicketPro vouchers are reported apart.
 */
export function summarizeDeviceLocks(clients: ConnectedClientViewModel[]): DeviceLockSummary {
  const byVoucher = new Map<string, ClientDeviceLockState>();
  const rank: Record<ClientDeviceLockState, number> = { mismatch: 4, unlocked: 3, unverified: 2, locked: 1, not_voucher: 0 };
  let outsideSessions = 0;
  for (const client of clients) {
    if (client.deviceLock.state === "not_voucher") {
      outsideSessions += 1;
      continue;
    }
    const current = byVoucher.get(client.username);
    // A voucher with one locked session and one foreign session is not safe.
    if (!current || rank[client.deviceLock.state] > rank[current]) {
      byVoucher.set(client.username, client.deviceLock.state);
    }
  }
  const states = Array.from(byVoucher.values());
  const count = (state: ClientDeviceLockState) => states.filter((item) => item === state).length;
  return {
    concernedVouchers: byVoucher.size,
    lockedVouchers: count("locked"),
    mismatchVouchers: count("mismatch"),
    outsideSessions,
    sessions: clients.length,
    unlockedVouchers: count("unlocked"),
    unverifiedVouchers: count("unverified")
  };
}

export function formatDeviceLockSummary(summary: DeviceLockSummary): string {
  const parts = [
    `${summary.lockedVouchers} ticket(s) verrouillé(s) sur ${summary.concernedVouchers} ticket(s) TicketPro concerné(s)`
  ];
  if (summary.unlockedVouchers > 0) parts.push(`${summary.unlockedVouchers} non verrouillé(s)`);
  if (summary.mismatchVouchers > 0) parts.push(`${summary.mismatchVouchers} appareil(s) différent(s) du verrou`);
  if (summary.unverifiedVouchers > 0) parts.push(`${summary.unverifiedVouchers} non vérifié(s) (cache)`);
  if (summary.outsideSessions > 0) parts.push(`${summary.outsideSessions} session(s) hors vouchers TicketPro`);
  return `${parts.join(" · ")} — ${summary.sessions} session(s) affichée(s).`;
}

export function deviceLockLabel(lock: ClientDeviceLock): string {
  switch (lock.state) {
    case "locked":
      return `Verrouillé sur ${lock.lockedMacAddress}`;
    case "mismatch":
      return `Verrou sur un autre appareil (${lock.lockedMacAddress})`;
    case "unlocked":
      return "Non verrouillé sur RouterOS";
    case "unverified":
      return lock.lockedMacAddress ? `Non vérifié (cache : ${lock.lockedMacAddress})` : "Non vérifié (cache)";
    default:
      return "Non concerné (hors voucher TicketPro)";
  }
}

function resolveDeviceLock(
  user: HotspotUser | undefined,
  sessionMacAddress: string,
  managedVoucherUsernames: ReadonlySet<string> | undefined
): ClientDeviceLock {
  const isTicketProVoucher = Boolean(user) && (
    (user?.comment ?? "").startsWith(ticketProVoucherCommentPrefix)
    || (managedVoucherUsernames?.has(user?.username ?? "") ?? false)
  );
  if (!user || !isTicketProVoucher) {
    return { lockedMacAddress: user?.macAddress ?? null, state: "not_voucher" };
  }
  const lockedMacAddress = user.macAddress && user.macAddress !== "00:00:00:00:00:00"
    ? normalizeMac(user.macAddress)
    : null;
  if (!lockedMacAddress) return { lockedMacAddress: null, state: "unlocked" };
  return {
    lockedMacAddress,
    state: lockedMacAddress === normalizeMac(sessionMacAddress) ? "locked" : "mismatch"
  };
}

function normalizeMac(value: string): string {
  return value.trim().replace(/-/g, ":").toUpperCase();
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
