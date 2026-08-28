import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotAntiTetheringConfig,
  HotspotBypassBinding,
  HotspotDnsConfigurationResult,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUserLimits,
  HotspotUsersBatchDraft,
  InterfaceTraffic,
  RouterConnectionTest,
  RouterDateTime,
  RouterHealth,
  RouterSystemInfo
} from "../../domain/router";

export interface RouterAdapter {
  testConnection(): Promise<RouterConnectionTest>;
  getSystemInfo(): Promise<RouterSystemInfo>;
  getHotspotServers(): Promise<HotspotServer[]>;
  upsertHotspotDns(dnsName: string): Promise<HotspotDnsConfigurationResult>;
  getHotspotPlans(): Promise<HotspotPlan[]>;
  ensureVoucherLifecycleEngine(
    options?: import("../../domain/router").VoucherLifecycleEngineOptions
  ): Promise<import("../../domain/router").VoucherLifecycleEngineState>;
  inspectManagedResources(
    options?: import("../../domain/router").RouterManagedResourceInspectionOptions
  ): Promise<import("../../domain/router").RouterManagedResourceManifest>;
  upsertManagementAccount(
    config: import("../../domain/router").RouterManagementAccountConfig
  ): Promise<import("../../domain/router").RouterManagementAccountResult>;
  applyManagementServicePolicy(
    policy: import("../../domain/router").RouterManagementServicePolicy
  ): Promise<import("../../domain/router").RouterManagementServicePolicyResult>;
  createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan>;
  updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>): Promise<HotspotPlan>;
  deleteHotspotPlan(planId: string): Promise<void>;
  listHotspotUsers(): Promise<HotspotUser[]>;
  findHotspotUser(username: string): Promise<HotspotUser | null>;
  updateHotspotUser(username: string, planId: string, limits?: HotspotUserLimits): Promise<HotspotUser>;
  configureHotspotUserLifecycle(username: string, validityMinutes: number | null): Promise<HotspotUser>;
  createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser>;
  createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]>;
  disableHotspotUser(username: string): Promise<HotspotUser>;
  enableHotspotUser(username: string): Promise<HotspotUser>;
  removeHotspotUser(username: string): Promise<void>;
  bindHotspotUserToMac(username: string, macAddress: string): Promise<HotspotUser>;
  clearHotspotUserMac(username: string): Promise<HotspotUser>;
  configureHotspotAntiTethering(config: HotspotAntiTetheringConfig): Promise<void>;
  getHotspotAntiTetheringState(): Promise<import("../../domain/router").HotspotAntiTetheringState>;
  upsertHotspotBypass(binding: HotspotBypassBinding): Promise<import("../../domain/router").HotspotIpBindingMutationResult>;
  listManagedHotspotBypasses(): Promise<HotspotBypassBinding[]>;
  removeHotspotBypass(id: string, macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult>;
  upsertHotspotBlockedDevice(binding: HotspotBypassBinding): Promise<import("../../domain/router").HotspotIpBindingMutationResult>;
  listManagedHotspotBlockedDevices(): Promise<HotspotBypassBinding[]>;
  removeHotspotBlockedDevice(id: string, macAddress: string): Promise<import("../../domain/router").HotspotIpBindingMutationResult>;
  listActiveUsers(): Promise<ActiveHotspotUser[]>;
  disconnectActiveUser(username: string): Promise<void>;
  getRouterHealth(): Promise<RouterHealth>;
  getInterfaceTraffic(): Promise<InterfaceTraffic[]>;
  getRouterDateTime(): Promise<RouterDateTime>;
  getWireGuardInstallation(interfaceName: string): Promise<import("../../domain/router").RouterWireGuardInstallation | null>;
  provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig): Promise<void>;
  removeWireGuardPeer(reference: import("../../domain/router").RouterWireGuardPeerReference): Promise<void>;
}
