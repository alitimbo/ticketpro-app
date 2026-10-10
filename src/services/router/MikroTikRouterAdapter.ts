import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotDnsConfigurationResult,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUserLimits,
  HotspotUserProfileSettings,
  HotspotUsersBatchDraft,
  InterfaceTraffic,
  RouterConnectionMode,
  RouterConnectionTest,
  RouterDateTime,
  RouterErrorCode,
  RouterHealth,
  RouterManagedResourceInspectionOptions,
  RouterManagedResourceManifest,
  RouterManagedResourceObservation,
  RouterManagementAccountConfig,
  RouterManagementAccountResult,
  RouterManagementServicePolicy,
  RouterManagementServicePolicyResult,
  RouterSystemInfo,
  VoucherLifecycleEngineOptions,
  VoucherLifecycleEngineState
} from "../../domain/router";
import {
  extractVoucherBatchOwnershipSuffix,
  TicketCodeGenerator,
  voucherBelongsToBatch
} from "../tickets";
import {
  protectTicketPassword,
  resolveTicketPasswordValue
} from "../tickets/TicketPasswordService";
import type {
  HotspotUserBatchCreationProgress,
  HotspotUserBatchCreationResult,
  HotspotUserBatchRemovalResult,
  RouterAdapter
} from "./RouterAdapter";
import { RouterAdapterError } from "./RouterAdapterError";
import { readPlanQuotaMetadata, writePlanQuotaMetadata, type TicketProProfileMetadata } from "./PlanQuotaMetadata";
import { dataLimitMbToBytes, voucherQuotaMatches } from "../tickets/VoucherQuota";
import {
  TauriRouterOsApiTransport,
  type RouterOsApiConfig,
  type RouterOsApiBatchCommand,
  type RouterOsApiBatchResponse,
  type RouterOsApiRequest,
  type RouterOsApiRow,
  type RouterOsApiTransport
} from "./RouterOsApiTransport";

export type MikroTikRouterAdapterOptions = RouterOsApiConfig & {
  connectionMode?: RouterConnectionMode;
  transport?: RouterOsApiTransport;
};

