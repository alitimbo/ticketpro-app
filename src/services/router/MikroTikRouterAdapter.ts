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
  RouterSystemInfo,
  VoucherLifecycleEngineState
} from "../../domain/router";
import { TicketCodeGenerator } from "../tickets";
import {
  protectTicketPassword,
  resolveTicketPasswordValue
} from "../tickets/TicketPasswordService";
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

const VOUCHER_LIFECYCLE_ENGINE_VERSION = 1;
const VOUCHER_EXPIRATION_SCRIPT = "ticketpro-voucher-expiration-v1";
const VOUCHER_EXPIRATION_SCHEDULER = "ticketpro-voucher-expiration-v1";
const VOUCHER_LIFECYCLE_COMMENT_PREFIX = "TicketPro:v1;";
const VOUCHER_PROFILE_HANDLER_BEGIN = "# TICKETPRO-LIFECYCLE-BEGIN v1";
const VOUCHER_PROFILE_HANDLER_END = "# TICKETPRO-LIFECYCLE-END v1";

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

  async ensureVoucherLifecycleEngine(): Promise<VoucherLifecycleEngineState> {
    const resource = firstRow(await this.call("/system/resource/print"));
    const routerOsVersion = pick(resource, "version") ?? "";
    const majorVersion = Number.parseInt(routerOsVersion, 10);
    if (!Number.isFinite(majorVersion) || majorVersion < 7) {
      throw new RouterAdapterError(
        "router_rejected",
        "TicketPro voucher lifecycle requires RouterOS 7 or newer"
      );
    }

    await this.ensureRouterClock();
    await this.upsertSystemScript(
      VOUCHER_EXPIRATION_SCRIPT,
      buildVoucherExpirationScript()
    );
    await this.upsertLifecycleScheduler();

    const [profiles, systemScripts] = await Promise.all([
      this.call("/ip/hotspot/user/profile/print"),
      this.call("/system/script/print")
    ]);
    const systemScriptNames = new Set(
      systemScripts.map((script) => pick(script, "name")).filter((name): name is string => Boolean(name))
    );
    let managedProfileCount = 0;
    for (const profile of profiles) {
      const profileId = pick(profile, ".id", "id");
      if (!profileId) continue;
      const currentOnLogin = pick(profile, "on-login") ?? "";
      const nextOnLogin = mergeVoucherLifecycleOnLogin(currentOnLogin, systemScriptNames);
      if (nextOnLogin !== currentOnLogin) {
        await this.call("/ip/hotspot/user/profile/set", {
          numbers: profileId,
          "on-login": nextOnLogin
        });
      }
      managedProfileCount += 1;
    }

    const clock = firstRow(await this.call("/system/clock/print"));
    return {
      clockReady: isPlausibleRouterDate(pick(clock, "date")),
      engineVersion: VOUCHER_LIFECYCLE_ENGINE_VERSION,
      managedProfileCount,
      schedulerEnabled: true
    };
  }

  async createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan> {
    const profileName = plan.profileName || slugify(plan.name);

    await this.call("/ip/hotspot/user/profile/add", {
      name: profileName,
      "on-login": mergeVoucherLifecycleOnLogin(""),
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
    const [currentProfiles, systemScripts] = await Promise.all([
      this.call("/ip/hotspot/user/profile/print"),
      this.call("/system/script/print")
    ]);
    const currentProfile = currentProfiles.find((profile) =>
      pick(profile, ".id", "id") === current.id
      || pick(profile, "name") === current.profileName
    );

    await this.call("/ip/hotspot/user/profile/set", {
      name: next.profileName,
      numbers: current.id,
      "on-login": mergeVoucherLifecycleOnLogin(
        pick(currentProfile ?? {}, "on-login") ?? "",
        new Set(
          systemScripts.map((script) => pick(script, "name")).filter((name): name is string => Boolean(name))
        )
      ),
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
    return Promise.all(rows.map((row) => userRowToHotspotUser(row)));
  }

  async createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser> {
    const plan = await this.findPlanById(user.planId);
    const password = await resolveTicketPassword(user);

    await this.call("/ip/hotspot/user/add", {
      comment: buildVoucherLifecycleComment(user.validityMinutes, user.comment),
      "limit-bytes-total": user.limitBytesTotal ?? null,
      "limit-uptime": user.limitUptime ?? null,
      name: user.username,
      password,
      profile: plan.profileName,
      server: user.serverName?.trim() || "all"
    });

    return this.findUserByName(user.username);
  }

  async getWireGuardInstallation(
    interfaceName: string
  ): Promise<import("../../domain/router").RouterWireGuardInstallation | null> {
    const interfaces = await this.query("/interface/wireguard/print", { name: interfaceName });
    const wireGuardInterface = firstRow(interfaces);
    const interfaceId = pick(wireGuardInterface, ".id");
    const publicKey = pick(wireGuardInterface, "public-key");
    if (!interfaceId || !publicKey) return null;

    const [addresses, peers] = await Promise.all([
      this.query("/ip/address/print", { interface: interfaceName }),
      this.query("/interface/wireguard/peers/print", { interface: interfaceName })
    ]);

    return {
      assignedAddress: addresses.map((row) => pick(row, "address")).find(Boolean) ?? null,
      interfaceName,
      publicKey,
      serverPublicKeys: peers.map((row) => pick(row, "public-key")).filter((key): key is string => Boolean(key))
    };
  }

  async provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig): Promise<void> {
    const interfaces = await this.query("/interface/wireguard/print", { name: config.interfaceName });
    const existingInterfaceId = pick(firstRow(interfaces), ".id");

    if (!existingInterfaceId) {
      if (!config.privateKey) {
        throw new Error("La clé privée WireGuard est requise pour créer une nouvelle interface.");
      }
      await this.call("/interface/wireguard/add", {
        "listen-port": 13231,
        name: config.interfaceName,
        "private-key": config.privateKey
      });
    } else {
      await this.call("/interface/wireguard/set", {
        "listen-port": 13231,
        numbers: existingInterfaceId,
        ...(config.privateKey ? { "private-key": config.privateKey } : {})
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
          validityMinutes: batch.validityMinutes,
          passwordSecretRef: generatedCode.passwordSecretRef,
          planId: batch.planId,
          serverName: batch.serverName ?? "all",
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

  async configureHotspotUserLifecycle(
    username: string,
    validityMinutes: number | null
  ): Promise<HotspotUser> {
    const user = await this.findUserByName(username);
    const comment = reconcileVoucherLifecycleComment(user.comment, validityMinutes);
    if (comment === (user.comment ?? "")) return user;
    await this.call("/ip/hotspot/user/set", {
      comment,
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

  async getHotspotAntiTetheringState(): Promise<import("../../domain/router").HotspotAntiTetheringState> {
    const [ipv4Rows, ipv6Rows] = await Promise.all([
      this.call("/ip/firewall/filter/print"),
      this.call("/ipv6/firewall/filter/print").catch(() => [])
    ]);
    const managedPrefix = "TicketPro anti-tethering:";
    const managedIpv4 = ipv4Rows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
      && !isTruthy(pick(row, "disabled"))
    );
    const managedIpv6 = ipv6Rows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
      && !isTruthy(pick(row, "disabled"))
    );
    return {
      blockIpv4Ttl: managedIpv4.some((row) =>
        pick(row, "comment")?.startsWith(`${managedPrefix}IPv4 TTL `)
      ),
      blockIpv6: managedIpv6.some((row) =>
        pick(row, "comment")?.startsWith(`${managedPrefix}IPv6 `)
      ),
      managedRuleCount: managedIpv4.length + managedIpv6.length
    };
  }

  async listManagedHotspotBypasses(): Promise<import("../../domain/router").HotspotBypassBinding[]> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    const prefix = "TicketPro infrastructure:";
    return rows.flatMap((row) => {
      const comment = pick(row, "comment") ?? "";
      if (!comment.startsWith(prefix)) return [];
      const payload = comment.slice(prefix.length);
      const separatorIndex = payload.indexOf(" ");
      const id = (separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload).trim();
      const description = separatorIndex >= 0 ? payload.slice(separatorIndex + 1).trim() : "";
      const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
      if (!id || !macAddress) return [];
      return [{
        address: pick(row, "address") ?? "",
        comment: description,
        id,
        macAddress
      }];
    });
  }

  async upsertHotspotBypass(
    binding: import("../../domain/router").HotspotBypassBinding
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    return this.upsertManagedHotspotBinding("TicketPro infrastructure:", "bypassed", binding, true);
  }

  async removeHotspotBypass(id: string, macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    return this.removeManagedHotspotBinding("TicketPro infrastructure:", id, macAddress);
  }

  async listManagedHotspotBlockedDevices(): Promise<import("../../domain/router").HotspotBypassBinding[]> {
    return this.listManagedHotspotBindings("TicketPro blocked:");
  }

  async upsertHotspotBlockedDevice(
    binding: import("../../domain/router").HotspotBypassBinding
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    return this.upsertManagedHotspotBinding("TicketPro blocked:", "blocked", binding, false);
  }

  async removeHotspotBlockedDevice(id: string, macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    return this.removeManagedHotspotBinding("TicketPro blocked:", id, macAddress);
  }

  private async listManagedHotspotBindings(prefix: string): Promise<import("../../domain/router").HotspotBypassBinding[]> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    return rows.flatMap((row) => {
      const comment = pick(row, "comment") ?? "";
      if (!comment.startsWith(prefix)) return [];
      const payload = comment.slice(prefix.length);
      const separatorIndex = payload.indexOf(" ");
      const id = (separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload).trim();
      if (!id) return [];
      return [{
        address: pick(row, "address") ?? "",
        comment: separatorIndex >= 0 ? payload.slice(separatorIndex + 1).trim() : "",
        id,
        macAddress: normalizeOptionalMacAddress(pick(row, "mac-address")) ?? ""
      }];
    });
  }

  private async upsertManagedHotspotBinding(
    prefix: string,
    type: "blocked" | "bypassed",
    binding: import("../../domain/router").HotspotBypassBinding,
    requireMacAddress: boolean
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    const normalizedMacAddress = binding.macAddress.trim()
      ? normalizeMacAddress(binding.macAddress)
      : "";
    if (requireMacAddress && !normalizedMacAddress) {
      throw new RouterAdapterError("router_rejected", "Invalid MAC address");
    }
    const managedPrefix = `${prefix}${binding.id}`;
    const existing = rows.find((row) => pick(row, "comment")?.startsWith(managedPrefix))
      ?? rows.find((row) =>
        pick(row, "comment")?.startsWith(prefix)
        && (
          (normalizedMacAddress && normalizeOptionalMacAddress(pick(row, "mac-address")) === normalizedMacAddress)
          || (binding.address.trim() && pick(row, "address") === binding.address.trim())
        )
      );
    const matchesTarget = (row: RouterOsApiRow) =>
      (normalizedMacAddress
        && normalizeOptionalMacAddress(pick(row, "mac-address")) === normalizedMacAddress)
      || (binding.address.trim() && pick(row, "address") === binding.address.trim());
    const collidingBinding = rows.find((row) => row !== existing && matchesTarget(row));
    if (collidingBinding || (!existing && rows.some(matchesTarget))) {
      throw new RouterAdapterError("duplicate_user", "IP Binding already exists on RouterOS");
    }
    const existingId = existing ? pick(existing, ".id", "id") : null;
    const comment = `${managedPrefix} ${binding.comment}`.slice(0, 120);
    const params: Record<string, string> = {
      comment,
      server: "all",
      type
    };
    if (binding.address.trim()) params.address = binding.address.trim();
    if (normalizedMacAddress) params["mac-address"] = normalizedMacAddress;
    const unchanged = existing
      && pick(existing, "comment") === comment
      && pick(existing, "address") === (params.address ?? "")
      && (normalizeOptionalMacAddress(pick(existing, "mac-address")) ?? "") === normalizedMacAddress
      && pick(existing, "type") === type;
    if (unchanged) return { outcome: "already_present" };

    if (existingId) {
      await this.call("/ip/hotspot/ip-binding/set", { ...params, numbers: existingId });
    } else {
      await this.call("/ip/hotspot/ip-binding/add", params);
    }
    const verified = (await this.call("/ip/hotspot/ip-binding/print")).find((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
    );
    if (
      !verified
      || pick(verified, "type") !== type
      || pick(verified, "address") !== (params.address ?? "")
      || (normalizeOptionalMacAddress(pick(verified, "mac-address")) ?? "") !== normalizedMacAddress
    ) {
      throw new RouterAdapterError("router_rejected", "RouterOS did not confirm the IP Binding operation");
    }
    return { outcome: existingId ? "updated" : "created" };
  }

  private async removeManagedHotspotBinding(
    prefix: string,
    id: string,
    macAddress: string
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    const rows = await this.call("/ip/hotspot/ip-binding/print");
    const expectedPrefix = `${prefix}${id}`;
    const normalizedMacAddress = macAddress.trim() ? normalizeMacAddress(macAddress) : "";
    const existing = rows.find((row) => pick(row, "comment")?.startsWith(expectedPrefix))
      ?? rows.find((row) =>
        normalizedMacAddress
        && pick(row, "comment")?.startsWith(prefix)
        && normalizeOptionalMacAddress(pick(row, "mac-address")) === normalizedMacAddress
      );
    const bindingId = existing ? pick(existing, ".id", "id") : null;
    if (!bindingId) return { outcome: "not_found" };
    await this.call("/ip/hotspot/ip-binding/remove", { numbers: bindingId });
    const remaining = await this.call("/ip/hotspot/ip-binding/print");
    if (remaining.some((row) =>
      pick(row, ".id", "id") === bindingId
      || pick(row, "comment")?.startsWith(expectedPrefix)
    )) {
      throw new RouterAdapterError("router_rejected", "RouterOS kept the managed IP Binding after removal");
    }
    return { outcome: "removed" };
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
    const removedRuleIds = new Set<string>();
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
        await this.writeFirewallRuleWithTtlCompatibility(`${menu}/set`, {
          ...rule,
          numbers: existingId
        });
      } else {
        await this.writeFirewallRuleWithTtlCompatibility(`${menu}/add`, {
          ...rule,
          "place-before": firstForwardRuleId ?? null
        });
      }

      for (const duplicate of matches.slice(1)) {
        const duplicateId = pick(duplicate, ".id", "id");
        if (duplicateId) {
          await this.call(`${menu}/remove`, { numbers: duplicateId });
          removedRuleIds.add(duplicateId);
        }
      }
    }

    for (const row of managedRows) {
      const comment = pick(row, "comment") ?? "";
      if (desiredComments.has(comment)) continue;
      const ruleId = pick(row, ".id", "id");
      if (ruleId) {
        await this.call(`${menu}/remove`, { numbers: ruleId });
        removedRuleIds.add(ruleId);
      }
    }

    if (removedRuleIds.size > 0) {
      const remainingRows = await this.call(`${menu}/print`);
      const remainingRemovedRule = remainingRows.find((row) => {
        const ruleId = pick(row, ".id", "id");
        const comment = pick(row, "comment") ?? "";
        return (ruleId ? removedRuleIds.has(ruleId) : false)
          || (comment.startsWith(managedPrefix) && !desiredComments.has(comment));
      });
      if (remainingRemovedRule) {
        throw new RouterAdapterError(
          "router_rejected",
          "RouterOS kept a TicketPro anti-tethering rule after removal"
        );
      }
    }
  }

  private async writeFirewallRuleWithTtlCompatibility(
    command: string,
    params: Record<string, string | null>
  ): Promise<void> {
    try {
      await this.call(command, params);
    } catch (error) {
      const ttl = params.ttl;
      if (
        typeof ttl !== "string"
        || !/^\d{1,3}$/.test(ttl)
        || !isInvalidTtlArgumentError(error)
      ) {
        throw error;
      }

      await this.call(command, {
        ...params,
        ttl: `equal:${ttl}`
      });
    }
  }

  private async ensureRouterClock(): Promise<void> {
    const ntpClients = await this.call("/system/ntp/client/print");
    const ntpClient = firstRow(ntpClients);
    if (!isTruthy(pick(ntpClient, "enabled"))) {
      await this.call("/system/ntp/client/set", { enabled: "yes" });
    }

    const ntpServers = await this.call("/system/ntp/client/servers/print");
    if (ntpServers.length === 0) {
      await this.call("/system/ntp/client/servers/add", {
        address: "time.cloudflare.com"
      });
      await this.call("/system/ntp/client/servers/add", {
        address: "time.google.com"
      });
    }

    const clock = firstRow(await this.call("/system/clock/print"));
    if (!isPlausibleRouterDate(pick(clock, "date"))) {
      throw new RouterAdapterError(
        "router_rejected",
        "RouterOS clock is invalid; NTP was enabled, wait for synchronization and retry"
      );
    }
  }

  private async upsertSystemScript(name: string, source: string): Promise<void> {
    const scripts = await this.call("/system/script/print");
    const matches = scripts.filter((script) => pick(script, "name") === name);
    const existingId = pick(matches[0] ?? {}, ".id", "id");
    const params = {
      comment: `TicketPro managed voucher lifecycle v${VOUCHER_LIFECYCLE_ENGINE_VERSION}`,
      name,
      policy: "read,write,policy,test",
      source
    };
    if (existingId) {
      const existing = matches[0];
      if (
        pick(existing, "source") !== source
        || pick(existing, "comment") !== params.comment
        || pick(existing, "policy") !== params.policy
      ) {
        await this.call("/system/script/set", { ...params, numbers: existingId });
      }
    } else {
      await this.call("/system/script/add", params);
    }
    for (const duplicate of matches.slice(1)) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId) {
        await this.call("/system/script/remove", { numbers: duplicateId });
      }
    }
  }

  private async upsertLifecycleScheduler(): Promise<void> {
    const schedulers = await this.call("/system/scheduler/print");
    const matches = schedulers.filter((scheduler) =>
      pick(scheduler, "name") === VOUCHER_EXPIRATION_SCHEDULER
    );
    const existingId = pick(matches[0] ?? {}, ".id", "id");
    const params = {
      comment: `TicketPro managed voucher lifecycle v${VOUCHER_LIFECYCLE_ENGINE_VERSION}`,
      disabled: "no",
      interval: "1m",
      name: VOUCHER_EXPIRATION_SCHEDULER,
      "on-event": VOUCHER_EXPIRATION_SCRIPT,
      policy: "read,write,policy,test",
      "start-time": "startup"
    };
    if (existingId) {
      const existing = matches[0];
      if (
        isTruthy(pick(existing, "disabled"))
        || pick(existing, "interval") !== params.interval
        || pick(existing, "on-event") !== params["on-event"]
        || pick(existing, "comment") !== params.comment
        || pick(existing, "policy") !== params.policy
        || pick(existing, "start-time") !== params["start-time"]
      ) {
        await this.call("/system/scheduler/set", { ...params, numbers: existingId });
      }
    } else {
      await this.call("/system/scheduler/add", params);
    }
    for (const duplicate of matches.slice(1)) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId) {
        await this.call("/system/scheduler/remove", { numbers: duplicateId });
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

function isInvalidTtlArgumentError(error: unknown): boolean {
  return error instanceof RouterAdapterError
    && error.code === "router_rejected"
    && /invalid value for argument ttl/i.test(error.message);
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

async function userRowToHotspotUser(row: RouterOsApiRow): Promise<HotspotUser> {
  const username = pick(row, "name", "user") || "";
  const password = pick(row, "password");
  const downloadedBytes = parseInteger(pick(row, "bytes-out"));
  const uploadedBytes = parseInteger(pick(row, "bytes-in"));
  const limitBytesTotal = parseInteger(pick(row, "limit-bytes-total"));
  const uptime = pick(row, "uptime") || null;
  const limitUptime = pick(row, "limit-uptime") || null;
  const limitReached =
    (limitBytesTotal > 0 && downloadedBytes + uploadedBytes >= limitBytesTotal) ||
    (routerOsDurationToSeconds(limitUptime) > 0 &&
      routerOsDurationToSeconds(uptime) >= routerOsDurationToSeconds(limitUptime));
  const lifecycleExpired = pick(row, "comment")?.includes(";state=expired;") ?? false;

  return {
    comment: pick(row, "comment") || null,
    createdAt: new Date().toISOString(),
    id: pick(row, ".id") || pick(row, "id") || username,
    passwordSecretRef:
      password === username
        ? `secret://mikrotik/${username}/password`
        : password
          ? await protectTicketPassword(password)
          : `unavailable://mikrotik/${username}/password`,
    planId: pick(row, "profile") || "default",
    profileName: pick(row, "profile") || "default",
    status: lifecycleExpired || limitReached
      ? "expired"
      : isTruthy(pick(row, "disabled"))
        ? "disabled"
        : "available",
    username,
    downloadedBytes,
    uploadedBytes,
    uptime,
    limitUptime,
    limitBytesTotal: limitBytesTotal || null,
    macAddress: normalizeOptionalMacAddress(pick(row, "mac-address")),
    serverName: pick(row, "server") || "all"
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
  const weeks = value.match(/(\d+)w/);
  const days = value.match(/(\d+)d/);
  const hours = value.match(/(\d+)h/);
  const mins = value.match(/(\d+)m/);

  if (weeks) {
    minutes += Number(weeks[1]) * 7 * 1440;
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

export function buildVoucherLifecycleComment(
  validityMinutes: number | null | undefined,
  originalComment?: string | null
): string {
  if (!validityMinutes || validityMinutes <= 0) {
    return originalComment?.trim().slice(0, 120) ?? "";
  }

  const normalizedValidity = Math.max(1, Math.floor(validityMinutes));
  return `${VOUCHER_LIFECYCLE_COMMENT_PREFIX}validity=${normalizedValidity};expires=0;state=new;`;
}

export function reconcileVoucherLifecycleComment(
  currentComment: string | null | undefined,
  validityMinutes: number | null
): string {
  if (!validityMinutes || validityMinutes <= 0) {
    return currentComment?.startsWith(VOUCHER_LIFECYCLE_COMMENT_PREFIX)
      ? ""
      : currentComment?.trim().slice(0, 120) ?? "";
  }
  if (!currentComment?.startsWith(VOUCHER_LIFECYCLE_COMMENT_PREFIX)) {
    return buildVoucherLifecycleComment(validityMinutes, currentComment);
  }

  const expires = currentComment.match(/;expires=(\d+);/)?.[1] ?? "0";
  const state = currentComment.match(/;state=([a-z]+);/)?.[1] ?? "new";
  return `${VOUCHER_LIFECYCLE_COMMENT_PREFIX}validity=${Math.floor(validityMinutes)};expires=${expires};state=${state};`;
}

export function mergeVoucherLifecycleOnLogin(
  currentSource: string,
  knownScriptNames: ReadonlySet<string> = new Set()
): string {
  const withoutManagedBlock = currentSource
    .replace(
      new RegExp(
        `${escapeRegExp(VOUCHER_PROFILE_HANDLER_BEGIN)}[\\s\\S]*?${escapeRegExp(VOUCHER_PROFILE_HANDLER_END)}`,
        "g"
      ),
      ""
    )
    .trim();
  const preservedSource = knownScriptNames.has(withoutManagedBlock)
    ? `/system script run ${quoteRouterOsValue(withoutManagedBlock)};`
    : withoutManagedBlock;
  return [
    preservedSource,
    VOUCHER_PROFILE_HANDLER_BEGIN,
    buildVoucherOnLoginScript(),
    VOUCHER_PROFILE_HANDLER_END
  ].filter(Boolean).join("\r\n");
}

export function buildVoucherOnLoginScript(): string {
  return [
    ':local tpId [/ip hotspot user find where name=$user];',
    ':if ([:len $tpId] = 0) do={ :return };',
    ':local tpComment [/ip hotspot user get $tpId comment];',
    ':local tpMarker "TicketPro:v1;";',
    ':if ([:typeof [:find $tpComment $tpMarker]] = "nil") do={ :return };',
    ':local tpValidityKey "validity=";',
    ':local tpValidityStart [:find $tpComment $tpValidityKey];',
    ':if ([:typeof $tpValidityStart] = "nil") do={ :return };',
    ':set tpValidityStart ($tpValidityStart + [:len $tpValidityKey]);',
    ':local tpValidityEnd [:find $tpComment ";" $tpValidityStart];',
    ':if ([:typeof $tpValidityEnd] = "nil") do={ :return };',
    ':local tpValidity [:tonum [:pick $tpComment $tpValidityStart $tpValidityEnd]];',
    ':local tpExpiresKey "expires=";',
    ':local tpExpiresStart [:find $tpComment $tpExpiresKey];',
    ':if ([:typeof $tpExpiresStart] = "nil") do={ :return };',
    ':set tpExpiresStart ($tpExpiresStart + [:len $tpExpiresKey]);',
    ':local tpExpiresEnd [:find $tpComment ";" $tpExpiresStart];',
    ':if ([:typeof $tpExpiresEnd] = "nil") do={ :return };',
    ':local tpExpires [:tonum [:pick $tpComment $tpExpiresStart $tpExpiresEnd]];',
    ':if (($tpValidity > 0) && ($tpExpires = 0)) do={',
    '  :local tpNow [:tonsec [:timestamp]];',
    '  :local tpDeadline ($tpNow + ($tpValidity * 60000000000));',
    '  /ip hotspot user set $tpId comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpDeadline . ";state=active;");',
    '};'
  ].join("\r\n");
}

export function buildVoucherExpirationScript(): string {
  return [
    ':local tpNow [:tonsec [:timestamp]];',
    ':foreach tpId in=[/ip hotspot user find where comment~"TicketPro:v1;"] do={',
    '  :local tpComment [/ip hotspot user get $tpId comment];',
    '  :local tpValidityKey "validity=";',
    '  :local tpValidityStart [:find $tpComment $tpValidityKey];',
    '  :local tpExpiresKey "expires=";',
    '  :local tpExpiresStart [:find $tpComment $tpExpiresKey];',
    '  :if (([:typeof $tpValidityStart] != "nil") && ([:typeof $tpExpiresStart] != "nil")) do={',
    '    :set tpValidityStart ($tpValidityStart + [:len $tpValidityKey]);',
    '    :local tpValidityEnd [:find $tpComment ";" $tpValidityStart];',
    '    :set tpExpiresStart ($tpExpiresStart + [:len $tpExpiresKey]);',
    '    :local tpExpiresEnd [:find $tpComment ";" $tpExpiresStart];',
    '    :if (([:typeof $tpValidityEnd] != "nil") && ([:typeof $tpExpiresEnd] != "nil")) do={',
    '      :local tpValidity [:tonum [:pick $tpComment $tpValidityStart $tpValidityEnd]];',
    '      :local tpExpires [:tonum [:pick $tpComment $tpExpiresStart $tpExpiresEnd]];',
    '      :if (($tpExpires > 0) && ($tpNow >= $tpExpires)) do={',
    '        :local tpUser [/ip hotspot user get $tpId name];',
    '        :foreach tpActiveId in=[/ip hotspot active find where user=$tpUser] do={ /ip hotspot active remove $tpActiveId };',
    '        :foreach tpCookieId in=[/ip hotspot cookie find where user=$tpUser] do={ /ip hotspot cookie remove $tpCookieId };',
    '        /ip hotspot user set $tpId disabled=yes comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpExpires . ";state=expired;");',
    '        :log info ("TicketPro voucher expired: " . $tpUser);',
    '      };',
    '    };',
    '  };',
    '};'
  ].join("\r\n");
}

function isPlausibleRouterDate(value: string | undefined): boolean {
  if (!value) return false;
  const years = value.match(/\b(20\d{2})\b/g) ?? [];
  return years.some((year) => Number(year) >= 2024);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteRouterOsValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
