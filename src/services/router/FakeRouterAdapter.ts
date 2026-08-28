import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotDnsConfigurationResult,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUsersBatchDraft,
  InterfaceTraffic,
  RouterConnectionTest,
  RouterConnectionMode,
  RouterDateTime,
  RouterErrorCode,
  RouterHealth,
  RouterSummary,
  RouterSystemInfo
} from "../../domain/router";
import type { RouterAdapter } from "./RouterAdapter";
import { RouterAdapterError } from "./RouterAdapterError";
import { TicketCodeGenerator } from "../tickets";

type FakeRouterAdapterOptions = {
  connectionMode?: RouterConnectionMode;
  errorMode?: RouterErrorCode | null;
  host?: string;
  latencyMs?: number;
};

export class FakeRouterAdapter implements RouterAdapter {
  private hotspotBypasses = new Map<string, import("../../domain/router").HotspotBypassBinding>();
  private hotspotBlockedDevices = new Map<string, import("../../domain/router").HotspotBypassBinding>();
  private hotspotAntiTetheringState: import("../../domain/router").HotspotAntiTetheringState = {
    blockIpv4Ttl: false,
    blockIpv6: false,
    managedRuleCount: 0
  };
  private hotspotDnsName = "";
  private lifecycleEngineInstalled = false;
  async getWireGuardInstallation(): Promise<null> {
    return null;
  }

  async provisionWireGuard(): Promise<void> {
    return undefined;
  }

  async removeWireGuardPeer(): Promise<void> {
    return undefined;
  }
  private readonly latencyMs: number;
  private errorMode: RouterErrorCode | null;

  private readonly router: RouterSummary;

  private readonly systemInfo: RouterSystemInfo = {
    architecture: "arm64",
    boardName: "C52iG-5HaxD2HaxD",
    identity: "hotspot-boutique-centre",
    model: "hAP ax²",
    routerOsVersion: "7.15.3",
    serialNumber: "HAX2-DEMO-2026",
    uptime: "5d 08:42:17"
  };

  private readonly servers: HotspotServer[] = [
    {
      addressPool: "clients-hotspot",
      dnsName: "wifi.ticketpro.local",
      id: "*1",
      interfaceName: "bridge-hotspot",
      isEnabled: true,
      name: "Hotspot principal",
      profileName: "default-hotspot"
    }
  ];

  async upsertHotspotDns(dnsName: string): Promise<HotspotDnsConfigurationResult> {
    await this.guard("upsertHotspotDns");
    const action = this.hotspotDnsName ? "updated" : "created";
    this.hotspotDnsName = dnsName;
    return {
      action,
      dnsName,
      profileName: this.servers[0]?.profileName ?? "ticketpro-hotspot-profile",
      serverName: this.servers[0]?.name ?? null
    };
  }

  private plans: HotspotPlan[] = [
    {
      dataLimitMb: null,
      downloadLimit: "5M",
      durationMinutes: 1440,
      id: "plan-jour",
      name: "Journée",
      priceHint: 500,
      profileName: "plan-journee",
      sharedUsers: 1,
      status: "active",
      uploadLimit: "2M",
      validityMinutes: 1440
    },
    {
      dataLimitMb: 2048,
      downloadLimit: "3M",
      durationMinutes: 120,
      id: "plan-2h",
      name: "2 heures",
      priceHint: 100,
      profileName: "plan-2h",
      sharedUsers: 1,
      status: "active",
      uploadLimit: "1M",
      validityMinutes: 240
    }
  ];

  private users: HotspotUser[] = [
    {
      comment: "Lot démo",
      createdAt: new Date(0).toISOString(),
      id: "user-demo-001",
      passwordSecretRef: "secret://routeur-demo/user-demo-001/password",
      planId: "plan-jour",
      profileName: "plan-journee",
      status: "available",
      username: "J001"
    },
    {
      comment: "Client actif démo",
      createdAt: new Date(0).toISOString(),
      id: "user-demo-002",
      passwordSecretRef: "secret://routeur-demo/1851526/password",
      planId: "plan-jour",
      profileName: "plan-journee",
      status: "active",
      username: "1851526"
    },
    {
      comment: "Client visiteur demo",
      createdAt: new Date(0).toISOString(),
      id: "user-demo-003",
      passwordSecretRef: "secret://routeur-demo/1980978/password",
      planId: "plan-2h",
      profileName: "plan-2h",
      status: "active",
      username: "1980978"
    }
  ];

