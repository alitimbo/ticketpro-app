import type { HotspotPlanRecord } from "../../domain/database";
import type {
  HotspotPlanDraft,
  HotspotUserDraft,
  HotspotUsersBatchDraft,
  RouterWireGuardConfig,
  RouterWireGuardPeerReference
} from "../../domain/router";
import type { RouterAdapter } from "./RouterAdapter";

/**
 * Keeps SQLite identifiers local while every RouterOS write uses the real
 * MikroTik profile name. It also materializes the time/data limits stored on
 * the local plan into enforceable Hotspot user properties.
 */
export class PersistedPlanMappingRouterAdapter implements RouterAdapter {
  constructor(
    private readonly delegate: RouterAdapter,
    private readonly plans: HotspotPlanRecord[]
  ) {}

  testConnection() {
    return this.delegate.testConnection();
  }

  getSystemInfo() {
    return this.delegate.getSystemInfo();
  }

  getHotspotServers() {
    return this.delegate.getHotspotServers();
  }

  getHotspotPlans() {
    return this.delegate.getHotspotPlans();
  }

  createHotspotPlan(plan: HotspotPlanDraft) {
    return this.delegate.createHotspotPlan(plan);
  }

  updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>) {
    return this.delegate.updateHotspotPlan(this.resolveProfileReference(planId), updates);
  }

  deleteHotspotPlan(planId: string) {
    return this.delegate.deleteHotspotPlan(this.resolveProfileReference(planId));
  }

  listHotspotUsers() {
    return this.delegate.listHotspotUsers();
  }

  updateHotspotUser(username: string, planId: string) {
    return this.delegate.updateHotspotUser(username, this.resolveProfileReference(planId));
  }

  createHotspotUser(user: HotspotUserDraft) {
    return this.delegate.createHotspotUser(this.mapUserDraft(user));
  }

  createHotspotUsersBatch(batch: HotspotUsersBatchDraft) {
    const plan = this.findPlan(batch.planId);
    return this.delegate.createHotspotUsersBatch({
      ...batch,
      limitBytesTotal: batch.limitBytesTotal ?? dataLimitMbToBytes(plan?.data_limit_mb),
      limitUptime: batch.limitUptime ?? durationMinutesToRouterOs(plan?.duration_minutes),
      planId: this.resolveProfileReference(batch.planId)
    });
  }

  disableHotspotUser(username: string) {
    return this.delegate.disableHotspotUser(username);
  }

  removeHotspotUser(username: string) {
    return this.delegate.removeHotspotUser(username);
  }

  listActiveUsers() {
    return this.delegate.listActiveUsers();
  }

  disconnectActiveUser(username: string) {
    return this.delegate.disconnectActiveUser(username);
  }

  getRouterHealth() {
    return this.delegate.getRouterHealth();
  }

  getInterfaceTraffic() {
    return this.delegate.getInterfaceTraffic();
  }

  getRouterDateTime() {
    return this.delegate.getRouterDateTime();
  }

  provisionWireGuard(config: RouterWireGuardConfig) {
    return this.delegate.provisionWireGuard(config);
  }

  removeWireGuardPeer(reference: RouterWireGuardPeerReference) {
    return this.delegate.removeWireGuardPeer(reference);
  }

  private mapUserDraft(user: HotspotUserDraft): HotspotUserDraft {
    const plan = this.findPlan(user.planId);
    return {
      ...user,
      limitBytesTotal: user.limitBytesTotal ?? dataLimitMbToBytes(plan?.data_limit_mb),
      limitUptime: user.limitUptime ?? durationMinutesToRouterOs(plan?.duration_minutes),
      planId: this.resolveProfileReference(user.planId)
    };
  }

  private resolveProfileReference(planId: string): string {
    const plan = this.findPlan(planId);
    return plan?.mikrotik_profile_name?.trim() || plan?.name.trim() || planId;
  }

  private findPlan(reference: string): HotspotPlanRecord | undefined {
    return this.plans.find(
      (plan) =>
        plan.id === reference ||
        plan.mikrotik_profile_name === reference ||
        plan.name === reference
    );
  }
}

function dataLimitMbToBytes(value: number | null | undefined): number | null {
  if (!value || value <= 0) {
    return null;
  }

  return Math.round(value * 1024 * 1024);
}

function durationMinutesToRouterOs(value: number | null | undefined): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1440 && value % 1440 === 0) {
    return `${value / 1440}d`;
  }

  if (value >= 60 && value % 60 === 0) {
    return `${value / 60}h`;
  }

  return `${value}m`;
}