const VOUCHER_LIFECYCLE_ENGINE_VERSION = 6;
const VOUCHER_EXPIRATION_SCRIPT = "ticketpro-voucher-expiration-v1";
const VOUCHER_EXPIRATION_SCHEDULER = "ticketpro-voucher-expiration-v1";
const VOUCHER_LIFECYCLE_COMMENT_PREFIX = "TicketPro:v1;";
const VOUCHER_PROFILE_HANDLER_BEGIN = "# TICKETPRO-LIFECYCLE-BEGIN v1";
const VOUCHER_PROFILE_HANDLER_END = "# TICKETPRO-LIFECYCLE-END v1";
const WIREGUARD_INTERFACE_COMMENT = "TicketPro managed:wireguard-interface:v1";
const WIREGUARD_ADDRESS_COMMENT = "TicketPro managed:wireguard-address:v1";
const WIREGUARD_PEER_COMMENT = "TicketPro managed:wireguard-gateway-peer:v1";
const WIREGUARD_ROUTE_COMMENT = "TicketPro managed:wireguard-route:v1";
const ROUTER_MANAGEMENT_GROUP = "ticketpro-api";
const ROUTER_MANAGEMENT_POLICIES = ["api", "policy", "read", "sensitive", "test", "write"] as const;
const HOTSPOT_USER_CREATE_BATCH_SIZE = 100;
const PASSWORD_RESOLUTION_CONCURRENCY = 16;
const HOTSPOT_USER_TARGETED_READ_MAX = 20;
const HOTSPOT_USER_VERIFICATION_PROPERTIES = [
  ".id",
  "name",
  "disabled",
  "profile",
  "comment",
  "server",
  "uptime",
  "limit-uptime",
  "bytes-in",
  "bytes-out",
  "limit-bytes-total",
  "mac-address"
].join(",");

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
    const [rows, profileRows] = await Promise.all([
      this.call("/ip/hotspot/print"),
      this.call("/ip/hotspot/profile/print")
    ]);
    const dnsByProfile = new Map(
      profileRows.map((profile) => [
        pick(profile, "name") ?? "",
        pick(profile, "dns-name") ?? ""
      ])
    );

    return rows.map((row) => {
      const profileName = pick(row, "profile") || "default";
      return {
        addressPool: pick(row, "address-pool") || "default",
        dnsName: dnsByProfile.get(profileName) || "",
        id: pick(row, ".id") || pick(row, "id") || pick(row, "name") || "hotspot",
        interfaceName: pick(row, "interface") || "inconnue",
        isEnabled: !isTruthy(pick(row, "disabled")),
        name: pick(row, "name") || "Hotspot",
        profileName
      };
    });
  }

  async getHotspotPlans(): Promise<HotspotPlan[]> {
    const rows = await this.call("/ip/hotspot/user/profile/print");
    return rows.map((row) => profileRowToPlan(row));
  }

  async ensureVoucherLifecycleEngine(
    options: VoucherLifecycleEngineOptions = {}
  ): Promise<VoucherLifecycleEngineState> {
    const resource = firstRow(await this.call("/system/resource/print"));
    const routerOsVersion = pick(resource, "version") ?? "";
    const majorVersion = Number.parseInt(routerOsVersion, 10);
    if (!Number.isFinite(majorVersion) || majorVersion < 7) {
      throw new RouterAdapterError(
        "router_rejected",
        "TicketPro voucher lifecycle requires RouterOS 7 or newer"
      );
    }

    await this.assertVoucherAutomationAllowedByDeviceMode(routerOsVersion);
    await this.ensureRouterClock();
    await this.upsertSystemScript(
      VOUCHER_EXPIRATION_SCRIPT,
      buildVoucherExpirationScript()
    );
    await this.upsertLifecycleScheduler();

    const [profiles, systemScripts, hotspotServers, hotspotProfiles] = await Promise.all([
      this.call("/ip/hotspot/user/profile/print"),
      this.call("/system/script/print"),
      this.call("/ip/hotspot/print"),
      this.call("/ip/hotspot/profile/print")
    ]);
    const systemScriptNames = new Set(
      systemScripts.map((script) => pick(script, "name")).filter((name): name is string => Boolean(name))
    );
    const managedProfileNames = normalizeManagedProfileNames(options.managedProfileNames);
    let managedProfileCount = 0;
    for (const profile of profiles) {
      const profileId = pick(profile, ".id", "id");
      const profileName = pick(profile, "name");
      if (!profileId || !profileName) continue;
      const currentOnLogin = pick(profile, "on-login") ?? "";
      if (!managedProfileNames.has(profileName)) {
        // `managedProfileNames` is the set that this call may repair, not an
        // exclusive catalog. Removing TicketPro from every other profile here
        // made a router save or a generation for one plan disable the
        // lifecycle handlers of all other plans.
        continue;
      }
      const nextOnLogin = mergeVoucherLifecycleOnLogin(currentOnLogin, systemScriptNames);
      const currentMacCookieTimeout = pick(profile, "mac-cookie-timeout") ?? "";
      const nextMacCookieTimeout = resolveMacCookieTimeout(
        currentMacCookieTimeout,
        pick(profile, "session-timeout")
      );
      if (
        nextOnLogin !== currentOnLogin
        || !isTruthy(pick(profile, "add-mac-cookie"))
        || nextMacCookieTimeout !== currentMacCookieTimeout
      ) {
        await this.call("/ip/hotspot/user/profile/set", {
          "add-mac-cookie": "yes",
          "mac-cookie-timeout": nextMacCookieTimeout,
          numbers: profileId,
          "on-login": nextOnLogin
        });
      }
      managedProfileCount += 1;
    }

    const usedHotspotProfileNames = new Set(
      hotspotServers
        .map((server) => pick(server, "profile"))
        .filter((name): name is string => Boolean(name))
    );
    for (const profile of hotspotProfiles) {
      const profileName = pick(profile, "name");
      const profileId = pick(profile, ".id", "id");
      if (!profileName || !profileId || !usedHotspotProfileNames.has(profileName)) continue;
      const currentLoginBy = pick(profile, "login-by") ?? "";
      const nextLoginBy = mergeHotspotLoginBy(currentLoginBy);
      if (nextLoginBy !== currentLoginBy) {
        await this.call("/ip/hotspot/profile/set", {
          "login-by": nextLoginBy,
          numbers: profileId
        });
      }
    }

    const clock = firstRow(await this.call("/system/clock/print"));
    return {
      clockReady: isPlausibleRouterDate(pick(clock, "date")),
      engineVersion: VOUCHER_LIFECYCLE_ENGINE_VERSION,
      managedProfileCount,
      schedulerEnabled: true
    };
  }

  async inspectManagedResources(
    options: RouterManagedResourceInspectionOptions = {}
  ): Promise<RouterManagedResourceManifest> {
    const managedProfileNames = Array.from(
      normalizeManagedProfileNames(options.managedHotspotProfileNames)
    ).sort();
    const authorizedManagementCidrs = Array.from(new Set(
      (options.authorizedManagementCidrs ?? []).map((cidr) => cidr.trim()).filter(Boolean)
    )).sort();
    const managementUsername = options.managementUsername?.trim() || null;
    const wireguardInterfaceName = options.wireguardInterfaceName?.trim() || null;
    const [
      resourceRows,
      scriptRows,
      schedulerRows,
      userProfileRows,
      hotspotRows,
      hotspotProfileRows,
      ipv4FilterRows,
      ipv4MangleRows,
      ipv6FilterRows,
      bindingRows,
      wireguardRows,
      wireguardPeerRows,
      addressRows,
      routeRows,
      ntpClientRows,
      ntpServerRows,
      managementUserRows,
      managementGroupRows,
      managementServiceRows
    ] = await Promise.all([
      this.call("/system/resource/print"),
      this.call("/system/script/print"),
      this.call("/system/scheduler/print"),
      this.call("/ip/hotspot/user/profile/print"),
      this.call("/ip/hotspot/print"),
      this.call("/ip/hotspot/profile/print"),
      this.call("/ip/firewall/filter/print"),
      this.call("/ip/firewall/mangle/print"),
      this.call("/ipv6/firewall/filter/print").catch(() => []),
      this.call("/ip/hotspot/ip-binding/print"),
      wireguardInterfaceName ? this.call("/interface/wireguard/print") : Promise.resolve([]),
      wireguardInterfaceName ? this.call("/interface/wireguard/peers/print") : Promise.resolve([]),
      wireguardInterfaceName ? this.call("/ip/address/print") : Promise.resolve([]),
      wireguardInterfaceName ? this.call("/ip/route/print") : Promise.resolve([]),
      this.call("/system/ntp/client/print"),
      this.call("/system/ntp/client/servers/print"),
      managementUsername ? this.call("/user/print") : Promise.resolve([]),
      managementUsername ? this.call("/user/group/print") : Promise.resolve([]),
      authorizedManagementCidrs.length > 0 ? this.call("/ip/service/print") : Promise.resolve([])
    ]);

    const resources: RouterManagedResourceObservation[] = [];
    const warnings: string[] = [];
    const expectedScriptSource = buildVoucherExpirationScript();
    const expectedLifecycleComment = `TicketPro managed voucher lifecycle v${VOUCHER_LIFECYCLE_ENGINE_VERSION}`;
    const lifecycleScripts = scriptRows.filter(
      (row) => pick(row, "name") === VOUCHER_EXPIRATION_SCRIPT
    );
    resources.push({
      attributes: {
        engineVersion: VOUCHER_LIFECYCLE_ENGINE_VERSION,
        invalid: lifecycleScripts.length === 1
          && isTruthy(pick(lifecycleScripts[0], "invalid")),
        matchesExpectedComment: lifecycleScripts.length === 1
          && pick(lifecycleScripts[0], "comment") === expectedLifecycleComment,
        matchesExpectedPolicy: lifecycleScripts.length === 1
          && pick(lifecycleScripts[0], "policy") === "read,write,policy,test",
        matchesExpectedSource: lifecycleScripts.length === 1
          && pick(lifecycleScripts[0], "source") === expectedScriptSource,
        name: VOUCHER_EXPIRATION_SCRIPT
      },
      key: "system-script:voucher-lifecycle",
      kind: "voucher_script",
      matchCount: lifecycleScripts.length,
      ownership: "ticketpro",
      state: singletonState(lifecycleScripts, (row) =>
        pick(row, "comment") === expectedLifecycleComment
        && pick(row, "policy") === "read,write,policy,test"
        && pick(row, "source") === expectedScriptSource
        && !isTruthy(pick(row, "invalid"))
      )
    });

    const lifecycleSchedulers = schedulerRows.filter(
      (row) => pick(row, "name") === VOUCHER_EXPIRATION_SCHEDULER
    );
    resources.push({
      attributes: {
        enabled: lifecycleSchedulers.length === 1
          && !isTruthy(pick(lifecycleSchedulers[0], "disabled")),
        invalid: lifecycleSchedulers.length === 1
          && isTruthy(pick(lifecycleSchedulers[0], "invalid")),
        interval: lifecycleSchedulers.length === 1
          ? pick(lifecycleSchedulers[0], "interval") ?? null
          : null,
        name: VOUCHER_EXPIRATION_SCHEDULER
      },
      key: "system-scheduler:voucher-lifecycle",
      kind: "voucher_scheduler",
      matchCount: lifecycleSchedulers.length,
      ownership: "ticketpro",
      state: singletonState(lifecycleSchedulers, (row) =>
        !isTruthy(pick(row, "disabled"))
        && pick(row, "interval") === "1m"
        && pick(row, "on-event") === VOUCHER_EXPIRATION_SCRIPT
        && pick(row, "comment") === expectedLifecycleComment
        && !isTruthy(pick(row, "invalid"))
      )
    });

    const desiredProfileSet = new Set(managedProfileNames);
    for (const profileName of managedProfileNames) {
      const matches = userProfileRows.filter((row) => pick(row, "name") === profileName);
      resources.push({
        attributes: {
          addMacCookie: matches.length === 1 && isTruthy(pick(matches[0], "add-mac-cookie")),
          lifecycleHandler: matches.length === 1 && hasVoucherLifecycleHandler(pick(matches[0], "on-login") ?? ""),
          profileName
        },
        key: `hotspot-user-profile-extension:${profileName}`,
        kind: "hotspot_user_profile_extension",
        matchCount: matches.length,
        ownership: "shared",
        state: singletonState(matches, (row) =>
          isTruthy(pick(row, "add-mac-cookie"))
          && hasVoucherLifecycleHandler(pick(row, "on-login") ?? "")
        )
      });
    }

    for (const profile of userProfileRows) {
      const profileName = pick(profile, "name") ?? "unknown";
      if (
        desiredProfileSet.has(profileName)
        || !hasVoucherLifecycleHandler(pick(profile, "on-login") ?? "")
      ) continue;
      resources.push({
        attributes: { lifecycleHandler: true, profileName, unexpected: true },
        key: `hotspot-user-profile-extension:unexpected:${profileName}`,
        kind: "hotspot_user_profile_extension",
        matchCount: 1,
        ownership: profileName === "default" ? "external" : "shared",
        state: "drift"
      });
      warnings.push(
        `Le profil Hotspot ${profileName} contient une ancienne extension TicketPro non revendiquée. Aucun nettoyage automatique n'a été effectué.`
      );
    }

    const usedHotspotProfiles = new Set(
      hotspotRows
        .filter((row) => !isTruthy(pick(row, "disabled")))
        .map((row) => pick(row, "profile"))
        .filter((name): name is string => Boolean(name))
    );
    for (const profileName of Array.from(usedHotspotProfiles).sort()) {
      const matches = hotspotProfileRows.filter((row) => pick(row, "name") === profileName);
      resources.push({
        attributes: {
          dnsName: matches.length === 1 ? pick(matches[0], "dns-name") ?? "" : "",
          loginBy: matches.length === 1 ? pick(matches[0], "login-by") ?? "" : "",
          profileName
        },
        key: `hotspot-profile-extension:${profileName}`,
        kind: "hotspot_profile_extension",
        matchCount: matches.length,
        ownership: "shared",
        state: singletonState(matches, (row) =>
          mergeHotspotLoginBy(pick(row, "login-by") ?? "") === pick(row, "login-by")
        )
      });
      resources.push({
        attributes: {
          dnsName: matches.length === 1 ? pick(matches[0], "dns-name") ?? "" : "",
          profileName
        },
        key: `hotspot-dns:${profileName}`,
        kind: "hotspot_dns",
        matchCount: matches.length,
        ownership: "shared",
        state: singletonState(matches, (row) => Boolean(pick(row, "dns-name")?.trim()))
      });
    }

    appendManagedCommentResources(resources, [
      ...ipv4FilterRows.map((row) => ({ menu: "ipv4-filter", row })),
      ...ipv4MangleRows.map((row) => ({ menu: "ipv4-mangle", row })),
      ...ipv6FilterRows.map((row) => ({ menu: "ipv6-filter", row }))
    ], "TicketPro anti-tethering:", "firewall_rule");
    appendManagedCommentResources(
      resources,
      bindingRows.map((row) => ({ menu: "hotspot-ip-binding", row })),
      "TicketPro infrastructure:",
      "ip_binding"
    );
    appendManagedCommentResources(
      resources,
      bindingRows.map((row) => ({ menu: "hotspot-ip-binding", row })),
      "TicketPro blocked:",
      "ip_binding"
    );

    const ntpClient = firstRow(ntpClientRows);
    resources.push({
      attributes: {
        enabled: isTruthy(pick(ntpClient, "enabled")),
        serverCount: ntpServerRows.length,
        status: pick(ntpClient, "status") ?? null
      },
      key: "ntp:router-clock",
      kind: "ntp_configuration",
      matchCount: ntpClientRows.length,
      ownership: "shared",
      state: singletonState(ntpClientRows, (row) =>
        isTruthy(pick(row, "enabled")) && ntpServerRows.length > 0
      )
    });

    if (managementUsername) {
      const requiredPolicies = ["api", "policy", "read", "sensitive", "test", "write"];
      const groupName = "ticketpro-api";
      const groups = managementGroupRows.filter((row) => pick(row, "name") === groupName);
      resources.push({
        attributes: {
          groupName,
          requiredPolicies: requiredPolicies.join(",")
        },
        key: `management-account-group:${groupName}`,
        kind: "management_account",
        matchCount: groups.length,
        ownership: "ticketpro",
        state: singletonState(groups, (row) =>
          requiredPolicies.every((policy) => csvValues(pick(row, "policy") ?? "").has(policy))
        )
      });
      const users = managementUserRows.filter((row) => pick(row, "name") === managementUsername);
      resources.push({
        attributes: {
          disabled: users.length === 1 && isTruthy(pick(users[0], "disabled")),
          group: users.length === 1 ? pick(users[0], "group") ?? null : null,
          username: managementUsername
        },
        key: `management-account:${managementUsername}`,
        kind: "management_account",
        matchCount: users.length,
        ownership: "ticketpro",
        state: singletonState(users, (row) =>
          !isTruthy(pick(row, "disabled")) && pick(row, "group") === groupName
        )
      });
    }

    if (authorizedManagementCidrs.length > 0) {
      for (const service of managementServiceRows.filter(
        (row) => !isTruthy(pick(row, "dynamic"))
      )) {
        const name = pick(service, "name") ?? "unknown";
        const disabled = isTruthy(pick(service, "disabled"));
        const addresses = csvValues(pick(service, "address") ?? "");
        const requiredEnabled = name === "api" || name === "winbox";
        const restricted = authorizedManagementCidrs.every((cidr) => addresses.has(cidr));
        const expected = requiredEnabled ? !disabled && restricted : disabled || restricted;
        resources.push({
          attributes: {
            address: pick(service, "address") ?? "",
            disabled,
            name,
            port: pick(service, "port") ?? null,
            requiredEnabled,
            restricted
          },
          key: `management-service:${name}`,
          kind: "management_service",
          matchCount: 1,
          ownership: "shared",
          state: expected ? "present" : "drift"
        });
      }
    }

    if (wireguardInterfaceName) {
      const interfaces = wireguardRows.filter(
        (row) => pick(row, "name") === wireguardInterfaceName
      );
      resources.push({
        attributes: {
          interfaceName: wireguardInterfaceName,
          running: interfaces.length === 1 && !isTruthy(pick(interfaces[0], "disabled"))
        },
        key: `wireguard-interface:${wireguardInterfaceName}`,
        kind: "wireguard_interface",
        matchCount: interfaces.length,
        ownership: "ticketpro",
        state: singletonState(interfaces, (row) => !isTruthy(pick(row, "disabled")))
      });
      const peers = wireguardPeerRows.filter(
        (row) => pick(row, "interface") === wireguardInterfaceName
      );
      resources.push({
        attributes: {
          interfaceName: wireguardInterfaceName,
          peerCount: peers.length
        },
        key: `wireguard-peer:${wireguardInterfaceName}:gateway`,
        kind: "wireguard_peer",
        matchCount: peers.length,
        ownership: "ticketpro",
        state: peers.length === 0 ? "missing" : peers.length === 1 ? "present" : "duplicate"
      });
      const addresses = addressRows.filter(
        (row) => pick(row, "interface") === wireguardInterfaceName
      );
      resources.push({
        attributes: {
          address: addresses.length === 1 ? pick(addresses[0], "address") ?? null : null,
          interfaceName: wireguardInterfaceName
        },
        key: `wireguard-address:${wireguardInterfaceName}`,
        kind: "wireguard_address",
        matchCount: addresses.length,
        ownership: "ticketpro",
        state: addresses.length === 0 ? "missing" : addresses.length === 1 ? "present" : "duplicate"
      });
      const routes = routeRows.filter((row) =>
        pick(row, "gateway") === wireguardInterfaceName
        && (pick(row, "comment") === WIREGUARD_ROUTE_COMMENT
          || pick(row, "comment") === "TicketPro WireGuard"
          || pick(row, "comment") === "TicketPro WireGuard multi-organisation")
      );
      resources.push({
        attributes: {
          destination: routes.length === 1 ? pick(routes[0], "dst-address") ?? null : null,
          interfaceName: wireguardInterfaceName
        },
        key: `wireguard-route:${wireguardInterfaceName}`,
        kind: "wireguard_route",
        matchCount: routes.length,
        ownership: "ticketpro",
        state: routes.length === 0 ? "missing" : routes.length === 1 ? "present" : "duplicate"
      });
    }

    return {
      capturedAt: new Date().toISOString(),
      desired: {
        authorizedManagementCidrs,
        managementUsername,
        managedHotspotProfileNames: managedProfileNames,
        wireguardInterfaceName
      },
      resources: resources.sort((left, right) => left.key.localeCompare(right.key)),
      routerOsVersion: pick(firstRow(resourceRows), "version") ?? "unknown",
      schemaVersion: 1,
      warnings
    };
  }

  async upsertManagementAccount(
    config: RouterManagementAccountConfig
  ): Promise<RouterManagementAccountResult> {
    const username = normalizeRouterOsIdentifier(config.username, "nom du compte");
    const groupName = normalizeRouterOsIdentifier(
      config.groupName?.trim() || ROUTER_MANAGEMENT_GROUP,
      "nom du groupe"
    );
    const password = config.password;
    if (password.length < 16 || /[\r\n\0]/.test(password)) {
      throw new RouterAdapterError(
        "router_rejected",
        "The dedicated RouterOS password must contain at least 16 safe characters"
      );
    }

    const [groupRows, userRows] = await Promise.all([
      this.call("/user/group/print"),
      this.call("/user/print")
    ]);
    const groups = groupRows.filter((row) => pick(row, "name") === groupName);
    const group = groups[0];
    const groupId = pick(group ?? {}, ".id", "id");
    const groupAlreadyCompatible = Boolean(group) && ROUTER_MANAGEMENT_POLICIES.every(
      (policy) => csvValues(pick(group, "policy") ?? "").has(policy)
    );
    if (group && !groupAlreadyCompatible && !config.adoptExisting) {
      throw new RouterAdapterError(
        "router_rejected",
        `RouterOS group ${groupName} already exists outside the TicketPro policy`
      );
    }
    const groupParams = {
      name: groupName,
      policy: ROUTER_MANAGEMENT_POLICIES.join(",")
    };
    if (groupId) {
      await this.call("/user/group/set", { ...groupParams, numbers: groupId });
    } else {
      await this.call("/user/group/add", groupParams);
    }

    const users = userRows.filter((row) => pick(row, "name") === username);
    const user = users[0];
    const userId = pick(user ?? {}, ".id", "id");
    if (user && pick(user, "group") !== groupName && !config.adoptExisting) {
      throw new RouterAdapterError(
        "router_rejected",
        `RouterOS user ${username} already exists in another group`
      );
    }
    const userParams = {
      disabled: "no",
      group: groupName,
      name: username,
      password
    };
    if (userId) {
      await this.call("/user/set", { ...userParams, numbers: userId });
    } else {
      await this.call("/user/add", userParams);
    }

    const [verifiedGroups, verifiedUsers] = await Promise.all([
      this.call("/user/group/print"),
      this.call("/user/print")
    ]);
    const verifiedGroup = verifiedGroups.find((row) => pick(row, "name") === groupName);
    const verifiedUser = verifiedUsers.find((row) => pick(row, "name") === username);
    if (
      !verifiedGroup
      || !ROUTER_MANAGEMENT_POLICIES.every(
        (policy) => csvValues(pick(verifiedGroup, "policy") ?? "").has(policy)
      )
      || !verifiedUser
      || pick(verifiedUser, "group") !== groupName
      || isTruthy(pick(verifiedUser, "disabled"))
    ) {
      throw new RouterAdapterError(
        "router_rejected",
        "RouterOS did not confirm the dedicated TicketPro management account"
      );
    }

    return {
      action: userId ? "updated" : "created",
      groupName,
      username
    };
  }

  async applyManagementServicePolicy(
    policy: RouterManagementServicePolicy
  ): Promise<RouterManagementServicePolicyResult> {
    if (!policy.currentPathConfirmed) {
      throw new RouterAdapterError(
        "router_rejected",
        "The current RouterOS access path must be confirmed before service hardening"
      );
    }
    const authorizedCidrs = normalizeAuthorizedCidrs(policy.authorizedCidrs);
    const address = authorizedCidrs.join(",");
    const serviceRows = await this.call("/ip/service/print");
    const restrictedServices: string[] = [];
    const disabledServices: string[] = [];
    const disabledWhenUnused = new Set(["api-ssl", "ftp", "telnet", "www", "www-ssl"]);

    for (const service of serviceRows.filter((row) => !isTruthy(pick(row, "dynamic")))) {
      const name = pick(service, "name");
      const serviceId = pick(service, ".id", "id");
      if (!name || !serviceId) continue;
      if (name === "api" || name === "winbox") {
        await this.call("/ip/service/set", {
          address,
          disabled: "no",
          numbers: serviceId
        });
        restrictedServices.push(name);
        continue;
      }
      if (policy.disableUnusedServices && disabledWhenUnused.has(name)) {
        await this.call("/ip/service/set", { disabled: "yes", numbers: serviceId });
        disabledServices.push(name);
        continue;
      }
      if (!isTruthy(pick(service, "disabled"))) {
        await this.call("/ip/service/set", { address, numbers: serviceId });
        restrictedServices.push(name);
      }
    }

    const verifiedServices = await this.call("/ip/service/print");
    for (const name of restrictedServices) {
      const service = verifiedServices.find((row) => pick(row, "name") === name);
      const addresses = csvValues(pick(service ?? {}, "address") ?? "");
      if (
        !service
        || isTruthy(pick(service, "disabled")) && (name === "api" || name === "winbox")
        || !authorizedCidrs.every((cidr) => addresses.has(cidr))
      ) {
        throw new RouterAdapterError(
          "router_rejected",
          `RouterOS did not confirm the restricted ${name} service`
        );
      }
    }
    for (const name of disabledServices) {
      const service = verifiedServices.find((row) => pick(row, "name") === name);
      if (!service || !isTruthy(pick(service, "disabled"))) {
        throw new RouterAdapterError(
          "router_rejected",
          `RouterOS did not confirm the disabled ${name} service`
        );
      }
    }

    return {
      disabledServices: disabledServices.sort(),
      restrictedServices: restrictedServices.sort()
    };
  }

  async createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan> {
    const profileName = plan.profileName || slugify(plan.name);

    await this.call("/ip/hotspot/user/profile/add", {
      "add-mac-cookie": "yes",
      // MAC Cookie is a reconnection preference, never TicketPro validity.
      "mac-cookie-timeout": "3d",
      name: profileName,
      "on-login": writePlanQuotaMetadata(mergeVoucherLifecycleOnLogin(""), planMetadata(plan)),
      "rate-limit": buildRateLimit(plan),
      "shared-users": String(plan.sharedUsers)
    });

    const created = await this.findPlanByProfileName(profileName);
    if (created.dataLimitSource !== "routeros" || created.dataLimitMb !== plan.dataLimitMb) {
      throw new RouterAdapterError("router_rejected", "RouterOS n'a pas confirmé le quota du plan.");
    }
    return created;
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
      "on-login": writePlanQuotaMetadata(mergeVoucherLifecycleOnLogin(
        pick(currentProfile ?? {}, "on-login") ?? "",
        new Set(
          systemScripts.map((script) => pick(script, "name")).filter((name): name is string => Boolean(name))
        )
      ), planMetadata(next)),
      "rate-limit": buildRateLimit(next),
      "shared-users": String(next.sharedUsers)
    });

    const updated = await this.findPlanById(current.id);
    if (updated.dataLimitSource !== "routeros" || updated.dataLimitMb !== next.dataLimitMb) {
      throw new RouterAdapterError("router_rejected", "RouterOS n'a pas confirmé le quota du plan.");
    }
    // A plan change is confirmed only once RouterOS returns the written values.
    if (
      updated.profileName !== next.profileName
      || updated.sharedUsers !== next.sharedUsers
      || updated.durationMinutes !== next.durationMinutes
    ) {
      throw new RouterAdapterError("router_rejected", "RouterOS n'a pas confirmé la modification du profil.");
    }
    return updated;
  }

  async deleteHotspotPlan(planId: string): Promise<void> {
    const plan = await this.findPlanById(planId);
    const routerUsers = await this.call("/ip/hotspot/user/print");
    const linkedUsers = routerUsers.filter(
      (user) => pick(user, "profile") === plan.profileName
    );
    if (linkedUsers.length > 0) {
      throw new RouterAdapterError(
        "router_rejected",
        `Hotspot profile is still used by ${linkedUsers.length} user(s)`
      );
    }

    await this.call("/ip/hotspot/user/profile/remove", { numbers: plan.id });
    const remainingProfiles = await this.call("/ip/hotspot/user/profile/print");
    if (remainingProfiles.some((profile) =>
      pick(profile, ".id", "id") === plan.id
      || pick(profile, "name") === plan.profileName
    )) {
      throw new RouterAdapterError(
        "router_rejected",
        "RouterOS kept the Hotspot profile after removal"
      );
    }
  }

  async listHotspotUsers(): Promise<HotspotUser[]> {
    const rows = await this.call("/ip/hotspot/user/print");
    return Promise.all(rows.map((row) => userRowToHotspotUser(row)));
  }

  async listTicketProManagedVoucherUsernames(): Promise<string[]> {
    const [userRows, bindingRows] = await Promise.all([
      this.call("/ip/hotspot/user/print", { ".proplist": ".id,name,comment" }),
      this.call("/ip/hotspot/ip-binding/print", { ".proplist": ".id,comment" })
    ]);
    const usernames = new Set<string>();
    for (const row of userRows) {
      if (!pick(row, "comment")?.startsWith(VOUCHER_LIFECYCLE_COMMENT_PREFIX)) continue;
      const username = pick(row, "name", "user")?.trim();
      if (username) usernames.add(username);
    }
    for (const row of bindingRows) {
      const username = managedVoucherBindingUsername(row);
      if (username) usernames.add(username);
    }
    return Array.from(usernames);
  }

  async listHotspotUsersForVerification(): Promise<HotspotUser[]> {
    const rows = await this.call("/ip/hotspot/user/print", {
      ".proplist": HOTSPOT_USER_VERIFICATION_PROPERTIES
    });
    return Promise.all(rows.map((row) => userRowToHotspotUser(row)));
  }

  /**
   * Read for live views, without passwords (so no local secret protection per
   * row). Up to HOTSPOT_USER_TARGETED_READ_MAX users, one filtered print per
   * username over a single connection; beyond that, one lean print of all
   * users is cheaper than many sequential round trips on a remote link.
   * Any partial failure rejects the whole read so that a missing row is never
   * mistaken for a missing voucher.
   */
  async listHotspotUsersByUsernames(usernames: string[]): Promise<HotspotUser[]> {
    const unique = Array.from(new Set(usernames.map((username) => username.trim()).filter(Boolean)));
    if (unique.length === 0) return [];
    if (unique.length > HOTSPOT_USER_TARGETED_READ_MAX) {
      return Array.from((await this.readRequestedUsers(unique)).values());
    }
    const response = await this.callBatch(unique.map((username) => ({
      command: "/ip/hotspot/user/print",
      params: { ".proplist": HOTSPOT_USER_VERIFICATION_PROPERTIES },
      queries: { name: username }
    })));
    const failure = response.connectionError
      ?? response.error
      ?? response.results.find((result) => result.error)?.error
      ?? (response.results.length < unique.length ? "RouterOS batch interrupted" : null);
    if (failure) throw normalizeMikroTikError(failure);
    const users: HotspotUser[] = [];
    for (const [position, result] of response.results.entries()) {
      const row = result.rows.find((item) => pick(item, "name", "user") === unique[position]);
      if (row) users.push(await userRowToHotspotUser(row));
    }
    return users;
  }

  async listHotspotUsernames(): Promise<Array<{ username: string }>> {
    const rows = await this.call("/ip/hotspot/user/print", { ".proplist": "name" });
    return rows
      .map((row) => pick(row, "name", "user")?.trim())
      .filter((username): username is string => Boolean(username))
      .map((username) => ({ username }));
  }

  async findHotspotUser(username: string): Promise<HotspotUser | null> {
    const rows = await this.query("/ip/hotspot/user/print", { name: username });
    const row = rows.find((item) => pick(item, "name") === username);
    return row ? userRowToHotspotUser(row) : null;
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

    const created = await this.findUserByName(user.username);
    if (!voucherQuotaMatches(created, user.limitBytesTotal) || !voucherUsageLimitMatches(created, user.limitUptime)) {
      await this.disableHotspotUser(user.username);
      await this.disconnectActiveUser(user.username);
      throw new RouterAdapterError("router_rejected", "Le quota relu sur RouterOS ne correspond pas au quota demandé. Le voucher est bloqué.");
    }
    return created;
  }

  async createHotspotUsersExactBatch(
    users: HotspotUserDraft[],
    onProgress?: (progress: HotspotUserBatchCreationProgress) => void
  ): Promise<HotspotUserBatchCreationResult[]> {
    if (users.length === 0) return [];

    const usernames = users.map((user) => user.username.trim());
    if (usernames.some((username) => !username)) {
      throw new RouterAdapterError("router_rejected", "A voucher username is empty");
    }
    if (new Set(usernames).size !== usernames.length) {
      throw new RouterAdapterError("duplicate_user", "The voucher batch contains duplicate usernames");
    }

    // Read the live profile catalog once for the whole commercial batch.
    const plans = await this.getHotspotPlans();
    const prepared = await mapWithConcurrency(
      users,
      PASSWORD_RESOLUTION_CONCURRENCY,
      async (user) => {
        const plan = plans.find(
          (candidate) => candidate.id === user.planId || candidate.profileName === user.planId
        );
        if (!plan) {
          throw new RouterAdapterError("hotspot_not_found", "Hotspot profile not found");
        }
        return {
          command: hotspotUserAddCommand(user, plan.profileName, await resolveTicketPassword(user)),
          user,
          username: user.username.trim()
        };
      }
    );
    const errors = new Map<string, string>();
    const confirmed = new Map<string, HotspotUser>();
    let remaining = prepared;
    let processedCommands = 0;

    onProgress?.({ completed: 0, phase: "creating", total: users.length });

    // One recovery pass is enough: after a transport interruption we first
    // read RouterOS, then replay only usernames that are authoritatively absent.
    for (let pass = 0; pass < 2 && remaining.length > 0; pass += 1) {
      let connectionInterrupted = false;
      for (const commandGroup of chunkArray(remaining, HOTSPOT_USER_CREATE_BATCH_SIZE)) {
        const response = await this.callBatch(commandGroup.map((entry) => entry.command));
        response.results.forEach((result, index) => {
          const entry = commandGroup[index];
          if (entry && result.error) errors.set(entry.username, result.error);
        });
        if (response.connectionError) {
          const uncertainIndex = Math.min(response.completedCount, commandGroup.length - 1);
          for (let index = uncertainIndex; index < commandGroup.length; index += 1) {
            errors.set(commandGroup[index].username, response.connectionError);
          }
          connectionInterrupted = true;
        }
        processedCommands += response.completedCount;
        if (connectionInterrupted) {
          const observed = await this.readRequestedUsers(usernames);
          observed.forEach((user, username) => confirmed.set(username, user));
        }
        onProgress?.({
          completed: Math.min(users.length, Math.max(confirmed.size, processedCommands)),
          phase: "creating",
          total: users.length
        });
        if (connectionInterrupted) break;
      }

      remaining = prepared.filter((entry) => !confirmed.has(entry.username));
      if (!connectionInterrupted) break;
    }

    onProgress?.({
      completed: Math.min(users.length, Math.max(confirmed.size, processedCommands)),
      phase: "verifying",
      total: users.length
    });
    const finalUsers = await this.readRequestedUsers(usernames);
    finalUsers.forEach((user, username) => confirmed.set(username, user));
    onProgress?.({ completed: confirmed.size, phase: "verifying", total: users.length });

    for (const entry of prepared) {
      const observed = confirmed.get(entry.username);
      if (observed && (!voucherQuotaMatches(observed, entry.user.limitBytesTotal)
        || !voucherUsageLimitMatches(observed, entry.user.limitUptime))) {
        confirmed.delete(entry.username);
        errors.set(entry.username, "Le quota relu sur RouterOS ne correspond pas au quota demandé.");
        if (observed.comment === String(entry.command.params?.comment ?? "")) {
          try {
            await this.disableHotspotUser(entry.username);
            await this.disconnectActiveUser(entry.username);
          } catch {
            errors.set(entry.username, "Quota incorrect et blocage non confirmé. Vérifiez le voucher sur le routeur.");
          }
        }
      }
    }

    return prepared.map(({ username }) => {
      const user = confirmed.get(username);
      return user
        ? { status: "confirmed", user, username }
        : {
            message: errors.get(username) ?? "RouterOS did not confirm the voucher creation",
            status: "error",
            username
          };
    });
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
        comment: WIREGUARD_INTERFACE_COMMENT,
        "listen-port": 13231,
        name: config.interfaceName,
        "private-key": config.privateKey
      });
    } else {
      await this.call("/interface/wireguard/set", {
        comment: WIREGUARD_INTERFACE_COMMENT,
        "listen-port": 13231,
        numbers: existingInterfaceId,
        ...(config.privateKey ? { "private-key": config.privateKey } : {})
      });
    }

    const addresses = await this.query("/ip/address/print", { interface: config.interfaceName });
    const primaryAddress = addresses.find(
      (row) => pick(row, "address") === config.assignedAddress
    ) ?? addresses[0];
    const primaryAddressId = pick(primaryAddress ?? {}, ".id", "id");
    if (!primaryAddressId) {
      await this.call("/ip/address/add", {
        address: config.assignedAddress,
        comment: WIREGUARD_ADDRESS_COMMENT,
        interface: config.interfaceName
      });
    } else {
      await this.call("/ip/address/set", {
        address: config.assignedAddress,
        comment: WIREGUARD_ADDRESS_COMMENT,
        interface: config.interfaceName,
        numbers: primaryAddressId
      });
    }
    for (const duplicate of addresses) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId && duplicateId !== primaryAddressId) {
        await this.call("/ip/address/remove", { numbers: duplicateId });
      }
    }

    const peers = await this.query("/interface/wireguard/peers/print", {
      interface: config.interfaceName
    });
    const peerParams = {
      "allowed-address": config.serverAllowedIps,
      comment: WIREGUARD_PEER_COMMENT,
      "endpoint-address": config.serverEndpoint,
      "endpoint-port": config.serverPort,
      interface: config.interfaceName,
      "persistent-keepalive": 25,
      "public-key": config.serverPublicKey
    };
    const primaryPeer = peers.find(
      (row) => pick(row, "public-key") === config.serverPublicKey
    ) ?? peers[0];
    const primaryPeerId = pick(primaryPeer ?? {}, ".id", "id");
    if (!primaryPeerId) {
      await this.call("/interface/wireguard/peers/add", peerParams);
    } else {
      await this.call("/interface/wireguard/peers/set", {
        ...peerParams,
        numbers: primaryPeerId
      });
    }
    for (const duplicate of peers) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId && duplicateId !== primaryPeerId) {
        await this.call("/interface/wireguard/peers/remove", { numbers: duplicateId });
      }
    }

    const routeRows = await this.call("/ip/route/print");
    const managedRoutes = routeRows.filter((row) => isTicketProWireGuardRoute(row, config.interfaceName));
    const externalCollision = routeRows.find((row) =>
      pick(row, "dst-address") === config.serverAllowedIps
      && !isTicketProWireGuardRoute(row, config.interfaceName)
    );
    if (managedRoutes.length === 0 && externalCollision) {
      throw new RouterAdapterError(
        "router_rejected",
        `A non-TicketPro route already owns ${config.serverAllowedIps}`
      );
    }
    const primaryRoute = managedRoutes.find(
      (row) => pick(row, "dst-address") === config.serverAllowedIps
    ) ?? managedRoutes[0];
    const primaryRouteId = pick(primaryRoute ?? {}, ".id", "id");
    if (!primaryRouteId) {
      await this.call("/ip/route/add", {
        comment: WIREGUARD_ROUTE_COMMENT,
        "dst-address": config.serverAllowedIps,
        gateway: config.interfaceName
      });
    } else {
      await this.call("/ip/route/set", {
        comment: WIREGUARD_ROUTE_COMMENT,
        "dst-address": config.serverAllowedIps,
        gateway: config.interfaceName,
        numbers: primaryRouteId
      });
    }
    for (const duplicate of managedRoutes) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId && duplicateId !== primaryRouteId) {
        await this.call("/ip/route/remove", { numbers: duplicateId });
      }
    }

    const firewallRules = await this.call("/ip/firewall/filter/print");
    const ticketProFirewallRules = firewallRules.filter(
      (row) => pick(row, "comment") === "TicketPro WireGuard"
    );
    const primaryFirewallId = pick(ticketProFirewallRules[0] ?? {}, ".id", "id");
    const firewallParams = {
      action: "accept",
      chain: "input",
      comment: "TicketPro WireGuard",
      "in-interface": config.interfaceName
    };
    if (!primaryFirewallId) {
      const inputRules = await this.query("/ip/firewall/filter/print", { chain: "input" });
      const firstDropId = pick(
        inputRules.find((rule) => pick(rule, "action") === "drop") ?? {},
        ".id"
      );
      await this.call("/ip/firewall/filter/add", {
        ...firewallParams,
        "place-before": firstDropId ?? null
      });
    } else {
      await this.call("/ip/firewall/filter/set", {
        ...firewallParams,
        numbers: primaryFirewallId
      });
    }
    for (const duplicate of ticketProFirewallRules.slice(1)) {
      const duplicateId = pick(duplicate, ".id", "id");
      if (duplicateId) {
        await this.call("/ip/firewall/filter/remove", { numbers: duplicateId });
      }
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

    const updated = await this.findUserByName(username);
    if (!voucherQuotaMatches(updated, limits.limitBytesTotal)) {
      await this.disableHotspotUser(username);
      await this.disconnectActiveUser(username);
      throw new RouterAdapterError("router_rejected", "RouterOS n'a pas confirmé le nouveau quota du voucher. Le voucher est bloqué.");
    }
    return updated;
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
    if (user.status === "exhausted" || user.status === "expired" || user.status === "error") {
      throw new RouterAdapterError(
        "router_rejected",
        "A terminal or inconsistent voucher cannot be enabled"
      );
    }
    await this.call("/ip/hotspot/user/enable", { numbers: user.id });
    return { ...user, status: "available" };
  }

  async removeHotspotUser(username: string): Promise<void> {
    const result = (await this.removeHotspotUsersBatch([username]))[0];
    if (!result || result.status === "error") {
      throw new RouterAdapterError(
        "router_rejected",
        result?.message ?? "RouterOS kept the Hotspot voucher after removal"
      );
    }
  }

  async removeHotspotUsersBatch(
    usernames: string[],
    batchId?: string,
    onProgress?: Parameters<NonNullable<RouterAdapter["removeHotspotUsersBatch"]>>[2]
  ): Promise<HotspotUserBatchRemovalResult[]> {
    const requestedUsernames = usernames.map((username) => username.trim()).filter(Boolean);
    if (requestedUsernames.length === 0 && !batchId?.trim()) return [];

    const [userRows, activeRows, cookieRows, hostRows, bindingRows, connectionRows] = await Promise.all([
      this.call("/ip/hotspot/user/print"),
      this.call("/ip/hotspot/active/print"),
      this.call("/ip/hotspot/cookie/print"),
      this.call("/ip/hotspot/host/print"),
      this.call("/ip/hotspot/ip-binding/print"),
      this.call("/ip/firewall/connection/print")
    ]);
    const ownedUsernames = batchId?.trim()
      ? userRows
        .filter((row) => voucherBelongsToBatch(pick(row, "comment"), batchId))
        .map((row) => pick(row, "name", "user"))
        .filter((username): username is string => Boolean(username))
      : [];
    const uniqueUsernames = Array.from(new Set([...requestedUsernames, ...ownedUsernames]));
    const targets = uniqueUsernames.map((username) => {
      const userRow = userRows.find((row) => pick(row, "name", "user") === username);
      const userId = userRow ? pick(userRow, ".id", "id") : undefined;
      const userActiveRows = activeRows.filter((row) => pick(row, "user", "name") === username);
      const userCookieRows = cookieRows.filter((row) => pick(row, "user", "name") === username);
      const clientMacAddresses = new Set([
        normalizeOptionalMacAddress(userRow ? pick(userRow, "mac-address") : undefined),
        ...userActiveRows.map((row) => normalizeOptionalMacAddress(pick(row, "mac-address"))),
        ...userCookieRows.map((row) => normalizeOptionalMacAddress(pick(row, "mac-address")))
      ].filter((value): value is string => Boolean(value)));
      const clientAddresses = new Set([
        ...userActiveRows.map((row) => pick(row, "address")),
        ...hostRows
          .filter((row) => {
            const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
            return Boolean(macAddress && clientMacAddresses.has(macAddress));
          })
          .map((row) => pick(row, "address"))
      ].filter((value): value is string => Boolean(value)));
      const bindingMatchesClient = (row: RouterOsApiRow) => {
        const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
        const address = pick(row, "address");
        return Boolean(macAddress && clientMacAddresses.has(macAddress))
          || Boolean(address && clientAddresses.has(address));
      };
      const ids = (rows: RouterOsApiRow[]) => rows
        .map((row) => pick(row, ".id", "id"))
        .filter((id): id is string => Boolean(id));

      return {
        activeIds: ids(userActiveRows),
        bindingIds: ids(bindingRows.filter((row) => isManagedVoucherBinding(row, username))),
        clientAddresses,
        clientMacAddresses,
        connectionIds: ids(connectionRows.filter((row) => Array.from(clientAddresses).some((address) =>
          connectionAddressMatches(pick(row, "src-address"), address)
          || connectionAddressMatches(pick(row, "dst-address"), address)
        ))),
        cookieIds: ids(userCookieRows),
        externalAuthorizationBindings: bindingRows.filter((row) =>
          !isManagedVoucherBinding(row, username)
          && pick(row, "type") === "bypassed"
          && bindingMatchesClient(row)
        ),
        hostIds: ids(hostRows.filter((row) => {
          const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
          const address = pick(row, "address");
          return Boolean(macAddress && clientMacAddresses.has(macAddress))
            || Boolean(address && clientAddresses.has(address));
        })),
        mutationErrors: [] as string[],
        userId,
        username
      };
    });
    const removedIds = new Set<string>();
    const mutateOnce = async (
      target: (typeof targets)[number],
      command: string,
      id: string
    ) => {
      const key = `${command}:${id}`;
      if (removedIds.has(key)) return;
      removedIds.add(key);
      try {
        await this.call(command, { numbers: id });
      } catch (error) {
        target.mutationErrors.push(error instanceof Error ? error.message : `${command} failed`);
      }
    };

    let completedTargets = 0;
    onProgress?.({ completed: 0, phase: "removing", total: targets.length });
    await mapWithConcurrency(targets, 8, async (target) => {
      const hasClientAuthorization = target.activeIds.length > 0
        || target.cookieIds.length > 0
        || target.hostIds.length > 0
        || target.bindingIds.length > 0
        || target.connectionIds.length > 0
        || target.externalAuthorizationBindings.length > 0;
      if (target.userId && hasClientAuthorization) {
        await mutateOnce(target, "/ip/hotspot/user/disable", target.userId);
      }
      for (const id of target.activeIds) await mutateOnce(target, "/ip/hotspot/active/remove", id);
      for (const id of target.cookieIds) await mutateOnce(target, "/ip/hotspot/cookie/remove", id);
      for (const id of target.hostIds) await mutateOnce(target, "/ip/hotspot/host/remove", id);
      for (const id of target.bindingIds) await mutateOnce(target, "/ip/hotspot/ip-binding/remove", id);
      for (const id of target.connectionIds) await mutateOnce(target, "/ip/firewall/connection/remove", id);
      if (target.externalAuthorizationBindings.length > 0) {
        target.mutationErrors.push("An external Hotspot bypass still authorizes this voucher device");
      } else if (target.userId) {
        await mutateOnce(target, "/ip/hotspot/user/remove", target.userId);
      }
      completedTargets += 1;
      onProgress?.({ completed: completedTargets, phase: "removing", total: targets.length });
    });

    onProgress?.({ completed: targets.length, phase: "verifying", total: targets.length });
    const [remainingUsers, remainingActiveRows, remainingCookieRows, remainingHosts, remainingBindings, remainingConnections] = await Promise.all([
      this.call("/ip/hotspot/user/print"),
      this.call("/ip/hotspot/active/print"),
      this.call("/ip/hotspot/cookie/print"),
      this.call("/ip/hotspot/host/print"),
      this.call("/ip/hotspot/ip-binding/print"),
      this.call("/ip/firewall/connection/print")
    ]);
    return targets.map((target) => {
      const stillPresent = (rows: RouterOsApiRow[]) => rows.some(
        (row) => pick(row, "user", "name") === target.username
      );
      const authorizationRemains = stillPresent(remainingUsers)
        || stillPresent(remainingActiveRows)
        || stillPresent(remainingCookieRows)
        || remainingHosts.some((row) => {
          const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
          const address = pick(row, "address");
          return Boolean(macAddress && target.clientMacAddresses.has(macAddress))
            || Boolean(address && target.clientAddresses.has(address));
        })
        || remainingBindings.some((row) => {
          const macAddress = normalizeOptionalMacAddress(pick(row, "mac-address"));
          const address = pick(row, "address");
          return isManagedVoucherBinding(row, target.username)
            || Boolean(macAddress && target.clientMacAddresses.has(macAddress))
            || Boolean(address && target.clientAddresses.has(address));
        })
        || remainingConnections.some((row) => Array.from(target.clientAddresses).some((address) =>
          connectionAddressMatches(pick(row, "src-address"), address)
          || connectionAddressMatches(pick(row, "dst-address"), address)
        ));
      if (!authorizationRemains) return { status: "removed" as const, username: target.username };
      return {
        message: target.mutationErrors[0] ?? "RouterOS kept a Hotspot authorization or network connection after removal",
        status: "error" as const,
        username: target.username
      };
    });
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

    // The old FORWARD rules dropped TTL 63/127 packets. Depending on where a
    // RouterOS release evaluates the TTL matcher, a legitimate Android client
    // can itself be seen with TTL 63 and lose all connectivity. Set the TTL of
    // traffic sent *to* the authenticated Hotspot client to 1 instead: the
    // paying device can consume the packet, but cannot route it one hop farther.
    const ipv4Rules = config.enabled && config.blockIpv4Ttl
      ? activeInterfaces.map((interfaceName) => ({
          action: "change-ttl",
          chain: "postrouting",
          comment: `TicketPro anti-tethering:IPv4 client TTL ${interfaceName}`,
          hotspot: "to-client",
          "new-ttl": "set:1",
          "out-interface": interfaceName,
          passthrough: "no"
        }))
      : [];

    // Always remove the legacy drop rules during the first save after an
    // application update. They are deliberately not reused by the new policy.
    await this.reconcileManagedFirewallRules(
      "/ip/firewall/filter",
      []
    );
    await this.reconcileManagedFirewallRules(
      "/ip/firewall/mangle",
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

    // Anti-tethering is independent from a plan's simultaneous-device limit.
    // Never overwrite shared-users here: plans that intentionally allow more
    // than one device must keep their RouterOS configuration.
  }

  async getHotspotAntiTetheringState(): Promise<import("../../domain/router").HotspotAntiTetheringState> {
    const [ipv4FilterRows, ipv4MangleRows, ipv6Rows] = await Promise.all([
      this.call("/ip/firewall/filter/print"),
      this.call("/ip/firewall/mangle/print"),
      this.call("/ipv6/firewall/filter/print").catch(() => [])
    ]);
    const managedPrefix = "TicketPro anti-tethering:";
    const managedIpv4Filters = ipv4FilterRows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
      && !isTruthy(pick(row, "disabled"))
    );
    const managedIpv4Mangle = ipv4MangleRows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
      && !isTruthy(pick(row, "disabled"))
    );
    const managedIpv6 = ipv6Rows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
      && !isTruthy(pick(row, "disabled"))
    );
    return {
      blockIpv4Ttl: managedIpv4Mangle.some((row) =>
        pick(row, "comment")?.startsWith(`${managedPrefix}IPv4 client TTL `)
      ) || managedIpv4Filters.some((row) =>
        // Legacy state remains visible until the next explicit save, which
        // migrates it to the safe POSTROUTING rule.
        pick(row, "comment")?.startsWith(`${managedPrefix}IPv4 TTL `)
      ),
      blockIpv6: managedIpv6.some((row) =>
        pick(row, "comment")?.startsWith(`${managedPrefix}IPv6 `)
      ),
      managedRuleCount:
        managedIpv4Filters.length + managedIpv4Mangle.length + managedIpv6.length
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
    const userSessions = activeUsers.filter((item) => item.username === username);

    if (userSessions.length === 0) {
      throw new RouterAdapterError("hotspot_not_found", "Active user not found");
    }

    for (const session of userSessions) {
      await this.call("/ip/hotspot/active/remove", { numbers: session.id });
    }
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
    const user = await this.findHotspotUser(username);

    if (!user) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot user not found");
    }

    return user;
  }

  private async reconcileManagedFirewallRules(
    menu: "/ip/firewall/filter" | "/ip/firewall/mangle" | "/ipv6/firewall/filter",
    desiredRules: Array<Record<string, string>>
  ): Promise<void> {
    const rows = await this.call(`${menu}/print`);
    const managedPrefix = "TicketPro anti-tethering:";
    const managedRows = rows.filter((row) =>
      pick(row, "comment")?.startsWith(managedPrefix)
    );
    const desiredComments = new Set(desiredRules.map((rule) => rule.comment));
    const removedRuleIds = new Set<string>();
    const desiredChain = desiredRules[0]?.chain;
    const firstRuleInDesiredChainId = pick(
      rows.find((row) =>
        Boolean(desiredChain) &&
        pick(row, "chain") === desiredChain &&
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
        const addParams: Record<string, string> = { ...rule };
        if (firstRuleInDesiredChainId) {
          addParams["place-before"] = firstRuleInDesiredChainId;
        }
        await this.call(`${menu}/add`, addParams);
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

  private async assertVoucherAutomationAllowedByDeviceMode(
    routerOsVersion: string
  ): Promise<void> {
    if (!isRouterOsVersionAtLeast(routerOsVersion, 7, 17)) return;

    const deviceMode = firstRow(await this.call("/system/device-mode/print"));
    if (Object.keys(deviceMode).length === 0) return;

    if (isTruthy(pick(deviceMode, "flagged"))) {
      throw new RouterAdapterError(
        "device_mode_flagged",
        "RouterOS Device Mode is flagged"
      );
    }

    const scheduler = pick(deviceMode, "scheduler");
    const hotspot = pick(deviceMode, "hotspot");
    if (isExplicitlyDisabled(scheduler) || isExplicitlyDisabled(hotspot)) {
      const disabledFeatures = [
        isExplicitlyDisabled(scheduler) ? "scheduler" : null,
        isExplicitlyDisabled(hotspot) ? "hotspot" : null
      ].filter((feature): feature is string => Boolean(feature));
      throw new RouterAdapterError(
        "device_mode_restricted",
        `RouterOS Device Mode blocks: ${disabledFeatures.join(", ")}`
      );
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

  private async callBatch(commands: RouterOsApiBatchCommand[]): Promise<RouterOsApiBatchResponse> {
    if (!this.transport.callBatch) {
      const results = [];
      for (const command of commands) {
        try {
          const rows = await this.transport.call({ ...this.config, ...command });
          results.push({ error: null, rows });
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : String(error),
            rows: []
          });
        }
      }
      return { completedCount: results.length, connectionError: null, results };
    }

    try {
      return await this.transport.callBatch({ ...this.config, commands });
    } catch (error) {
      throw normalizeMikroTikError(error);
    }
  }

  private async readRequestedUsers(usernames: string[]): Promise<Map<string, HotspotUser>> {
    const requested = new Set(usernames);
    const rows = (await this.call("/ip/hotspot/user/print", {
      ".proplist": HOTSPOT_USER_VERIFICATION_PROPERTIES
    })).filter((row) =>
      requested.has(pick(row, "name", "user") ?? "")
    );
    const users = await Promise.all(rows.map((row) => userRowToHotspotUser(row)));
    return new Map(users.map((user) => [user.username, user]));
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
  const quota = readPlanQuotaMetadata(pick(row, "on-login"));
  dataLimitMbToBytes(quota ? quota.dataLimitMb : metadata.dataLimitMb);
  const rateLimit = pick(row, "rate-limit");
  const [downloadLimit, uploadLimit] = splitRateLimit(rateLimit);
  const onLogin = pick(row, "on-login") ?? "";
  const isTicketProProfile = quota?.durationMinutes !== undefined
    || quota?.validityMinutes !== undefined
    || onLogin.includes(VOUCHER_PROFILE_HANDLER_BEGIN)
    || metadata.durationMinutes !== undefined
    || metadata.validityMinutes !== undefined;
  // Previous TicketPro releases used session/mac-cookie timeout as commercial
  // metadata. Preserve their read view once, but never treat a native profile's
  // cookie lifetime as a ticket validity.
  const durationMinutes = quota?.durationMinutes
    ?? (isTicketProProfile ? routerOsDurationToMinutes(pick(row, "session-timeout")) || metadata.durationMinutes || 0 : 0);
  const validityMinutes = quota?.validityMinutes
    ?? (isTicketProProfile
      ? routerOsDurationToMinutes(pick(row, "mac-cookie-timeout")) || metadata.validityMinutes || durationMinutes || null
      : null);

  return {
    dataLimitMb: quota ? quota.dataLimitMb : metadata.dataLimitMb ?? null,
    ...(quota || metadata.dataLimitMb !== undefined ? { dataLimitSource: "routeros" as const } : {}),
    downloadLimit,
    durationMinutes,
    id: pick(row, ".id") || pick(row, "id") || pick(row, "name") || "profile",
    name: metadata.name ?? pick(row, "name") ?? "Plan",
    priceHint: metadata.priceHint ?? null,
    profileName: pick(row, "name") || "default",
    sharedUsers: parseInteger(pick(row, "shared-users")) || 1,
    status: metadata.status === "disabled" || isTruthy(pick(row, "disabled")) ? "disabled" : "active",
    profileSettings: profileSettingsFromRow(row),
    ticketSettingsSource: isTicketProProfile ? "ticketpro" : "routeros",
    uploadLimit,
    validityMinutes
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
  const lifecycleState = pick(row, "comment")?.match(/;state=([a-z-]+);/)?.[1] ?? null;

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
    status: lifecycleState === "cleanup-error" || lifecycleState === "cleanup-pending"
      ? "error"
      : lifecycleState === "exhausted" || (limitReached && lifecycleState !== "expired")
      ? "exhausted"
      : lifecycleState === "expired"
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

function normalizeManagedProfileNames(
  names: readonly string[] | undefined
): Set<string> {
  return new Set(
    (names ?? [])
      .map((name) => name.trim())
      .filter((name) => Boolean(name) && name.toLowerCase() !== "default")
  );
}

function isTicketProWireGuardRoute(
  row: RouterOsApiRow,
  interfaceName: string
): boolean {
  const comment = pick(row, "comment") ?? "";
  return comment === WIREGUARD_ROUTE_COMMENT
    || comment === "TicketPro WireGuard"
    || comment === "TicketPro WireGuard multi-organisation"
    || (pick(row, "gateway") === interfaceName && comment.startsWith("TicketPro"));
}

function csvValues(value: string): Set<string> {
  return new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function normalizeRouterOsIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(normalized)) {
    throw new RouterAdapterError(
      "router_rejected",
      `Invalid dedicated RouterOS ${label}`
    );
  }
  return normalized;
}

function normalizeAuthorizedCidrs(cidrs: readonly string[]): string[] {
  const normalized = Array.from(new Set(cidrs.map((cidr) => cidr.trim()).filter(Boolean))).sort();
  if (normalized.length === 0) {
    throw new RouterAdapterError("router_rejected", "At least one management CIDR is required");
  }
  for (const cidr of normalized) {
    const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
    if (!match) {
      throw new RouterAdapterError("router_rejected", `Invalid management CIDR ${cidr}`);
    }
    const octets = match.slice(1, 5).map(Number);
    const prefix = Number(match[5]);
    if (
      octets.some((octet) => octet < 0 || octet > 255)
      || prefix < 8
      || prefix > 32
      || cidr === "0.0.0.0/0"
    ) {
      throw new RouterAdapterError("router_rejected", `Unsafe management CIDR ${cidr}`);
    }
  }
  return normalized;
}

function hasVoucherLifecycleHandler(source: string): boolean {
  return source.includes(VOUCHER_PROFILE_HANDLER_BEGIN)
    && source.includes(VOUCHER_PROFILE_HANDLER_END);
}

function singletonState(
  rows: RouterOsApiRow[],
  isExpected: (row: RouterOsApiRow) => boolean
): RouterManagedResourceObservation["state"] {
  if (rows.length === 0) return "missing";
  if (rows.length > 1) return "duplicate";
  return isExpected(rows[0]) ? "present" : "drift";
}

function appendManagedCommentResources(
  observations: RouterManagedResourceObservation[],
  entries: Array<{ menu: string; row: RouterOsApiRow }>,
  prefix: string,
  kind: "firewall_rule" | "ip_binding"
): void {
  const groups = new Map<string, Array<{ menu: string; row: RouterOsApiRow }>>();
  for (const entry of entries) {
    const comment = pick(entry.row, "comment") ?? "";
    if (!comment.startsWith(prefix)) continue;
    const group = groups.get(comment) ?? [];
    group.push(entry);
    groups.set(comment, group);
  }

  for (const [comment, matches] of groups) {
    observations.push({
      attributes: {
        comment,
        disabled: matches.every(({ row }) => isTruthy(pick(row, "disabled"))),
        menu: Array.from(new Set(matches.map((entry) => entry.menu))).join(",")
      },
      key: `${kind}:${comment}`,
      kind,
      matchCount: matches.length,
      ownership: "ticketpro",
      state: matches.length === 1 ? "present" : "duplicate"
    });
  }
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

function isManagedVoucherBinding(row: RouterOsApiRow, username: string): boolean {
  const comment = pick(row, "comment") ?? "";
  return comment.startsWith(`TicketPro voucher:${username}`)
    || comment.startsWith(`TicketPro ticket:${username}`);
}

function managedVoucherBindingUsername(row: RouterOsApiRow): string | null {
  const comment = pick(row, "comment") ?? "";
  const prefix = ["TicketPro voucher:", "TicketPro ticket:"]
    .find((candidate) => comment.startsWith(candidate));
  if (!prefix) return null;
  const username = comment.slice(prefix.length).split(";")[0]?.trim() ?? "";
  return username || null;
}

function connectionAddressMatches(value: string | undefined, address: string): boolean {
  if (!value || !address) return false;
  return value === address
    || value.startsWith(`${address}:`)
    || value.startsWith(`${address}%`);
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

function planMetadata(plan: Pick<HotspotPlanDraft, "dataLimitMb" | "durationMinutes" | "validityMinutes">): TicketProProfileMetadata {
  const durationMinutes = Number.isInteger(plan.durationMinutes) && plan.durationMinutes > 0
    ? plan.durationMinutes
    : undefined;
  return {
    dataLimitMb: plan.dataLimitMb,
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
    ...(durationMinutes === undefined
      ? {}
      : { validityMinutes: plan.validityMinutes ?? durationMinutes })
  };
}

function profileSettingsFromRow(row: RouterOsApiRow): HotspotUserProfileSettings {
  return {
    addressList: pick(row, "address-list") ?? null,
    addressPool: pick(row, "address-pool") ?? null,
    addMacCookie: isTruthy(pick(row, "add-mac-cookie")),
    idleTimeout: pick(row, "idle-timeout") ?? null,
    incomingFilter: pick(row, "incoming-filter") ?? null,
    incomingPacketMark: pick(row, "incoming-packet-mark") ?? null,
    keepaliveTimeout: pick(row, "keepalive-timeout") ?? null,
    macCookieTimeout: pick(row, "mac-cookie-timeout") ?? null,
    onLogin: pick(row, "on-login") ?? null,
    onLogout: pick(row, "on-logout") ?? null,
    outgoingFilter: pick(row, "outgoing-filter") ?? null,
    outgoingPacketMark: pick(row, "outgoing-packet-mark") ?? null,
    sessionTimeout: pick(row, "session-timeout") ?? null,
    statusAutorefresh: pick(row, "status-autorefresh") ?? null,
    transparentProxy: isTruthy(pick(row, "transparent-proxy"))
  };
}

function voucherUsageLimitMatches(user: Pick<HotspotUser, "limitUptime">, expected: string | null | undefined): boolean {
  if (expected === undefined) return true;
  return routerOsDurationToSeconds(user.limitUptime) === routerOsDurationToSeconds(expected);
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

function hotspotUserAddCommand(
  user: HotspotUserDraft,
  profileName: string,
  password: string
): RouterOsApiBatchCommand {
  return {
    command: "/ip/hotspot/user/add",
    params: {
      comment: buildVoucherLifecycleComment(user.validityMinutes, user.comment),
      "limit-bytes-total": user.limitBytesTotal ?? null,
      "limit-uptime": user.limitUptime ?? null,
      name: user.username.trim(),
      password,
      profile: profileName,
      server: user.serverName?.trim() || "all"
    }
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );
  return results;
}

function isExplicitlyDisabled(value: string | undefined): boolean {
  return value === "false" || value === "no";
}

function isRouterOsVersionAtLeast(
  version: string,
  expectedMajor: number,
  expectedMinor: number
): boolean {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > expectedMajor || (major === expectedMajor && minor >= expectedMinor);
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
  const ownershipSuffix = extractVoucherBatchOwnershipSuffix(originalComment);
  return `${VOUCHER_LIFECYCLE_COMMENT_PREFIX}validity=${normalizedValidity};expires=0;state=new;${ownershipSuffix}`;
}

export function reconcileVoucherLifecycleComment(
  currentComment: string | null | undefined,
  validityMinutes: number | null
): string {
  if (!validityMinutes || validityMinutes <= 0) {
    return currentComment?.trim().slice(0, 240) ?? "";
  }
  if (!currentComment?.startsWith(VOUCHER_LIFECYCLE_COMMENT_PREFIX)) {
    return buildVoucherLifecycleComment(validityMinutes, currentComment);
  }

  const expires = currentComment.match(/;expires=(\d+);/)?.[1] ?? "0";
  const state = currentComment.match(/;state=([a-z-]+);/)?.[1] ?? "new";
  if (expires !== "0" || state !== "new") {
    return currentComment;
  }
  const ownershipSuffix = extractVoucherBatchOwnershipSuffix(currentComment);
  return `${VOUCHER_LIFECYCLE_COMMENT_PREFIX}validity=${Math.floor(validityMinutes)};expires=${expires};state=${state};${ownershipSuffix}`;
}

export function mergeVoucherLifecycleOnLogin(
  currentSource: string,
  knownScriptNames: ReadonlySet<string> = new Set()
): string {
  const withoutManagedBlock = removeVoucherLifecycleOnLogin(currentSource, knownScriptNames);
  return [
    withoutManagedBlock,
    VOUCHER_PROFILE_HANDLER_BEGIN,
    buildVoucherOnLoginScript(),
    VOUCHER_PROFILE_HANDLER_END
  ].filter(Boolean).join("\r\n");
}

export function removeVoucherLifecycleOnLogin(
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
  return preservedSource;
}

export function mergeHotspotLoginBy(currentValue: string): string {
  const methods = currentValue
    .split(",")
    .map((method) => method.trim())
    .filter(Boolean);
  const uniqueMethods = new Set(methods);
  uniqueMethods.add("cookie");
  uniqueMethods.add("mac-cookie");
  if (!["http-chap", "http-pap", "https"].some((method) => uniqueMethods.has(method))) {
    uniqueMethods.add("http-chap");
  }
  return Array.from(uniqueMethods).join(",");
}

function resolveMacCookieTimeout(currentValue: string, sessionTimeout: string | undefined): string {
  if (isPositiveRouterOsDuration(currentValue)) return currentValue;
  if (isPositiveRouterOsDuration(sessionTimeout)) return sessionTimeout!;
  return "3d";
}

function isPositiveRouterOsDuration(value: string | undefined): boolean {
  if (!value || value === "none" || value === "0" || value === "0s") return false;
  return /\d+(?:w|d|h|m|s)/.test(value);
}

export function buildVoucherOnLoginScript(): string {
  return [
    ':local tpId [/ip hotspot user find where name=$user];',
    ':if ([:len $tpId] = 0) do={ :return };',
    ':local tpComment [/ip hotspot user get $tpId comment];',
    ':local tpOwnership "";',
    ':local tpBatchStart [:find $tpComment "batch="];',
    ':if ([:typeof $tpBatchStart] != "nil") do={',
    '  :set tpBatchStart ($tpBatchStart + 6);',
    '  :local tpBatchEnd [:find $tpComment ";" $tpBatchStart];',
    '  :if ([:typeof $tpBatchEnd] != "nil") do={ :set tpOwnership ("batch=" . [:pick $tpComment $tpBatchStart $tpBatchEnd] . ";") };',
    '};',
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
    '  /ip hotspot user set $tpId comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpDeadline . ";state=active;" . $tpOwnership);',
    '};'
  ].join("\r\n");
}

export function buildVoucherExpirationScript(): string {
  return [
    ':local tpNow [:tonsec [:timestamp]];',
    ':foreach tpId in=[/ip hotspot user find where comment~"TicketPro:v1;"] do={',
    '  :local tpComment [/ip hotspot user get $tpId comment];',
    '  :local tpOwnership "";',
    '  :local tpBatchStart [:find $tpComment "batch="];',
    '  :if ([:typeof $tpBatchStart] != "nil") do={',
    '    :set tpBatchStart ($tpBatchStart + 6);',
    '    :local tpBatchEnd [:find $tpComment ";" $tpBatchStart];',
    '    :if ([:typeof $tpBatchEnd] != "nil") do={ :set tpOwnership ("batch=" . [:pick $tpComment $tpBatchStart $tpBatchEnd] . ";") };',
    '  };',
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
    '      :local tpExpired false;',
    '      :local tpExhausted false;',
    '      :local tpReason "";',
    '      :if (($tpExpires > 0) && ($tpNow >= $tpExpires)) do={ :set tpExpired true; :set tpReason "validity-expired" };',
    '      :local tpLimitUptime [:tonum [:totime [/ip hotspot user get $tpId limit-uptime]]];',
    '      :local tpUptime [:tonum [:totime [/ip hotspot user get $tpId uptime]]];',
    '      :if (($tpExpired = false) && ($tpLimitUptime > 0) && ($tpUptime >= $tpLimitUptime)) do={ :set tpExhausted true; :set tpReason "time-consumed" };',
    '      :local tpLimitBytes [/ip hotspot user get $tpId limit-bytes-total];',
    '      :local tpBytesIn [/ip hotspot user get $tpId bytes-in];',
    '      :local tpBytesOut [/ip hotspot user get $tpId bytes-out];',
    '      :if (($tpExpired = false) && ($tpLimitBytes > 0) && (($tpBytesIn + $tpBytesOut) >= $tpLimitBytes)) do={ :set tpExhausted true; :set tpReason "quota-consumed" };',
    '      :if (($tpExpired = true) || ($tpExhausted = true)) do={',
    '        :local tpUser [/ip hotspot user get $tpId name];',
    '        :local tpUserMac [/ip hotspot user get $tpId mac-address];',
    '        :local tpState "exhausted";',
    '        :local tpCleanupFailed false;',
    '        :if ($tpExpired = true) do={ :set tpState "expired" };',
    '        :local tpBindingMarker ("TicketPro voucher:" . $tpUser);',
    '        :do { /ip hotspot user set $tpId disabled=yes comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpExpires . ";state=cleanup-pending;" . $tpOwnership) } on-error={ :set tpCleanupFailed true };',
    '        :foreach tpActiveId in=[/ip hotspot active find where user=$tpUser] do={',
    '          :local tpAddress [/ip hotspot active get $tpActiveId address];',
    '          :do { /ip hotspot active remove $tpActiveId } on-error={ :set tpCleanupFailed true };',
    '          :if ([:len $tpAddress] > 0) do={',
    '            :do { /ip firewall connection remove [find where src-address~$tpAddress] } on-error={ :set tpCleanupFailed true };',
    '            :do { /ip firewall connection remove [find where dst-address~$tpAddress] } on-error={ :set tpCleanupFailed true };',
    '            :foreach tpForeignBindingId in=[/ip hotspot ip-binding find where address=$tpAddress and type=bypassed] do={',
    '              :local tpForeignComment [/ip hotspot ip-binding get $tpForeignBindingId comment];',
    '              :if ([:typeof [:find $tpForeignComment $tpBindingMarker]] = "nil") do={ :set tpCleanupFailed true };',
    '            };',
    '            :do { /ip hotspot host remove [find where address=$tpAddress] } on-error={ :set tpCleanupFailed true };',
    '          };',
    '        };',
    '        :foreach tpCookieId in=[/ip hotspot cookie find where user=$tpUser] do={',
    '          :local tpMac [/ip hotspot cookie get $tpCookieId mac-address];',
    '          :if ([:len $tpMac] > 0) do={',
    '            :foreach tpForeignBindingId in=[/ip hotspot ip-binding find where mac-address=$tpMac and type=bypassed] do={',
    '              :local tpForeignComment [/ip hotspot ip-binding get $tpForeignBindingId comment];',
    '              :if ([:typeof [:find $tpForeignComment $tpBindingMarker]] = "nil") do={ :set tpCleanupFailed true };',
    '            };',
    '            :foreach tpHostId in=[/ip hotspot host find where mac-address=$tpMac] do={',
    '              :local tpHostAddress [/ip hotspot host get $tpHostId address];',
    '              :if ([:len $tpHostAddress] > 0) do={',
    '                :do { /ip firewall connection remove [find where src-address~$tpHostAddress] } on-error={ :set tpCleanupFailed true };',
    '                :do { /ip firewall connection remove [find where dst-address~$tpHostAddress] } on-error={ :set tpCleanupFailed true };',
    '              };',
    '              :do { /ip hotspot host remove $tpHostId } on-error={ :set tpCleanupFailed true };',
    '            };',
    '          };',
    '          :do { /ip hotspot cookie remove $tpCookieId } on-error={ :set tpCleanupFailed true };',
    '        };',
    '        :if (([:len $tpUserMac] > 0) && ($tpUserMac != "00:00:00:00:00:00")) do={',
    '          :foreach tpForeignBindingId in=[/ip hotspot ip-binding find where mac-address=$tpUserMac and type=bypassed] do={',
    '            :local tpForeignComment [/ip hotspot ip-binding get $tpForeignBindingId comment];',
    '            :if ([:typeof [:find $tpForeignComment $tpBindingMarker]] = "nil") do={ :set tpCleanupFailed true };',
    '          };',
    '          :foreach tpHostId in=[/ip hotspot host find where mac-address=$tpUserMac] do={',
    '            :local tpHostAddress [/ip hotspot host get $tpHostId address];',
    '            :if ([:len $tpHostAddress] > 0) do={',
    '              :do { /ip firewall connection remove [find where src-address~$tpHostAddress] } on-error={ :set tpCleanupFailed true };',
    '              :do { /ip firewall connection remove [find where dst-address~$tpHostAddress] } on-error={ :set tpCleanupFailed true };',
    '            };',
    '            :do { /ip hotspot host remove $tpHostId } on-error={ :set tpCleanupFailed true };',
    '          };',
    '        };',
    '        :foreach tpBindingId in=[/ip hotspot ip-binding find where comment~$tpBindingMarker] do={ :do { /ip hotspot ip-binding remove $tpBindingId } on-error={ :set tpCleanupFailed true } };',
    '        :if ([:len [/ip hotspot active find where user=$tpUser]] > 0) do={ :set tpCleanupFailed true };',
    '        :if ([:len [/ip hotspot cookie find where user=$tpUser]] > 0) do={ :set tpCleanupFailed true };',
    '        :if ([:len [/ip hotspot ip-binding find where comment~$tpBindingMarker]] > 0) do={ :set tpCleanupFailed true };',
    '        :if ($tpCleanupFailed = true) do={',
    '          :do { /ip hotspot user set $tpId disabled=yes comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpExpires . ";state=cleanup-error;" . $tpOwnership) } on-error={};',
    '          :log error ("TicketPro voucher cleanup failed: " . $tpUser . " (" . $tpReason . ")");',
    '        } else={',
    '          :do { /ip hotspot user set $tpId disabled=yes comment=("TicketPro:v1;validity=" . $tpValidity . ";expires=" . $tpExpires . ";state=" . $tpState . ";" . $tpOwnership) } on-error={ :set tpCleanupFailed true };',
    '          :if ($tpCleanupFailed = true) do={',
    '            :log error ("TicketPro voucher state update failed: " . $tpUser);',
    '          } else={',
    '            :if ($tpExpired = true) do={',
    '              :do { /ip hotspot user remove $tpId } on-error={ :set tpCleanupFailed true };',
    '              :if (([:len [/ip hotspot user find where name=$tpUser]] = 0) && ($tpCleanupFailed = false)) do={ :log info ("TicketPro voucher removed: " . $tpUser . " (" . $tpReason . ")") } else={ :log error ("TicketPro voucher removal failed: " . $tpUser) };',
    '            } else={',
    '              :log info ("TicketPro voucher exhausted: " . $tpUser . " (" . $tpReason . ")");',
    '            };',
    '          };',
    '        };',
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