  private activeUsers: ActiveHotspotUser[] = [
    {
      downloadedBytes: 47_185_920,
      id: "active-demo-001",
      ipAddress: "192.168.88.24",
      macAddress: "2C:CF:67:12:44:90",
      sessionTimeLeft: "21h 12m",
      uploadedBytes: 4_718_592,
      uptime: "38m",
      username: "1851526"
    },
    {
      downloadedBytes: 12_582_912,
      id: "active-demo-002",
      ipAddress: "192.168.88.35",
      macAddress: "A8:6B:AD:73:11:02",
      sessionTimeLeft: "1h 27m",
      uploadedBytes: 1_572_864,
      uptime: "12m",
      username: "1980978"
    }
  ];

  constructor(options: FakeRouterAdapterOptions = {}) {
    this.errorMode = options.errorMode ?? null;
    this.latencyMs = options.latencyMs ?? 35;
    this.router = {
      connectionMode: options.connectionMode ?? "local",
      host: options.host ?? "192.168.88.1",
      id: "routeur-demo",
      isReachable: true,
      name: "Routeur démo"
    };
  }

  setErrorMode(errorMode: RouterErrorCode | null): void {
    this.errorMode = errorMode;
  }

  async listRouters(): Promise<RouterSummary[]> {
    await this.simulateLatency();
    return [this.router];
  }

  async testConnection(): Promise<RouterConnectionTest> {
    await this.guard("testConnection");

    return {
      checkedAt: new Date(0).toISOString(),
      latencyMs: this.latencyMs,
      mode: this.router.connectionMode,
      ok: true
    };
  }

  async getSystemInfo(): Promise<RouterSystemInfo> {
    await this.guard("getSystemInfo");
    return { ...this.systemInfo };
  }

  async getHotspotServers(): Promise<HotspotServer[]> {
    await this.guard("getHotspotServers");
    return this.servers.map((server) => ({ ...server }));
  }

  async getHotspotPlans(): Promise<HotspotPlan[]> {
    await this.guard("getHotspotPlans");
    return this.plans.map((plan) => ({ ...plan }));
  }

  async createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan> {
    await this.guard("createHotspotPlan");
    const created: HotspotPlan = {
      ...plan,
      id: `plan-${slugify(plan.name)}-${this.plans.length + 1}`,
      status: plan.status ?? "active"
    };

    this.plans = [...this.plans, created];
    return { ...created };
  }

