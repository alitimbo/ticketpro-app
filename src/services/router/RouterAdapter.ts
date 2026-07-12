import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
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
  createHotspotUser(user: HotspotUserDraft): Promise<HotspotUser>;
  createHotspotUsersBatch(batch: HotspotUsersBatchDraft): Promise<HotspotUser[]>;
  disableHotspotUser(username: string): Promise<HotspotUser>;
  removeHotspotUser(username: string): Promise<void>;
  listActiveUsers(): Promise<ActiveHotspotUser[]>;
  disconnectActiveUser(username: string): Promise<void>;
  getRouterHealth(): Promise<RouterHealth>;
  getInterfaceTraffic(): Promise<InterfaceTraffic[]>;
  getRouterDateTime(): Promise<RouterDateTime>;
}
