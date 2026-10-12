import type { AuthSession } from "../../domain/auth";
import type { HotspotUser } from "../../domain/router";
import type { HotspotPlanRecord, RouterRecord } from "../../domain/database";
import type { RouterService } from "../router";
import {
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterManagedResourceManifestRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository,
  type DatabaseClient
} from "../database";
import {
  normalizeMacAddress,
  routerAccessPolicyCloudId,
  RouterAccessPolicySyncService
} from "../access";
import { RouterCloudRecoveryService } from "./RouterCloudRecoveryService";
import { reconcileRouterPlanCatalog } from "./RouterPlanCatalogReconciliation";

export type RouterStateReconciliationResult = {
  blockedDeviceCount: number;
  bypassCount: number;
  managedResourceStatus: "drift" | "error" | "synced";
  managedResourceWarningCount: number;
  planCount: number;
  recoveredTicketCount: number;
  ttlIpv4Enabled: boolean;
  ttlIpv6Enabled: boolean;
};

type RouterStateReconciliationDependencies = {
  backupRouter?: (routerId: string) => Promise<unknown>;
  organizationId?: string | null;
  policies?: Pick<RouterAccessPolicySyncService, "load">;
};

export class RouterStateReconciliationService {
  private readonly connections: RouterConnectionRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly policies: Pick<RouterAccessPolicySyncService, "load">;
  private readonly managedResources: RouterManagedResourceManifestRepository;
  private readonly routers: RouterRepository;
  private readonly ticketBatches: TicketBatchRepository;
  private readonly tickets: TicketRepository;
  private readonly backupRouter: (routerId: string) => Promise<unknown>;
  private readonly organizationId: string | null;

  constructor(
    private readonly database: DatabaseClient,
    private readonly session: AuthSession,
    dependencies: RouterStateReconciliationDependencies = {}
  ) {
    this.connections = new RouterConnectionRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.policies = dependencies.policies ?? new RouterAccessPolicySyncService(database);
    this.managedResources = new RouterManagedResourceManifestRepository(database);
    this.routers = new RouterRepository(database);
    this.ticketBatches = new TicketBatchRepository(database);
    this.tickets = new TicketRepository(database);
    this.organizationId = dependencies.organizationId ?? null;
    this.backupRouter = dependencies.backupRouter ?? ((routerId) =>
      new RouterCloudRecoveryService(
        this.database,
        this.session.account_id,
        this.session.internal_profile_id,
        undefined,
        dependencies.organizationId ?? null
      ).backupRouter(routerId)
    );
  }

