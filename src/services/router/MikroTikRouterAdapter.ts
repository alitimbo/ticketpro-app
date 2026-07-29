import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotDnsConfigurationResult,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUserLimits,
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
import { resolveTicketPasswordValue } from "../tickets/TicketPasswordService";
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
    const password = await resolveTicketPassword(user);

    await this.call("/ip/hotspot/user/add", {
      comment: user.comment ?? "",
      "limit-bytes-total": user.limitBytesTotal ?? null,
      "limit-uptime": user.limitUptime ?? null,
      name: user.username,
      password,
      profile: plan.profileName
    });

    return this.findUserByName(user.username);
  }

  async provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig): Promise<void> {
    const interfaces = await this.query("/interface/wireguard/print", { name: config.interfaceName });
    const existingInterfaceId = pick(firstRow(interfaces), ".id");

    if (!existingInterfaceId) {
      await this.call("/interface/wireguard/add", {
        "listen-port": 13231,
        name: config.interfaceName,
        "private-key": config.privateKey
      });
    } else {
      await this.call("/interface/wireguard/set", {
        "listen-port": 13231,
        numbers: existingInterfaceId,
        "private-key": config.privateKey
      });
    }

    const addresses = await this.query("/ip/address/print", {
      address: config.assignedAddress,
      interface: config.interfaceName
    });
    if (addresses.length === 0) {
      await this.call("/ip/address/add", {
        address: config.assignedAddress,
        interface: config.interfaceName
      });
    }

    const peers = await this.query("/interface/wireguard/peers/print", {
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
      await this.call("/interface/wireguard/peers/set", {
        ...peerParams,
        numbers: pick(firstRow(peers), ".id")
      });
    }

    const routes = await this.query("/ip/route/print", {
      "dst-address": config.serverAllowedIps
    });
    if (routes.length === 0) {
      await this.call("/ip/route/add", {
        comment: "TicketPro WireGuard",
        "dst-address": config.serverAllowedIps,
        gateway: config.interfaceName
      });
    }

    const firewallRules = await this.query("/ip/firewall/filter/print", {
      comment: "TicketPro WireGuard"
    });
    if (firewallRules.length === 0) {
      const inputRules = await this.query("/ip/firewall/filter/print", { chain: "input" });
      const firstDropId = pick(
        inputRules.find((rule) => pick(rule, "action") === "drop") ?? {},
        ".id"
      );
      await this.call("/ip/firewall/filter/add", {
        action: "accept",
        chain: "input",
        comment: "TicketPro WireGuard",
        "in-interface": config.interfaceName,
        "place-before": firstDropId ?? null
      });
    }
  }

  async removeWireGuardPeer(reference: import("../../domain/router").RouterWireGuardPeerReference): Promise<void> {
    const peers = await this.query("/interface/wireguard/peers/print", {
      interface: reference.interfaceName,
      "public-key": reference.serverPublicKey
    });
    const peerId = pick(firstRow(peers), ".id");
    if (peerId) {
      await this.call("/interface/wireguard/peers/remove", { numbers: peerId });
    }
  }

  async updateHotspotUser(username: string, planId: string, limits: HotspotUserLimits = {}): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    const plan = await this.findPlanById(planId);

    await this.call("/ip/hotspot/user/set", {
      // RouterOS requires an explicit empty value to clear an existing limit.
      // `null` itself is omitted by the transport and would leave the old value.
      "limit-bytes-total": limits.limitBytesTotal === null ? "" : limits.limitBytesTotal,
      "limit-uptime": limits.limitUptime === null ? "" : limits.limitUptime,
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
          limitBytesTotal: batch.limitBytesTotal,
          limitUptime: batch.limitUptime,
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

  async enableHotspotUser(username: string): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/enable", { numbers: user.id });
    return { ...user, status: "available" };
  }

  async removeHotspotUser(username: string): Promise<void> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/remove", { numbers: user.id });
  }

  async bindHotspotUserToMac(username: string, macAddress: string): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/set", {
      "mac-address": normalizeMacAddress(macAddress),
      numbers: user.id
    });
    return this.findUserByName(username);
  }

  async clearHotspotUserMac(username: string): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    await this.call("/ip/hotspot/user/set", {
      "mac-address": "00:00:00:00:00:00",
      numbers: user.id
    });
    return this.findUserByName(username);
  }

  async upsertHotspotDns(dnsName: string): Promise<HotspotDnsConfigurationResult> {
    const normalizedDnsName = dnsName.trim().toLowerCase().replace(/\.$/, "");
    const [serverRows, profileRows] = await Promise.all([
      this.call("/ip/hotspot/print"),
      this.call("/ip/hotspot/profile/print")
    ]);
    const server = serverRows.find((row) => !isTruthy(pick(row, "disabled"))) ?? serverRows[0];
    const serverProfileName = server ? pick(server, "profile") : undefined;
    const profile =
      profileRows.find((row) => pick(row, "name") === serverProfileName) ??
      profileRows.find((row) => Boolean(pick(row, "dns-name"))) ??
      profileRows.find((row) => pick(row, "name") === "ticketpro-hotspot-profile");

    if (profile) {
      const profileName = pick(profile, "name") || "ticketpro-hotspot-profile";
      await this.call("/ip/hotspot/profile/set", {
        "dns-name": normalizedDnsName,
        numbers: pick(profile, ".id", "id") || profileName
      });
      return {
        action: "updated",
        dnsName: normalizedDnsName,
        profileName,
        serverName: server ? pick(server, "name") ?? null : null
      };
    }

    const profileName = serverProfileName || "ticketpro-hotspot-profile";
    await this.call("/ip/hotspot/profile/add", {
      "dns-name": normalizedDnsName,
      name: profileName
    });

    if (server && !serverProfileName) {
      await this.call("/ip/hotspot/set", {
        numbers: pick(server, ".id", "id") || pick(server, "name"),
        profile: profileName
      });
    }

    return {
      action: "created",
      dnsName: normalizedDnsName,
      profileName,
      serverName: server ? pick(server, "name") ?? null : null
    };
  }

  async configureHotspotAntiTethering(
    config: import("../../domain/router").HotspotAntiTetheringConfig
  ): Promise<void> {
    const hotspotServers = await this.getHotspotServers();
    const activeInterfaces = Array.from(new Set(
      hotspotServers
        .filter((server) => server.isEnabled && server.interfaceName !== "inconnue")
        .map((server) => server.interfaceName)
    ));
    if (config.enabled && activeInterfaces.length === 0) {
      throw new RouterAdapterError(
        "hotspot_not_found",
        "No active Hotspot interface available for anti-tethering"
      );
    }

    const ipv4Rules = config.enabled && config.blockIpv4Ttl
      ? [63, 127].map((ttl) => ({
          action: "drop",
          chain: "forward",
          comment: `TicketPro anti-tethering:IPv4 TTL ${ttl}`,
          hotspot: "auth",
          ttl: String(ttl)
        }))
      : [];
    await this.reconcileManagedFirewallRules(
      "/ip/firewall/filter",
      ipv4Rules
    );

    const ipv6Rules = config.enabled && config.blockIpv6
      ? activeInterfaces.map((interfaceName) => ({
          action: "drop",
          chain: "forward",
          comment: `TicketPro anti-tethering:IPv6 ${interfaceName}`,
          "in-interface": interfaceName
        }))
      : [];
    try {
      await this.reconcileManagedFirewallRules(
        "/ipv6/firewall/filter",
        ipv6Rules
      );
    } catch (error) {
      if (config.enabled && config.blockIpv6) throw error;
      // RouterOS v6 can run without the optional IPv6 package. Disabling an
      // inactive policy must remain possible in that situation.
    }

    if (config.enabled) {
      const profiles = await this.call("/ip/hotspot/user/profile/print");
      for (const profile of profiles) {
        const profileId = pick(profile, ".id", "id");
        if (profileId && pick(profile, "shared-users") !== "1") {
          await this.call("/ip/hotspot/user/profile/set", {
            numbers: profileId,
            "shared-users": "1"
          });
        }
      }
    }
  }

  async upsertHotspotBypass(
    binding: import("../../domain/router").HotspotBypassBinding
  ): Promise<void> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    const macAddress = normalizeMacAddress(binding.macAddress);
    const comment = `TicketPro infrastructure:${binding.id} ${binding.comment}`.slice(0, 120);
    const managedCommentPrefix = `TicketPro infrastructure:${binding.id}`;
    const existing = rows.find((row) =>
      pick(row, "comment")?.startsWith(managedCommentPrefix)
    );
    const params = {
      address: binding.address,
      comment,
      "mac-address": macAddress,
      server: "all",
      type: "bypassed"
    };

    const existingId = existing ? pick(existing, ".id", "id") : null;
    if (existingId) {
      await this.call("/ip/hotspot/ip-binding/set", {
        ...params,
        numbers: existingId
      });
    } else {
      await this.call("/ip/hotspot/ip-binding/add", params);
    }
  }

  async removeHotspotBypass(id: string, _macAddress: string): Promise<void> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    const existing = rows.find(
      (row) => pick(row, "comment")?.startsWith(`TicketPro infrastructure:${id}`)
    );
    const bindingId = existing ? pick(existing, ".id", "id") : null;
    if (bindingId) {
      await this.call("/ip/hotspot/ip-binding/remove", { numbers: bindingId });
    }
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
    const interfaces = (await this.call("/interface/print"))
      .map((row) => ({
        isRunning: isTruthy(pick(row, "running")) && !isTruthy(pick(row, "disabled")),
        name: pick(row, "name")
      }))
      .filter((item): item is { isRunning: boolean; name: string } => Boolean(item.name));

    return Promise.all(
      interfaces.map(async (routerInterface) => {
        try {
          const row = firstRow(
            await this.call("/interface/monitor-traffic", {
              interface: routerInterface.name,
              once: true
            })
          );

          return {
            interfaceName: routerInterface.name,
            isRunning: routerInterface.isRunning,
            rxBytesPerSecond: bitsToBytes(parseInteger(pick(row, "rx-bits-per-second"))),
            txBytesPerSecond: bitsToBytes(parseInteger(pick(row, "tx-bits-per-second")))
          };
        } catch {
          // Some virtual or unsupported interfaces cannot be monitored. Their
          // presence must not make the complete monitoring page unavailable.
          return {
            interfaceName: routerInterface.name,
            isRunning: routerInterface.isRunning,
            rxBytesPerSecond: 0,
            txBytesPerSecond: 0
          };
        }
      })
    );
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

  private async reconcileManagedFirewallRules(
    menu: "/ip/firewall/filter" | "/ipv6/firewall/filter",
    desiredRules: Array<Record<string, string>>
  ): Promise<void> {
    const rows = await this.call(`${menu}/print`);
    const managedPrefix = "TicketPro anti-tethering:";
    const managedRows = rows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
    );
    const desiredComments = new Set(desiredRules.map((rule) => rule.comment));
    const firstForwardRuleId = pick(
      rows.find((row) =>
        pick(row, "chain") === "forward" &&
        !pick(row, "comment")?.startsWith(managedPrefix) &&
        !isTruthy(pick(row, "dynamic"))
      ) ?? {},
      ".id",
      "id"
    );

    for (const rule of desiredRules) {
      const matches = managedRows.filter(
        (row) => pick(row, "comment") === rule.comment
      );
      const existingId = pick(matches[0] ?? {}, ".id", "id");
      if (existingId) {
        await this.call(`${menu}/set`, {
          ...rule,
          numbers: existingId
        });
      } else {
        await this.call(`${menu}/add`, {
          ...rule,
          "place-before": firstForwardRuleId ?? null
        });
      }

      for (const duplicate of matches.slice(1)) {
        const duplicateId = pick(duplicate, ".id", "id");
        if (duplicateId) {
          await this.call(`${menu}/remove`, { numbers: duplicateId });
        }
      }
    }

    for (const row of managedRows) {
      const comment = pick(row, "comment") ?? "";
      if (desiredComments.has(comment)) continue;
      const ruleId = pick(row, ".id", "id");
      if (ruleId) {
        await this.call(`${menu}/remove`, { numbers: ruleId });
      }
    }
  }

  private async call(command: string, params: RouterOsApiRequest["params"] = {}): Promise<RouterOsApiRow[]> {
    try {
      return await this.transport.call({ ...this.config, command, params });
    } catch (error) {
      throw normalizeMikroTikError(error);
    }
  }

  private async query(command: string, queries: RouterOsApiRequest["queries"] = {}): Promise<RouterOsApiRow[]> {
    try {
      return await this.transport.call({ ...this.config, command, queries });
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
  let code: RouterErrorCode = "router_rejected";

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
  } else if (normalized.includes("router rejected")) {
    code = "router_rejected";
  }

  return new RouterAdapterError(code, `RouterOS API error: ${code}: ${sanitizeRouterMessage(message)}`);
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
    status: metadata.status === "disabled" || isTruthy(pick(row, "disabled")) ? "disabled" : "active",
    uploadLimit,
    validityMinutes: metadata.validityMinutes ?? durationMinutes
  };
}

