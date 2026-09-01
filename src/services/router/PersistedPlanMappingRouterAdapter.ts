import type { HotspotPlanRecord } from "../../domain/database";
import type {
  HotspotPlanDraft,
  HotspotUserDraft,
  HotspotUsersBatchDraft,
  RouterWireGuardConfig,
  RouterWireGuardPeerReference
} from "../../domain/router";
import {
  runExactHotspotUserCreationFallback,
  type RouterAdapter
} from "./RouterAdapter";

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

  upsertHotspotDns(dnsName: string) {
    return this.delegate.upsertHotspotDns(dnsName);
  }

  getHotspotPlans() {
    return this.delegate.getHotspotPlans();
  }

  ensureVoucherLifecycleEngine(options?: import("../../domain/router").VoucherLifecycleEngineOptions) {
    return this.delegate.ensureVoucherLifecycleEngine(options);
  }

  inspectManagedResources(options?: import("../../domain/router").RouterManagedResourceInspectionOptions) {
    return this.delegate.inspectManagedResources(options);
  }

  upsertManagementAccount(config: import("../../domain/router").RouterManagementAccountConfig) {
    return this.delegate.upsertManagementAccount(config);
  }

  applyManagementServicePolicy(policy: import("../../domain/router").RouterManagementServicePolicy) {
    return this.delegate.applyManagementServicePolicy(policy);
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

  listHotspotUsersForVerification() {
    return this.delegate.listHotspotUsersForVerification
      ? this.delegate.listHotspotUsersForVerification()
      : this.delegate.listHotspotUsers();
  }

  listHotspotUsernames() {
    return this.delegate.listHotspotUsernames
      ? this.delegate.listHotspotUsernames()
      : this.delegate.listHotspotUsers().then((users) =>
          users.map((user) => ({ username: user.username }))
        );
  }

  findHotspotUser(username: string) {
    return this.delegate.findHotspotUser(username);
  }

  updateHotspotUser(
    username: string,
    planId: string,
    limits?: import("../../domain/router").HotspotUserLimits
  ) {
    const plan = this.findPlan(planId);
    return this.delegate.updateHotspotUser(
      username,
      this.resolveProfileReference(planId),
      limits ?? (plan ? {
        limitBytesTotal: dataLimitMbToBytes(plan?.data_limit_mb),
        limitUptime: durationMinutesToRouterOs(plan?.duration_minutes)
      } : undefined)
    );
  }

  createHotspotUser(user: HotspotUserDraft) {
    return this.delegate.createHotspotUser(this.mapUserDraft(user));
  }

  createHotspotUsersExactBatch(
    users: HotspotUserDraft[],
    onProgress?: Parameters<NonNullable<RouterAdapter["createHotspotUsersExactBatch"]>>[1]
  ) {
    const mappedUsers = users.map((user) => this.mapUserDraft(user));
    if (this.delegate.createHotspotUsersExactBatch) {
      return this.delegate.createHotspotUsersExactBatch(mappedUsers, onProgress);
    }

    return runExactHotspotUserCreationFallback(this.delegate, mappedUsers, onProgress);
  }

  createHotspotUsersBatch(batch: HotspotUsersBatchDraft) {
    const plan = this.findPlan(batch.planId);
    return this.delegate.createHotspotUsersBatch({
      ...batch,
      limitBytesTotal: batch.limitBytesTotal ?? dataLimitMbToBytes(plan?.data_limit_mb),
      limitUptime: batch.limitUptime ?? durationMinutesToRouterOs(plan?.duration_minutes),
      validityMinutes: batch.validityMinutes ?? effectiveValidityMinutes(plan),
      planId: this.resolveProfileReference(batch.planId)
    });
  }

  disableHotspotUser(username: string) {
    return this.delegate.disableHotspotUser(username);
  }

  enableHotspotUser(username: string) {
    return this.delegate.enableHotspotUser(username);
  }

  removeHotspotUser(username: string) {
    return this.delegate.removeHotspotUser(username);
  }

  removeHotspotUsersBatch(
    usernames: string[],
    batchId?: string,
    onProgress?: Parameters<NonNullable<RouterAdapter["removeHotspotUsersBatch"]>>[2]
  ) {
    if (this.delegate.removeHotspotUsersBatch) {
      return this.delegate.removeHotspotUsersBatch(usernames, batchId, onProgress);
    }
    onProgress?.({ completed: 0, phase: "removing", total: usernames.length });
    let completed = 0;
    return Promise.all(usernames.map(async (username) => {
      try {
        await this.delegate.removeHotspotUser(username);
        return { status: "removed" as const, username };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "Suppression RouterOS impossible.",
          status: "error" as const,
          username
        };
      } finally {
        completed += 1;
        onProgress?.({ completed, phase: "removing", total: usernames.length });
      }
    })).then((results) => {
      onProgress?.({ completed, phase: "verifying", total: usernames.length });
      return results;
    });
  }

  bindHotspotUserToMac(username: string, macAddress: string) {
    return this.delegate.bindHotspotUserToMac(username, macAddress);
  }

  clearHotspotUserMac(username: string) {
    return this.delegate.clearHotspotUserMac(username);
  }

  configureHotspotUserLifecycle(username: string, validityMinutes: number | null) {
    return this.delegate.configureHotspotUserLifecycle(username, validityMinutes);
  }

  configureHotspotAntiTethering(
    config: import("../../domain/router").HotspotAntiTetheringConfig
  ) {
    return this.delegate.configureHotspotAntiTethering(config);
  }

  getHotspotAntiTetheringState() {
    return this.delegate.getHotspotAntiTetheringState();
  }

  upsertHotspotBypass(binding: import("../../domain/router").HotspotBypassBinding) {
    return this.delegate.upsertHotspotBypass(binding);
  }

  listManagedHotspotBypasses() {
    return this.delegate.listManagedHotspotBypasses();
  }

  removeHotspotBypass(id: string, macAddress: string) {
    return this.delegate.removeHotspotBypass(id, macAddress);
  }

  upsertHotspotBlockedDevice(binding: import("../../domain/router").HotspotBypassBinding) {
    return this.delegate.upsertHotspotBlockedDevice(binding);
  }

  listManagedHotspotBlockedDevices() {
    return this.delegate.listManagedHotspotBlockedDevices();
  }

  removeHotspotBlockedDevice(id: string, macAddress: string) {
    return this.delegate.removeHotspotBlockedDevice(id, macAddress);
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

  getWireGuardInstallation(interfaceName: string) {
    return this.delegate.getWireGuardInstallation(interfaceName);
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
      validityMinutes: user.validityMinutes ?? effectiveValidityMinutes(plan),
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

function effectiveValidityMinutes(
  plan: HotspotPlanRecord | undefined
): number | null {
  const value = plan?.validity_minutes ?? plan?.duration_minutes;
  return value && value > 0 ? value : null;
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
