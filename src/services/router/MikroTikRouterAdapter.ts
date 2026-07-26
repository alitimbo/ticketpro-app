import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUsersBatchDraft,
  InterfaceTraffic,
  RouterConnectionMode,
  RouterConnectionTest,
  RouterDateTime,
  RouterErrorCode,
  RouterHealth,
  RouterSystemInfo
} from "../../domain/router";
import { TicketCodeGenerator } from "../tickets";
import type { RouterAdapter } from "./RouterAdapter";
import { RouterAdapterError } from "./RouterAdapterError";
import {
  TauriRouterOsApiTransport,
  type RouterOsApiConfig,
  type RouterOsApiRequest,
  type RouterOsApiRow,
  type RouterOsApiTransport
} from "./RouterOsApiTransport";

export type MikroTikRouterAdapterOptions = RouterOsApiConfig & {
  connectionMode?: RouterConnectionMode;
  transport?: RouterOsApiTransport;
};

export class MikroTikRouterAdapter implements RouterAdapter {
  private readonly config: RouterOsApiConfig;
  private readonly connectionMode: RouterConnectionMode;
  private readonly transport: RouterOsApiTransport;

  constructor(options: MikroTikRouterAdapterOptions) {
    this.config = {
      host: options.host,
      password: options.password,
      port: options.port,
      retries: options.retries ?? 1,
      timeoutMs: options.timeoutMs ?? 5000,
      useSsl: options.useSsl ?? false,
      username: options.username
    };
    this.connectionMode = options.connectionMode ?? "local";
    this.transport = options.transport ?? new TauriRouterOsApiTransport();
  }

  async testConnection(): Promise<RouterConnectionTest> {
    const startedAt = Date.now();
    await this.call("/system/resource/print");

    return {
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      mode: this.connectionMode,
      ok: true
    };
  }

  async getSystemInfo(): Promise<RouterSystemInfo> {
    const [resourceRows, routerboardRows] = await Promise.all([
      this.call("/system/resource/print"),
      this.call("/system/routerboard/print")
    ]);
    const resource = firstRow(resourceRows);
    const routerboard = firstRow(routerboardRows);

    return {
      architecture: pick(resource, "architecture-name", "architecture") || "inconnue",
      boardName: pick(resource, "board-name") || pick(routerboard, "board-name") || "inconnu",
      identity: pick(resource, "platform") || pick(routerboard, "model") || this.config.host,
      model: pick(routerboard, "model") || pick(resource, "board-name") || "MikroTik",
      routerOsVersion: pick(resource, "version") || "inconnue",
      serialNumber: pick(routerboard, "serial-number") || "inconnu",
      uptime: pick(resource, "uptime") || "0s"
    };
  }

  async getHotspotServers(): Promise<HotspotServer[]> {
    const rows = await this.call("/ip/hotspot/print");

    return rows.map((row) => ({
      addressPool: pick(row, "address-pool") || "default",
      id: pick(row, ".id") || pick(row, "id") || pick(row, "name") || "hotspot",
      interfaceName: pick(row, "interface") || "inconnue",
      isEnabled: !isTruthy(pick(row, "disabled")),
      name: pick(row, "name") || "Hotspot",
      profileName: pick(row, "profile") || "default"
    }));
  }

  async getHotspotPlans(): Promise<HotspotPlan[]> {
    const rows = await this.call("/ip/hotspot/user/profile/print");

    return rows.map((row) => profileRowToPlan(row));
  }

  async createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan> {
    const profileName = plan.profileName || slugify(plan.name);

    await this.call("/ip/hotspot/user/profile/add", {
      comment: buildPlanComment(plan),
      name: profileName,
      "rate-limit": buildRateLimit(plan),
      "session-timeout": minutesToRouterOsDuration(plan.durationMinutes),
      "shared-users": String(plan.sharedUsers)
    });

    return this.findPlanByProfileName(profileName);
  }