function userRowToHotspotUser(row: RouterOsApiRow): HotspotUser {
  const username = pick(row, "name", "user") || "";
  const downloadedBytes = parseInteger(pick(row, "bytes-out"));
  const uploadedBytes = parseInteger(pick(row, "bytes-in"));
  const limitBytesTotal = parseInteger(pick(row, "limit-bytes-total"));
  const uptime = pick(row, "uptime") || null;
  const limitUptime = pick(row, "limit-uptime") || null;
  const limitReached =
    (limitBytesTotal > 0 && downloadedBytes + uploadedBytes >= limitBytesTotal) ||
    (routerOsDurationToSeconds(limitUptime) > 0 &&
      routerOsDurationToSeconds(uptime) >= routerOsDurationToSeconds(limitUptime));

  return {
    comment: pick(row, "comment") || null,
    createdAt: new Date().toISOString(),
    id: pick(row, ".id") || pick(row, "id") || username,
    passwordSecretRef: `secret://mikrotik/${username}/password`,
    planId: pick(row, "profile") || "default",
    profileName: pick(row, "profile") || "default",
    status: limitReached ? "expired" : isTruthy(pick(row, "disabled")) ? "disabled" : "available",
    username,
    downloadedBytes,
    uploadedBytes,
    uptime,
    limitUptime,
    limitBytesTotal: limitBytesTotal || null,
    macAddress: normalizeOptionalMacAddress(pick(row, "mac-address"))
  };
}