  async reconcile(
    router: RouterRecord,
    service: RouterService
  ): Promise<RouterStateReconciliationResult> {
    if (
      router.account_id !== this.session.account_id
      || (this.organizationId !== null && router.organization_id !== this.organizationId)
    ) {
      throw new Error("Ce routeur n'appartient pas à l'organisation active.");
    }
    const connections = await this.connections.listByRouter(router.id);
    const cloudRouterId = routerAccessPolicyCloudId(router, connections);
    const [systemInfo, actualPlans, routerUsers, policyResult, localPlansBefore] = await Promise.all([
      service.getSystemInfo(),
      service.getHotspotPlans(),
      service.listHotspotUsers(),
      this.policies.load(router.account_id, router.id, cloudRouterId),
      this.plans.listByRouter(router.id)
    ]);
    const managedProfileNames = managedLifecycleProfileNames(
      localPlansBefore,
      routerUsers
    );
    await service.ensureVoucherLifecycleEngine({
      managedProfileNames,
      planDataLimitMbByProfile: localPlanDataLimitsByProfile(localPlansBefore)
    });
    const policy = policyResult.policy;
    const strict = policy.antiSharingMode === "strict";

    await service.configureHotspotAntiTethering({
      blockIpv4Ttl: strict && policy.monitorIpv4Ttl,
      blockIpv6: strict && policy.monitorIpv6HopLimit,
      enabled: strict
    });

    const desiredBypasses = policy.infrastructureDevices.filter(
      (device) => device.internetBypass
    );
    const actualBypasses = await service.listManagedHotspotBypasses();
    const desiredIds = new Set(desiredBypasses.map((device) => device.id));
    for (const actual of actualBypasses) {
      if (!desiredIds.has(actual.id)) {
        await service.removeHotspotBypass(actual.id, actual.macAddress);
      }
    }
    for (const desired of desiredBypasses) {
      await service.upsertHotspotBypass({
        address: desired.ipAddress,
        comment: `${desired.name} (${desired.type})`,
        id: desired.id,
        macAddress: desired.macAddress
      });
    }

    const desiredBlockedDevices = policy.blockedDevices;
    const actualBlockedDevices = await service.listManagedHotspotBlockedDevices();
    const desiredBlockedIds = new Set(desiredBlockedDevices.map((device) => device.id));
    for (const actual of actualBlockedDevices) {
      if (!desiredBlockedIds.has(actual.id)) {
        await service.removeHotspotBlockedDevice(actual.id, actual.macAddress);
      }
    }
    for (const desired of desiredBlockedDevices) {
      await service.upsertHotspotBlockedDevice({
        address: desired.ipAddress,
        comment: desired.name,
        id: desired.id,
        macAddress: desired.macAddress
      });
    }

    await this.reconcilePlans(router.id, actualPlans);
    await this.reconcileVoucherLifecycle(router.id, routerUsers, service);
    const recoveredTicketCount = await this.reconcileTickets(router, routerUsers);
    const [verifiedTtl, verifiedBypasses, verifiedBlockedDevices] = await Promise.all([
      service.getHotspotAntiTetheringState(),
      service.listManagedHotspotBypasses(),
      service.listManagedHotspotBlockedDevices()
    ]);
    const expectedIpv4 = strict && policy.monitorIpv4Ttl;
    const expectedIpv6 = strict && policy.monitorIpv6HopLimit;
    if (
      verifiedTtl.blockIpv4Ttl !== expectedIpv4
      || verifiedTtl.blockIpv6 !== expectedIpv6
    ) {
      throw new Error("RouterOS n'a pas confirmé l'état réel des protections TTL/IPv6.");
    }
    for (const desired of desiredBypasses) {
      const actual = verifiedBypasses.find((binding) => binding.id === desired.id);
      if (
        !actual
        || actual.address !== desired.ipAddress
        || normalizeMacAddress(actual.macAddress) !== normalizeMacAddress(desired.macAddress)
      ) {
        throw new Error(`RouterOS n'a pas confirmé le bypass de ${desired.name}.`);
      }
    }
    for (const desired of desiredBlockedDevices) {
      const actual = verifiedBlockedDevices.find((binding) => binding.id === desired.id);
      if (
        !actual
        || actual.address !== desired.ipAddress
        || normalizeMacAddress(actual.macAddress) !== normalizeMacAddress(desired.macAddress)
      ) {
        throw new Error(`RouterOS n'a pas confirmé le blocage de ${desired.name}.`);
      }
    }

    let managedResourceStatus: RouterStateReconciliationResult["managedResourceStatus"] = "error";
    let managedResourceWarningCount = 0;
    try {
      const manifest = await service.inspectManagedResources({
        authorizedManagementCidrs: managementCidrs(router),
        managementUsername: "ticketpro-api",
        managedHotspotProfileNames: managedProfileNames,
        wireguardInterfaceName: router.connection_mode === "vpn" ? "ticketpro-vpn" : null
      });
      const storedManifest = await this.managedResources.save(
        router.account_id,
        router.id,
        manifest
      );
      managedResourceStatus = storedManifest.record.status;
      managedResourceWarningCount = manifest.warnings.length;
    } catch (error) {
      await this.managedResources.markError(router.account_id, router.id, error);
    }

    const updatedRouter = await this.routers.update({
      ...router,
      board_name: systemInfo.boardName,
      last_seen_at: new Date().toISOString(),
      model: systemInfo.model,
      routeros_version: systemInfo.routerOsVersion,
      serial_number: systemInfo.serialNumber,
      status: "active",
      sync_status: "synced",
      updated_at: new Date().toISOString()
    });
    try {
      await this.backupRouter(updatedRouter.id);
    } catch {
      // RouterOS a déjà été confirmé. Une panne Internet ne doit pas remettre
      // le routeur en brouillon ; la sauvegarde globale la retentera ensuite.
    }

    return {
      blockedDeviceCount: desiredBlockedDevices.length,
      bypassCount: desiredBypasses.length,
      managedResourceStatus,
      managedResourceWarningCount,
      planCount: actualPlans.length,
      recoveredTicketCount,
      ttlIpv4Enabled: verifiedTtl.blockIpv4Ttl,
      ttlIpv6Enabled: verifiedTtl.blockIpv6
    };
  }

