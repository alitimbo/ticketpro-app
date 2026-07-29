import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotBypassBinding,
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
  getHotspotPlans(): Promise<HotspotPlan[]>;
  createHotspotPlan(plan: HotspotPlanDraft): Promise<HotspotPlan>;
  updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>): Promise<HotspotPlan>;
  deleteHotspotPlan(planId: string): Promise<void>;
  listHotspotUsers(): Promise<HotspotUser[]>;
  updateHotspotUser(username: string, planId: string, limits?: HotspotUserLimits): Promise<HotspotUser>;
  createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser>;
  createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]>;
  disableHotspotUser(username: string): Promise<HotspotUser>;
  enableHotspotUser(username: string): Promise<HotspotUser>;
  removeHotspotUser(username: string): Promise<void>;
  bindHotspotUserToMac(username: string, macAddress: string): Promise<HotspotUser>;
  clearHotspotUserMac(username: string): Promise<HotspotUser>;
  upsertHotspotBypass(binding: HotspotBypassBinding): Promise<void>;
  removeHotspotBypass(id: string, macAddress: string): Promise<void>;
  listActiveUsers(): Promise<ActiveHotspotUser[]>;
  disconnectActiveUser(username: string): Promise<void>;
  getRouterHealth(): Promise<RouterHealth>;
  getInterfaceTraffic(): Promise<InterfaceTraffic[]>;
  getRouterDateTime(): Promise<RouterDateTime>;
  provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig): Promise<void>;
  removeWireGuardPeer(reference: import("../../domain/router").RouterWireGuardPeerReference): Promise<void>;
}