function normalizeMacAddress(value: string): string {
  const normalized = value.trim().replace(/-/g, ":").toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized)) {
    throw new RouterAdapterError("router_rejected", "Invalid MAC address");
  }
  return normalized;
}

function normalizeOptionalMacAddress(value: string | undefined): string | null {
  if (!value || value === "00:00:00:00:00:00") return null;
  return value.trim().replace(/-/g, ":").toUpperCase();
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

async function resolveTicketPassword(user: HotspotUserDraft): Promise<string> {
  try {
    return await resolveTicketPasswordValue({
      passwordSecretRef: user.passwordSecretRef,
      username: user.username
    });
  } catch {
    throw new RouterAdapterError("permission_denied", "Password secret cannot be resolved locally");
  }
}

function buildRateLimit(plan: Pick<HotspotPlanDraft, "downloadLimit" | "uploadLimit">): string | undefined {
  return [plan.uploadLimit, plan.downloadLimit].filter(Boolean).join("/") || undefined;
}

function splitRateLimit(value: string | undefined): [string | null, string | null] {
  if (!value) {
    return [null, null];
  }

  const [uploadLimit, downloadLimit] = value.split("/");
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

function routerOsDurationToSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const units: Record<string, number> = {
    w: 7 * 24 * 60 * 60,
    d: 24 * 60 * 60,
    h: 60 * 60,
    m: 60,
    s: 1
  };
  let seconds = 0;
  for (const match of value.matchAll(/(\d+)(w|d|h|m|s)/g)) {
    seconds += Number(match[1]) * units[match[2]];
  }
  return seconds;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeRouterMessage(message: string): string {
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}