  async updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>): Promise<HotspotPlan> {
    await this.guard("updateHotspotPlan");
    const plan = this.findPlan(planId);
    const updated = { ...plan, ...updates, id: plan.id };

    this.plans = this.plans.map((item) => (item.id === planId ? updated : item));
    return { ...updated };
  }

  async deleteHotspotPlan(planId: string): Promise<void> {
    await this.guard("deleteHotspotPlan");
    this.findPlan(planId);
    this.plans = this.plans.filter((plan) => plan.id !== planId);
  }

  async listHotspotUsers(): Promise<HotspotUser[]> {
    await this.guard("listHotspotUsers");
    return this.users.map((user) => ({ ...user }));
  }

  async findHotspotUser(username: string): Promise<HotspotUser | null> {
    await this.guard("findHotspotUser");
    const user = this.users.find((item) => item.username === username);
    return user ? { ...user } : null;
  }

  async createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser> {
    await this.guard("createHotspotUser");

    if (this.users.some((item) => item.username === user.username)) {
      throw new RouterAdapterError("duplicate_user", "Hotspot user already exists");
    }

    const plan = this.findPlan(user.planId);
    const created: HotspotUser = {
      comment: user.comment ?? null,
      createdAt: new Date(0).toISOString(),
      id: `user-${slugify(user.username)}`,
      passwordSecretRef: user.passwordSecretRef,
      planId: user.planId,
      profileName: plan.profileName,
      serverName: user.serverName ?? "all",
      status: "available",
      username: user.username
    };

    this.users = [...this.users, created];
    return { ...created };
  }

  async updateHotspotUser(username: string, planId: string): Promise<HotspotUser> {
    await this.guard("updateHotspotUser");
    const user = this.findUser(username);
    const plan = this.findPlan(planId);
    const updated = { ...user, planId: plan.id, profileName: plan.profileName };

    this.users = this.users.map((item) => (item.username === username ? updated : item));
    return { ...updated };
  }

  async createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]> {
    await this.guard("createHotspotUsersBatch");

    if (batch.quantity < 1) {
      throw new RouterAdapterError("permission_denied", "Batch quantity must be positive");
    }

    const plan = this.findPlan(batch.planId);
    const generator = new TicketCodeGenerator();
    const generatedCodes = generator.generate({
      codeLength: batch.codeLength ?? 6,
      existingTickets: this.users,
      prefix: batch.prefix ?? "",
      quantity: batch.quantity,
      routerId: this.router.id
    }).codes;
    const createdUsers: HotspotUser[] = [];

    for (const generatedCode of generatedCodes) {
      createdUsers.push({
        comment: `Lot créé par ${batch.createdByProfile ?? "operateur"}`,
        createdAt: new Date(0).toISOString(),
        id: `user-${slugify(generatedCode.username)}`,
        passwordSecretRef: generatedCode.passwordSecretRef,
        planId: batch.planId,
        profileName: plan.profileName,
        serverName: batch.serverName ?? "all",
        status: "available",
        username: generatedCode.username
      });
    }

    this.users = [...this.users, ...createdUsers];
    return createdUsers.map((user) => ({ ...user }));
  }

  async disableHotspotUser(username: string): Promise<HotspotUser> {
    await this.guard("disableHotspotUser");
    const user = this.findUser(username);
    const updated: HotspotUser = { ...user, status: "disabled" };

    this.users = this.users.map((item) => (item.username === username ? updated : item));
    return { ...updated };
  }

  async enableHotspotUser(username: string): Promise<HotspotUser> {
    await this.guard("enableHotspotUser");
    const user = this.findUser(username);
    const updated: HotspotUser = { ...user, status: "available" };

    this.users = this.users.map((item) => (item.username === username ? updated : item));
    return { ...updated };
  }

  async removeHotspotUser(username: string): Promise<void> {
    await this.guard("removeHotspotUser");
    this.findUser(username);
    this.users = this.users.filter((user) => user.username !== username);
    this.activeUsers = this.activeUsers.filter((user) => user.username !== username);
  }

  async bindHotspotUserToMac(username: string, macAddress: string): Promise<HotspotUser> {
    await this.guard("bindHotspotUserToMac");
    const user = this.findUser(username);
    const updated = { ...user, macAddress: macAddress.toUpperCase() };
    this.users = this.users.map((item) => item.username === username ? updated : item);
    return { ...updated };
  }

  async clearHotspotUserMac(username: string): Promise<HotspotUser> {
    await this.guard("clearHotspotUserMac");
    const user = this.findUser(username);
    const updated = { ...user, macAddress: null };
    this.users = this.users.map((item) => item.username === username ? updated : item);
    return { ...updated };
  }

  async configureHotspotUserLifecycle(
    username: string,
    _validityMinutes: number | null
  ): Promise<HotspotUser> {
    await this.guard("configureHotspotUserLifecycle");
    return { ...this.findUser(username) };
  }

  async ensureVoucherLifecycleEngine(options?: import("../../domain/router").VoucherLifecycleEngineOptions) {
    await this.guard("ensureVoucherLifecycleEngine");
    this.lifecycleEngineInstalled = true;
    return {
      clockReady: true,
      engineVersion: 4,
      managedProfileCount: options?.managedProfileNames?.length ?? 0,
      schedulerEnabled: true
    };
  }

  async inspectManagedResources(
    options: import("../../domain/router").RouterManagedResourceInspectionOptions = {}
  ): Promise<import("../../domain/router").RouterManagedResourceManifest> {
    await this.guard("inspectManagedResources");
    const managedProfileNames = Array.from(new Set(
      (options.managedHotspotProfileNames ?? []).map((name) => name.trim()).filter(Boolean)
    )).sort();
    const resources: import("../../domain/router").RouterManagedResourceObservation[] = [
      {
        attributes: { engineVersion: 4, name: "ticketpro-voucher-expiration-v1" },
        key: "system-script:voucher-lifecycle",
        kind: "voucher_script",
        matchCount: this.lifecycleEngineInstalled ? 1 : 0,
        ownership: "ticketpro",
        state: this.lifecycleEngineInstalled ? "present" : "missing"
      },
      {
        attributes: { enabled: this.lifecycleEngineInstalled, interval: "1m" },
        key: "system-scheduler:voucher-lifecycle",
        kind: "voucher_scheduler",
        matchCount: this.lifecycleEngineInstalled ? 1 : 0,
        ownership: "ticketpro",
        state: this.lifecycleEngineInstalled ? "present" : "missing"
      },
      ...managedProfileNames.map((profileName) => ({
        attributes: { profileName },
        key: `hotspot-user-profile-extension:${profileName}`,
        kind: "hotspot_user_profile_extension" as const,
        matchCount: this.plans.some((plan) => plan.profileName === profileName) ? 1 : 0,
        ownership: "shared" as const,
        state: this.plans.some((plan) => plan.profileName === profileName) ? "present" as const : "missing" as const
      }))
    ];
    return {
      capturedAt: new Date().toISOString(),
      desired: {
        authorizedManagementCidrs: Array.from(new Set(
          (options.authorizedManagementCidrs ?? []).map((cidr) => cidr.trim()).filter(Boolean)
        )).sort(),
        managementUsername: options.managementUsername?.trim() || null,
        managedHotspotProfileNames: managedProfileNames,
        wireguardInterfaceName: options.wireguardInterfaceName?.trim() || null
      },
      resources,
      routerOsVersion: this.systemInfo.routerOsVersion,
      schemaVersion: 1,
      warnings: []
    };
  }

  async upsertManagementAccount(
    config: import("../../domain/router").RouterManagementAccountConfig
  ): Promise<import("../../domain/router").RouterManagementAccountResult> {
    await this.guard("upsertManagementAccount");
    return {
      action: "created",
      groupName: config.groupName?.trim() || "ticketpro-api",
      username: config.username.trim()
    };
  }

  async applyManagementServicePolicy(
    policy: import("../../domain/router").RouterManagementServicePolicy
  ): Promise<import("../../domain/router").RouterManagementServicePolicyResult> {
    await this.guard("applyManagementServicePolicy");
    if (!policy.currentPathConfirmed) {
      throw new Error("Le chemin d'accès actuel doit être confirmé avant le durcissement.");
    }
    return {
      disabledServices: policy.disableUnusedServices
        ? ["api-ssl", "ftp", "telnet", "www", "www-ssl"]
        : [],
      restrictedServices: ["api", "winbox"]
    };
  }

  async configureHotspotAntiTethering(
    config: import("../../domain/router").HotspotAntiTetheringConfig
  ): Promise<void> {
    await this.guard("configureHotspotAntiTethering");
    this.hotspotAntiTetheringState = {
      blockIpv4Ttl: config.enabled && config.blockIpv4Ttl,
      blockIpv6: config.enabled && config.blockIpv6,
      managedRuleCount:
        Number(config.enabled && config.blockIpv4Ttl)
        + Number(config.enabled && config.blockIpv6)
    };
  }

  async getHotspotAntiTetheringState() {
    await this.guard("getHotspotAntiTetheringState");
    return { ...this.hotspotAntiTetheringState };
  }

  async upsertHotspotBypass(
    binding: import("../../domain/router").HotspotBypassBinding
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    await this.guard("upsertHotspotBypass");
    const existing = this.hotspotBypasses.get(binding.id);
    this.hotspotBypasses.set(binding.id, { ...binding });
    return { outcome: existing ? "already_present" : "created" };
  }

  async listManagedHotspotBypasses() {
    await this.guard("listManagedHotspotBypasses");
    return Array.from(this.hotspotBypasses.values());
  }

  async removeHotspotBypass(id: string, _macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    await this.guard("removeHotspotBypass");
    return { outcome: this.hotspotBypasses.delete(id) ? "removed" : "not_found" };
  }

  async upsertHotspotBlockedDevice(
    binding: import("../../domain/router").HotspotBypassBinding
  ): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    await this.guard("upsertHotspotBlockedDevice");
    const existing = this.hotspotBlockedDevices.get(binding.id);
    this.hotspotBlockedDevices.set(binding.id, { ...binding });
    return { outcome: existing ? "already_present" : "created" };
  }

  async listManagedHotspotBlockedDevices() {
    await this.guard("listManagedHotspotBlockedDevices");
    return Array.from(this.hotspotBlockedDevices.values());
  }

  async removeHotspotBlockedDevice(id: string, _macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult> {
    await this.guard("removeHotspotBlockedDevice");
    return { outcome: this.hotspotBlockedDevices.delete(id) ? "removed" : "not_found" };
  }

  async listActiveUsers(): Promise<ActiveHotspotUser[]> {
    await this.guard("listActiveUsers");
    return this.activeUsers.map((user) => ({ ...user }));
  }

  async disconnectActiveUser(username: string): Promise<void> {
    await this.guard("disconnectActiveUser");
    this.activeUsers = this.activeUsers.filter((user) => user.username !== username);
  }

  async getRouterHealth(): Promise<RouterHealth> {
    await this.guard("getRouterHealth");

    return {
      activeClientsCount: this.activeUsers.length,
      cpuLoad: 18,
      memoryTotal: 256 * 1024 * 1024,
      memoryUsed: 84 * 1024 * 1024,
      temperatureCelsius: 44,
      uptime: this.systemInfo.uptime
    };
  }

  async getInterfaceTraffic(): Promise<InterfaceTraffic[]> {
    await this.guard("getInterfaceTraffic");

    return [
      { interfaceName: "ether1", isRunning: true, rxBytesPerSecond: 384_000, txBytesPerSecond: 92_000 },
      { interfaceName: "bridge-hotspot", isRunning: true, rxBytesPerSecond: 128_000, txBytesPerSecond: 310_000 },
      { interfaceName: "wifi1", isRunning: true, rxBytesPerSecond: 86_000, txBytesPerSecond: 240_000 }
    ];
  }

  async getRouterDateTime(): Promise<RouterDateTime> {
    await this.guard("getRouterDateTime");

    return {
      date: "2026-07-08",
      time: "11:30:00",
      timeZone: "Africa/Niamey"
    };
  }

  private async guard(action: string): Promise<void> {
    await this.simulateLatency();

    if (!this.errorMode) {
      return;
    }

    if (this.errorMode === "hotspot_not_found" && !action.toLowerCase().includes("hotspot")) {
      return;
    }

    throw new RouterAdapterError(this.errorMode, `Fake router error: ${this.errorMode}`);
  }

  private async simulateLatency(): Promise<void> {
    if (this.latencyMs <= 0) {
      return;
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, this.latencyMs));
  }

  private findPlan(planId: string): HotspotPlan {
    const plan = this.plans.find((item) => item.id === planId);

    if (!plan) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot plan not found");
    }

    return plan;
  }

  private findUser(username: string): HotspotUser {
    const user = this.users.find((item) => item.username === username);

    if (!user) {
      throw new RouterAdapterError("hotspot_not_found", "Hotspot user not found");
    }

    return user;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