  private async reconcileTickets(
    router: RouterRecord,
    routerUsers: HotspotUser[]
  ): Promise<number> {
    const [localTickets, localPlans] = await Promise.all([
      this.tickets.listByRouter(router.id),
      this.plans.listByRouter(router.id)
    ]);
    const existingUsernames = new Set(localTickets.map((ticket) => ticket.username));
    const missingUsers = routerUsers.filter((user) => !existingUsernames.has(user.username));
    const usersByPlan = new Map<string, HotspotUser[]>();

    for (const user of missingUsers) {
      const plan = localPlans.find((candidate) =>
        candidate.mikrotik_profile_name === user.profileName
        || candidate.mikrotik_profile_name === user.planId
        || candidate.name === user.profileName
      );
      if (!plan) continue;
      const grouped = usersByPlan.get(plan.id) ?? [];
      grouped.push(user);
      usersByPlan.set(plan.id, grouped);
    }

    let recovered = 0;
    for (const [planId, users] of usersByPlan) {
      const plan = localPlans.find((candidate) => candidate.id === planId);
      if (!plan) continue;
      const batchId = `batch-recovered-${crypto.randomUUID()}`;
      await this.ticketBatches.createWithTickets({
        account_id: router.account_id,
        code_length: Math.max(...users.map((user) => user.username.length)),
        created_by_profile: this.session.internal_profile_role,
        created_by_profile_id: this.session.internal_profile_id,
        generated_file_id: null,
        id: batchId,
        operator_profile: this.session.internal_profile_role,
        plan_id: planId,
        prefix: null,
        quantity: users.length,
        router_id: router.id,
        status: "recovered",
        sync_status: "synced"
      }, users.map((user) => ({
        account_id: router.account_id,
        activated_at: user.uptime && user.uptime !== "0s" ? new Date().toISOString() : null,
        batch_id: batchId,
        completed_at: user.status === "expired" || user.status === "exhausted"
          ? new Date().toISOString()
          : null,
        created_by_profile: this.session.internal_profile_role,
        created_by_profile_id: this.session.internal_profile_id,
        deleted_at: null,
        data_limit_mb_snapshot: plan.data_limit_mb,
        downloaded_bytes: user.downloadedBytes ?? 0,
        download_limit_snapshot: plan.download_limit,
        duration_minutes_snapshot: plan.duration_minutes,
        expires_at: null,
        id: `ticket-recovered-${crypto.randomUUID()}`,
        ip_address: null,
        mac_address: user.macAddress ?? null,
        mikrotik_id: user.id,
        password_encrypted: user.passwordSecretRef,
        plan_id: planId,
        printed_count: 0,
        router_id: router.id,
        status:
          user.status === "expired"
            ? "expiré"
            : user.status === "exhausted"
              ? "consommé"
            : user.status === "disabled"
              ? "désactivé"
              : "disponible",
        sync_status: "synced",
        shared_users_snapshot: plan.shared_users,
        uploaded_bytes: user.uploadedBytes ?? 0,
        upload_limit_snapshot: plan.upload_limit,
        validity_minutes_snapshot: plan.validity_minutes ?? plan.duration_minutes,
        username: user.username
      })));
      recovered += users.length;
    }
    return recovered;
  }

  private async reconcileVoucherLifecycle(
    routerId: string,
    routerUsers: HotspotUser[],
    service: RouterService
  ): Promise<void> {
    const localPlans = await this.plans.listByRouter(routerId);
    for (const user of routerUsers) {
      const plan = localPlans.find((candidate) =>
        candidate.mikrotik_profile_name === user.profileName
        || candidate.mikrotik_profile_name === user.planId
        || candidate.name === user.profileName
      );
      if (!plan) continue;
      const validityMinutes = plan.validity_minutes ?? plan.duration_minutes;
      await service.configureHotspotUserLifecycle(
        user.username,
        validityMinutes && validityMinutes > 0 ? validityMinutes : null
      );
    }
  }

  private async reconcilePlans(
    routerId: string,
    actualPlans: Awaited<ReturnType<RouterService["getHotspotPlans"]>>
  ): Promise<void> {
    await reconcileRouterPlanCatalog({
      plans: actualPlans,
      repository: this.plans,
      routerId
    });
  }
}

/** Local plan quotas by RouterOS profile, so RouterOS enforces them itself. */
function localPlanDataLimitsByProfile(localPlans: HotspotPlanRecord[]): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const plan of localPlans) {
    if (plan.deleted_at) continue;
    const name = plan.mikrotik_profile_name?.trim() || plan.name.trim();
    if (name) limits[name] = plan.data_limit_mb ?? null;
  }
  return limits;
}

function managedLifecycleProfileNames(
  localPlans: HotspotPlanRecord[],
  routerUsers: HotspotUser[]
): string[] {
  const names = new Set<string>();
  for (const plan of localPlans) {
    if (!plan.created_by_profile_id) continue;
    const name = plan.mikrotik_profile_name?.trim() || plan.name.trim();
    if (name && name.toLowerCase() !== "default") names.add(name);
  }
  for (const user of routerUsers) {
    if (!user.comment?.startsWith("TicketPro:v1;")) continue;
    const name = user.profileName.trim();
    if (name && name.toLowerCase() !== "default") names.add(name);
  }
  return Array.from(names).sort();
}

function managementCidrs(router: RouterRecord): string[] {
  const cidrs = new Set<string>(["10.250.0.0/16"]);
  const octets = router.local_ip.trim().split(".").map(Number);
  if (
    octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    cidrs.add(`${octets[0]}.${octets[1]}.${octets[2]}.0/24`);
  }
  return Array.from(cidrs).sort();
}