  async updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>): Promise<HotspotPlan> {
    const current = await this.findPlanById(planId);
    const next: HotspotPlan = {
      ...current,
      ...updates,
      downloadLimit: updates.downloadLimit === undefined ? current.downloadLimit : updates.downloadLimit,
      id: current.id,
      uploadLimit: updates.uploadLimit === undefined ? current.uploadLimit : updates.uploadLimit
    };

    await this.call("/ip/hotspot/user/profile/set", {
      comment: buildPlanComment(next),
      name: next.profileName,
      numbers: current.id,
      "rate-limit": buildRateLimit(next),
      "session-timeout": minutesToRouterOsDuration(next.durationMinutes),
      "shared-users": String(next.sharedUsers)
    });

    return this.findPlanById(current.id);
  }

  async deleteHotspotPlan(planId: string): Promise<void> {
    const plan = await this.findPlanById(planId);
    await this.call("/ip/hotspot/user/profile/remove", { numbers: plan.id });
  }

  async listHotspotUsers(): Promise<HotspotUser[]> {
    const rows = await this.call("/ip/hotspot/user/print");

    return rows.map((row) => userRowToHotspotUser(row));
  }

  async createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser> {
    const plan = await this.findPlanById(user.planId);
    const password = resolveTicketPassword(user);

    await this.call("/ip/hotspot/user/add", {
      comment: user.comment ?? "",
      name: user.username,
      password,
      profile: plan.profileName
    });

    return this.findUserByName(user.username);
  }

  async provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig): Promise<void> {
    const interfaces = await this.call("/interface/wireguard/print", { name: config.interfaceName });
    const interfaceId = pick(firstRow(interfaces), ".id") || config.interfaceName;

    if (!pick(firstRow(interfaces), ".id")) {
      await this.call("/interface/wireguard/add", {
        "listen-port": 13231,
        name: config.interfaceName,
        "private-key": config.privateKey
      });
    } else {
      await this.call("/interface/wireguard/set", {
        "listen-port": 13231,
        numbers: interfaceId,
        "private-key": config.privateKey
      });
    }

    const addresses = await this.call("/ip/address/print", { address: config.assignedAddress, interface: config.interfaceName });
    if (addresses.length === 0) {
      await this.call("/ip/address/add", { address: config.assignedAddress, interface: config.interfaceName });
    }

    const peers = await this.call("/interface/wireguard/peers/print", {
      interface: config.interfaceName,
      "public-key": config.serverPublicKey
    });
    const peerParams = {
      "allowed-address": config.serverAllowedIps,
      "endpoint-address": config.serverEndpoint,
      "endpoint-port": config.serverPort,
      interface: config.interfaceName,
      "persistent-keepalive": 25,
      "public-key": config.serverPublicKey
    };
    if (peers.length === 0) {
      await this.call("/interface/wireguard/peers/add", peerParams);
    } else {
      await this.call("/interface/wireguard/peers/set", { ...peerParams, numbers: pick(firstRow(peers), ".id") });
    }

    const routes = await this.call("/ip/route/print", { "dst-address": config.serverAllowedIps });
    if (routes.length === 0) {
      await this.call("/ip/route/add", { comment: "TicketPro WireGuard", "dst-address": config.serverAllowedIps, gateway: config.interfaceName });
    }

    const firewallRules = await this.call("/ip/firewall/filter/print", { comment: "TicketPro WireGuard" });
    if (firewallRules.length === 0) {
      await this.call("/ip/firewall/filter/add", {
        action: "accept",
        chain: "input",
        comment: "TicketPro WireGuard",
        "in-interface": config.interfaceName
      });
    }
  }

  async removeWireGuardPeer(reference: import("../../domain/router").RouterWireGuardPeerReference): Promise<void> {
    const peers = await this.call("/interface/wireguard/peers/print", {
      interface: reference.interfaceName,
      "public-key": reference.serverPublicKey
    });
    const peerId = pick(firstRow(peers), ".id");
    if (peerId) {
      await this.call("/interface/wireguard/peers/remove", { numbers: peerId });
    }
  }

  async updateHotspotUser(username: string, planId: string): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    const plan = await this.findPlanById(planId);

    await this.call("/ip/hotspot/user/set", {
      numbers: user.id,
      profile: plan.profileName
    });

    return this.findUserByName(username);
  }

  async createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]> {
    const existingUsers = await this.listHotspotUsers();
    const generator = new TicketCodeGenerator();
    const generatedCodes = generator.generate({
      codeLength: batch.codeLength ?? 6,
      existingTickets: existingUsers,
      prefix: batch.prefix ?? "",
      quantity: batch.quantity,
      routerId: this.config.host
    }).codes;
    const createdUsers: HotspotUser[] = [];

    for (const generatedCode of generatedCodes) {
      createdUsers.push(
        await this.createHotspotUser({
          comment: `Lot créé par ${batch.createdByProfile ?? "operateur"}`,
          passwordSecretRef: generatedCode.passwordSecretRef,
          planId: batch.planId,
          username: generatedCode.username
        })
      );
    }

    return createdUsers;
  }

  async disableHotspotUser(username: string): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/disable", { numbers: user.id });
    return { ...user, status: "disabled" };
  }

  async removeHotspotUser(username: string): Promise<void> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/remove", { numbers: user.id });
  }

  async listActiveUsers(): Promise<ActiveHotspotUser[]> {
    const rows = await this.call("/ip/hotspot/active/print");

    return rows.map((row) => ({
      downloadedBytes: parseInteger(pick(row, "bytes-out", "downloaded-bytes")),
      id: pick(row, ".id") || pick(row, "id") || pick(row, "user") || "active-user",
      ipAddress: pick(row, "address", "ip-address") || "",
      macAddress: pick(row, "mac-address") || "",
      sessionTimeLeft: pick(row, "session-time-left") || "Non disponible",
      uploadedBytes: parseInteger(pick(row, "bytes-in", "uploaded-bytes")),
      uptime: pick(row, "uptime") || "0s",
      username: pick(row, "user", "name") || ""
    }));
  }

  async disconnectActiveUser(username: string): Promise<void> {
    const activeUsers = await this.listActiveUsers();
    const user = activeUsers.find((item) => item.username === username);

    if (!user) {
      throw new RouterAdapterError("hotspot_not_found", "Active user not found");
    }

    await this.call("/ip/hotspot/active/remove", { numbers: user.id });
  }

  async getRouterHealth(): Promise<RouterHealth> {
    const [resourceRows, activeUsers] = await Promise.all([
      this.call("/system/resource/print"),
      this.listActiveUsers()
    ]);
    const resource = firstRow(resourceRows);
    const totalMemory = parseInteger(pick(resource, "total-memory"));
    const freeMemory = parseInteger(pick(resource, "free-memory"));

    return {
      activeClientsCount: activeUsers.length,
      cpuLoad: parseInteger(pick(resource, "cpu-load")),
      memoryTotal: totalMemory,
      memoryUsed: Math.max(0, totalMemory - freeMemory),
      temperatureCelsius: null,
      uptime: pick(resource, "uptime") || "0s"
    };
  }

  async getInterfaceTraffic(): Promise<InterfaceTraffic[]> {
    const rows = await this.call("/interface/monitor-traffic", {
      interface: "all",
      once: true
    });

    return rows.map((row) => ({
      interfaceName: pick(row, "name", "interface") || "interface",
      isRunning: true,
      rxBytesPerSecond: bitsToBytes(parseInteger(pick(row, "rx-bits-per-second"))),
      txBytesPerSecond: bitsToBytes(parseInteger(pick(row, "tx-bits-per-second")))
    }));
  }

  async getRouterDateTime(): Promise<RouterDateTime> {
    const row = firstRow(await this.call("/system/clock/print"));

    return {
      date: pick(row, "date") || "inconnue",
      time: pick(row, "time") || "inconnue",
      timeZone: pick(row, "time-zone-name", "time-zone") || "inconnue"
    };
  }

  private async findPlanById(planId: string): Promise<HotspotPlan> {
    const plans = await this.getHotspotPlans();
    const plan = plans.find((item) => item.id === planId || item.profileName === planId);

    if (!plan) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot profile not found");
    }

    return plan;
  }

  private async findPlanByProfileName(profileName: string): Promise<HotspotPlan> {
    const plans = await this.getHotspotPlans();
    const plan = plans.find((item) => item.profileName === profileName || item.name === profileName);

    if (!plan) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot profile not found");
    }

    return plan;
  }

  private async findUserByName(username: string): Promise<HotspotUser> {
    const users = await this.listHotspotUsers();
    const user = users.find((item) => item.username === username);

    if (!user) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot user not found");
    }

    return user;
  }

  private async call(command: string, params: RouterOsApiRequest["params"] = {}): Promise<RouterOsApiRow[]> {
    try {
      return await this.transport.call({ ...this.config, command, params });
    } catch (error) {
      throw normalizeMikroTikError(error);
    }
  }
}

