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

export type HotspotUserBatchRemovalResult = {
  message?: string;
  status: "error" | "removed";
  username: string;
};

export type HotspotUserBatchRemovalProgress = {
  completed: number;
  phase: "removing" | "verifying";
  total: number;
};

export type HotspotUserBatchCreationResult = {
  message?: string;
  status: "confirmed" | "error";
  user?: HotspotUser;
  username: string;
};

export type HotspotUserBatchCreationProgress = {
  completed: number;
  phase: "creating" | "verifying";
  total: number;
};

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
  listTicketProManagedVoucherUsernames?(): Promise<string[]>;
  listHotspotUsersForVerification?(): Promise<HotspotUser[]>;
  setHotspotUserQuota?(username: string, limitBytesTotal: number): Promise<HotspotUser>;
  listHotspotUsernames?(): Promise<Array<{ username: string }>>;
  findHotspotUser(username: string): Promise<HotspotUser | null>;
  updateHotspotUser(username: string, planId: string, limits?: HotspotUserLimits): Promise<HotspotUser>;
  configureHotspotUserLifecycle(username: string, validityMinutes: number | null): Promise<HotspotUser>;
  createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser>;
  createHotspotUsersExactBatch?(
    users: HotspotUserDraft[],
    onProgress?: (progress: HotspotUserBatchCreationProgress) => void
  ): Promise<HotspotUserBatchCreationResult[]>;
  createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]>;
  disableHotspotUser(username: string): Promise<HotspotUser>;
  enableHotspotUser(username: string): Promise<HotspotUser>;
  removeHotspotUser(username: string): Promise<void>;
  removeHotspotUsersBatch?(
    usernames: string[],
    batchId?: string,
    onProgress?: (progress: HotspotUserBatchRemovalProgress) => void
  ): Promise<HotspotUserBatchRemovalResult[]>;
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

export async function runExactHotspotUserCreationFallback(
  adapter: Pick<RouterAdapter, "createHotspotUser">,
  users: HotspotUserDraft[],
  onProgress?: (progress: HotspotUserBatchCreationProgress) => void
): Promise<HotspotUserBatchCreationResult[]> {
  const results = new Array<HotspotUserBatchCreationResult>(users.length);
  let completed = 0;
  let nextIndex = 0;
  onProgress?.({ completed, phase: "creating", total: users.length });

  await Promise.all(
    Array.from({ length: Math.min(3, users.length) }, async () => {
      while (nextIndex < users.length) {
        const index = nextIndex;
        nextIndex += 1;
        const draft = users[index];
        try {
          const user = await adapter.createHotspotUser(draft);
          results[index] = { status: "confirmed", user, username: draft.username };
        } catch (error) {
          results[index] = {
            message: error instanceof Error ? error.message : "Création RouterOS impossible.",
            status: "error",
            username: draft.username
          };
        }
        completed += 1;
        onProgress?.({ completed, phase: "creating", total: users.length });
      }
    })
  );

  onProgress?.({ completed, phase: "verifying", total: users.length });
  return results;
}