export function normalizeMikroTikError(error: unknown): RouterAdapterError {
  if (error instanceof RouterAdapterError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  let code: RouterErrorCode = "timeout";

  if (normalized.includes("invalid user") || normalized.includes("authentication") || normalized.includes("cannot log in")) {
    code = "authentication_failed";
  } else if (normalized.includes("connection refused") || normalized.includes("api disabled")) {
    code = "api_disabled";
  } else if (normalized.includes("permission") || normalized.includes("not enough permissions")) {
    code = "permission_denied";
  } else if (normalized.includes("already") || normalized.includes("duplicate") || normalized.includes("failure: user")) {
    code = "duplicate_user";
  } else if (normalized.includes("no such item") || normalized.includes("not found") || normalized.includes("unknown item")) {
    code = "hotspot_not_found";
  } else if (normalized.includes("timed out") || normalized.includes("timeout")) {
    code = "timeout";
  } else if (normalized.includes("offline") || normalized.includes("unreachable") || normalized.includes("network")) {
    code = "router_offline";
  }

  return new RouterAdapterError(code, `RouterOS API error: ${code}`);
}

function profileRowToPlan(row: RouterOsApiRow): HotspotPlan {
  const metadata = parsePlanComment(pick(row, "comment"));
  const rateLimit = pick(row, "rate-limit");
  const [downloadLimit, uploadLimit] = splitRateLimit(rateLimit);
  const durationMinutes = metadata.durationMinutes ?? routerOsDurationToMinutes(pick(row, "session-timeout"));

  return {
    dataLimitMb: metadata.dataLimitMb ?? null,
    downloadLimit,
    durationMinutes,
    id: pick(row, ".id") || pick(row, "id") || pick(row, "name") || "profile",
    name: metadata.name ?? pick(row, "name") ?? "Plan",
    priceHint: metadata.priceHint ?? null,
    profileName: pick(row, "name") || "default",
    sharedUsers: parseInteger(pick(row, "shared-users")) || 1,
    status: "active",
    uploadLimit,
    validityMinutes: metadata.validityMinutes ?? durationMinutes
  };
}

function userRowToHotspotUser(row: RouterOsApiRow): HotspotUser {
  const username = pick(row, "name", "user") || "";

  return {
    comment: pick(row, "comment") || null,
    createdAt: new Date().toISOString(),
    id: pick(row, ".id") || pick(row, "id") || username,
    passwordSecretRef: `secret://mikrotik/${username}/password`,
    planId: pick(row, "profile") || "default",
    profileName: pick(row, "profile") || "default",
    status: isTruthy(pick(row, "disabled")) ? "disabled" : "available",
    username
  };
}

function buildPlanComment(plan: Partial<HotspotPlanDraft | HotspotPlan>): string {
  return `hotspot-manager:${JSON.stringify({
    dataLimitMb: plan.dataLimitMb ?? null,
    durationMinutes: plan.durationMinutes ?? null,
    name: plan.name ?? null,
    priceHint: plan.priceHint ?? null,
    validityMinutes: plan.validityMinutes ?? null
  })}`;
}

function parsePlanComment(comment: string | undefined): Partial<HotspotPlan> {
  if (!comment?.startsWith("hotspot-manager:")) {
    return {};
  }

  try {
    return JSON.parse(comment.replace("hotspot-manager:", "")) as Partial<HotspotPlan>;
  } catch {
    return {};
  }
}

function resolveTicketPassword(user: HotspotUserDraft): string {
  if (user.passwordSecretRef.endsWith(`/${user.username}/password`)) {
    return user.username;
  }

  throw new RouterAdapterError("permission_denied", "Password secret cannot be resolved locally");
}

function buildRateLimit(plan: Pick<HotspotPlanDraft, "downloadLimit" | "uploadLimit">): string | undefined {
  return [plan.downloadLimit, plan.uploadLimit].filter(Boolean).join("/") || undefined;
}

function splitRateLimit(value: string | undefined): [string | null, string | null] {
  if (!value) {
    return [null, null];
  }

  const [downloadLimit, uploadLimit] = value.split("/");
  return [downloadLimit || null, uploadLimit || null];
}

function firstRow(rows: RouterOsApiRow[]): RouterOsApiRow {
  return rows[0] ?? {};
}

function pick(row: RouterOsApiRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (row[key]) {
      return row[key];
    }
  }

  return undefined;
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "yes";
}

function bitsToBytes(bitsPerSecond: number): number {
  return Math.round(bitsPerSecond / 8);
}

function minutesToRouterOsDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440}d`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }

  return `${minutes}m`;
}

function routerOsDurationToMinutes(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  let minutes = 0;
  const days = value.match(/(\d+)d/);
  const hours = value.match(/(\d+)h/);
  const mins = value.match(/(\d+)m/);

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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
