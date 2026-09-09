import type {
  CreateHotspotPlanInput,
  CreateRouterConnectionInput,
  CreateRouterInput
} from "../../domain/database";
import {
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  VpnNetworkRepository,
  VpnPeerRepository,
  type DatabaseClient
} from "../database";
import { routerAccessPolicyCloudId } from "../access/routerAccessPolicyIdentity";
import { decryptLocalSecret, encryptLocalSecret } from "../security/localSecrets";
import {
  bootstrapSaasVpn,
  getSaasRouterRecoverySnapshots,
  getSaasRouterRecoveryState,
  saveSaasRouterRecoverySnapshot,
  type SaasRouterRecoverySnapshot
} from "../saas";

export type RouterRecoveryResult = {
  restoredRouterIds: string[];
  skippedRouterIds: string[];
};

type RouterRecoveryCloudClient = {
  bootstrapVpn: typeof bootstrapSaasVpn;
  getSnapshots: typeof getSaasRouterRecoverySnapshots;
  getState?: typeof getSaasRouterRecoveryState;
  saveSnapshot: typeof saveSaasRouterRecoverySnapshot;
};

const defaultCloudClient: RouterRecoveryCloudClient = {
  bootstrapVpn: bootstrapSaasVpn,
  getSnapshots: getSaasRouterRecoverySnapshots,
  getState: getSaasRouterRecoveryState,
  saveSnapshot: saveSaasRouterRecoverySnapshot
};

const activeRecoveryRuns = new Map<string, Promise<RouterRecoveryResult>>();

export class RouterCloudRecoveryService {
  private readonly connections: RouterConnectionRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly routers: RouterRepository;
  private readonly vpnNetworks: VpnNetworkRepository;
  private readonly vpnPeers: VpnPeerRepository;

  constructor(
    private readonly database: DatabaseClient,
    private readonly accountId: string,
    private readonly internalProfileId: string,
    private readonly cloud: RouterRecoveryCloudClient = defaultCloudClient,
    private readonly organizationId: string | null = null
  ) {
    this.connections = new RouterConnectionRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.routers = new RouterRepository(database);
    this.vpnNetworks = new VpnNetworkRepository(database);
    this.vpnPeers = new VpnPeerRepository(database);
  }

  async backupRouter(routerId: string): Promise<SaasRouterRecoverySnapshot> {
    const router = await this.routers.findById(routerId);
    if (
      !router
      || router.account_id !== this.accountId
      || router.deleted_at
      || (this.organizationId && router.organization_id !== this.organizationId)
    ) {
      throw new Error("Routeur local introuvable pour la sauvegarde cloud.");
    }
    const [connections, plans, vpnPeer] = await Promise.all([
      this.connections.listByRouter(router.id),
      this.plans.listByRouter(router.id),
      this.vpnPeers.findByRouter(this.accountId, router.id)
    ]);
    const credential = await decryptLocalSecret(router.encrypted_password);
    const planHistoryById = new Map(
      await Promise.all(plans.map(async (plan) => [
        plan.id,
        (await this.plans.listHistory(plan.id)).slice(0, 500)
      ] as const))
    );
    const saved = await this.cloud.saveSnapshot({
      api_port: router.api_port,
      api_ssl_port: router.api_ssl_port,
      board_name: router.board_name,
      connection_mode: router.connection_mode,
      connections: connections.map((connection) => ({
        host: connection.host,
        mode: connection.mode,
        port: connection.port,
        status: connection.status === "active" ? "active" : "inactive",
        use_ssl: connection.use_ssl === 1
      })),
      credential,
      hotspot_address: router.hotspot_address,
      id: router.cloud_router_id ?? router.id,
      label: router.label,
      last_seen_at: router.last_seen_at,
      local_ip: router.local_ip,
      model: router.model,
      name: router.name,
      notes: router.notes,
      plans: plans.map((plan) => ({
        created_at: plan.created_at,
        created_by_profile_id: plan.created_by_profile_id,
        currency: plan.currency,
        data_limit_mb: plan.data_limit_mb,
        download_limit: plan.download_limit,
        duration_minutes: plan.duration_minutes,
        history: planHistoryById.get(plan.id) ?? [],
        id: plan.id,
        last_synced_at: plan.last_synced_at,
        mikrotik_id: plan.mikrotik_id,
        mikrotik_profile_name: plan.mikrotik_profile_name,
        name: plan.name,
        price_hint: plan.price_hint,
        revision: plan.revision,
        shared_users: plan.shared_users,
        status: plan.status,
        upload_limit: plan.upload_limit,
        updated_at: plan.updated_at,
        updated_by_profile_id: plan.updated_by_profile_id,
        validity_minutes: plan.validity_minutes
      })),
      routeros_version: router.routeros_version,
      serial_number: router.serial_number,
      stable_identity: routerAccessPolicyCloudId(router, connections),
      status: router.status === "error" ? "warning" : router.status,
      username: router.username,
      vpn: vpnPeer
        ? {
            assigned_address: vpnPeer.assigned_address,
            public_key: vpnPeer.public_key,
            status: vpnPeer.status
          }
        : null
    });
    if ((router.cloud_router_id ?? router.id) !== saved.id) {
      await this.routers.setCloudId(this.accountId, router.id, saved.id);
    }
    if (this.organizationId && router.organization_id !== this.organizationId) {
      await this.routers.setOrganizationId(this.accountId, router.id, this.organizationId);
    }
    return saved;
  }

  async backupAll(): Promise<void> {
    const routers = this.organizationId
      ? await this.routers.listByOrganization(this.accountId, this.organizationId)
      : await this.routers.listByAccount(this.accountId);
    let firstError: unknown = null;
    for (let index = 0; index < routers.length; index += 5) {
      const results = await Promise.allSettled(
        routers.slice(index, index + 5).map((router) => this.backupRouter(router.id))
      );
      firstError ??= results.find((result) => result.status === "rejected")?.reason ?? null;
    }
    if (firstError) {
      throw firstError;
    }
  }

  /** Scope local router records to the organization currently selected in SaaS. */
  async listCloudRouterIds(): Promise<Set<string>> {
    const snapshots = await this.cloud.getSnapshots();
    return new Set(snapshots.map((router) => router.id));
  }

  async restoreMissingRouters(): Promise<RouterRecoveryResult> {
    const recoveryScope = `${this.accountId}:${this.organizationId ?? "legacy"}`;
    const activeRun = activeRecoveryRuns.get(recoveryScope);
    if (activeRun) return activeRun;

    const run = this.restoreMissingRoutersOnce().finally(() => {
      if (activeRecoveryRuns.get(recoveryScope) === run) {
        activeRecoveryRuns.delete(recoveryScope);
      }
    });
    activeRecoveryRuns.set(recoveryScope, run);
    return run;
  }

  private async restoreMissingRoutersOnce(): Promise<RouterRecoveryResult> {
    const state = this.cloud.getState ? await this.cloud.getState() : null;
    if (state?.organization_id && this.organizationId && state.organization_id !== this.organizationId) {
      throw new Error("L’organisation a changé pendant la synchronisation des routeurs.");
    }
    const remoteRouters = state?.routers ?? await this.cloud.getSnapshots();
    const accountRouters = await this.routers.listByAccount(this.accountId);
    const localRouters = this.organizationId
      ? accountRouters.filter((router) => (
          router.organization_id === this.organizationId || !router.organization_id
        ))
      : accountRouters;
    const localStableIdentities = new Set<string>();
    const localByStableIdentity = new Map<string, (typeof localRouters)[number]>();
    const localByCloudId = new Map<string, (typeof localRouters)[number]>();
    for (const router of localRouters) {
      const stableIdentity = routerAccessPolicyCloudId(
        router,
        await this.connections.listByRouter(router.id)
      );
      const retirement = state?.retired?.find((item) =>
        item.router_id === (router.cloud_router_id ?? router.id) || item.stable_identity.toLowerCase() === stableIdentity.toLowerCase()
      );
      if (retirement) {
        await this.routers.retireFromCloud(this.accountId, router.id, retirement.retired_at);
        continue;
      }
      localStableIdentities.add(stableIdentity);
      localByStableIdentity.set(stableIdentity.toLowerCase(), router);
      localByCloudId.set(router.cloud_router_id ?? router.id, router);
    }

    const result: RouterRecoveryResult = {
      restoredRouterIds: [],
      skippedRouterIds: []
    };
    const vpnNetwork = remoteRouters.some((router) => router.vpn)
      ? await this.ensureVpnNetwork()
      : null;

    for (const remote of remoteRouters) {
      try {
        const existing = localByCloudId.get(remote.id)
          ?? localByStableIdentity.get(remote.stable_identity.toLowerCase());
        if (existing) {
          if (existing.cloud_router_id !== remote.id) {
            await this.routers.setCloudId(this.accountId, existing.id, remote.id);
          }
          if (this.organizationId && existing.organization_id !== this.organizationId) {
            await this.routers.setOrganizationId(this.accountId, existing.id, this.organizationId);
          }
          await this.restoreMissingDependents(remote, existing.id, vpnNetwork);
          result.skippedRouterIds.push(remote.id);
          continue;
        }

        const occupiedGlobalId = await this.routers.findById(remote.id);
        const localRouterId = occupiedGlobalId
          ? `router-${crypto.randomUUID()}`
          : remote.id;
        const encryptedPassword = await encryptLocalSecret(remote.credential);
        const restoredRouter = await this.routers.create(routerInputFromRecovery(
          remote,
          localRouterId,
          this.accountId,
          this.internalProfileId,
          encryptedPassword,
          this.organizationId
        ));
        await this.restoreMissingDependents(remote, localRouterId, vpnNetwork);
        localStableIdentities.add(remote.stable_identity);
        localByCloudId.set(remote.id, restoredRouter);
        result.restoredRouterIds.push(localRouterId);
      } catch (error) {
        throw new Error(
          `Restauration de ${remote.name} interrompue : ${unknownErrorMessage(error)}`
        );
      }
    }

    return result;
  }

  private async restoreMissingDependents(
    remote: SaasRouterRecoverySnapshot,
    localRouterId: string,
    vpnNetwork: Awaited<ReturnType<RouterCloudRecoveryService["ensureVpnNetwork"]>> | null
  ): Promise<void> {
    const connections = await this.connections.listByRouter(localRouterId);
    if (connections.length === 0) {
      await this.connections.replaceForRouter(
        localRouterId,
        connectionInputsFromRecovery(remote, localRouterId)
      );
    }

    const localPlans = await this.plans.listByRouter(localRouterId);
    for (const plan of remote.plans) {
      const matchingLocal = localPlans.find((local) =>
        local.id === plan.id
        || (
          local.mikrotik_profile_name
          && local.mikrotik_profile_name === plan.mikrotik_profile_name
        )
      );
      let localPlanId = matchingLocal?.id ?? plan.id;
      if (!matchingLocal) {
        const occupiedPlan = await this.plans.findById(plan.id);
        localPlanId = occupiedPlan && occupiedPlan.router_id !== localRouterId
          ? `plan-${crypto.randomUUID()}`
          : plan.id;
        await this.plans.create(
          planInputFromRecovery(localRouterId, localPlanId, plan),
          {
            action: "restored",
            actorProfileId: this.internalProfileId,
            source: "vps-recovery"
          }
        );
      } else if ((plan.revision ?? 1) > matchingLocal.revision) {
        await this.plans.update({
          ...planInputFromRecovery(localRouterId, localPlanId, plan),
          sync_status: matchingLocal.sync_status
        }, {
          action: "restored",
          actorProfileId: this.internalProfileId,
          source: "vps-recovery-newer-revision"
        });
      }
      if (plan.history?.length) {
        await this.plans.importHistory(plan.history.map((entry) => ({
          ...entry,
          plan_id: localPlanId,
          router_id: localRouterId
        })));
      }
    }

    if (
      remote.vpn
      && vpnNetwork
      && !(await this.vpnPeers.findByRouter(this.accountId, localRouterId))
    ) {
      await this.vpnPeers.create({
        account_id: this.accountId,
        allowed_ips: remote.vpn.assigned_address,
        assigned_address: remote.vpn.assigned_address,
        endpoint_address: null,
        endpoint_port: null,
        id: `vpn-peer-recovered-${localRouterId}`,
        last_handshake_at: null,
        name: remote.name,
        network_id: vpnNetwork.id,
        peer_type: "router",
        resource_id: remote.id,
        private_key_encrypted: null,
        public_key: remote.vpn.public_key,
        router_id: localRouterId,
        // Un nouveau PC doit confirmer l'état réel de RouterOS avant
        // de considérer le tunnel récupéré comme actif.
        status: "draft"
      });
    }
  }

  private async ensureVpnNetwork() {
    const existing = await this.vpnNetworks.findByAccount(this.accountId);
    const remote = await this.cloud.bootstrapVpn();
    const input = {
      account_id: this.accountId,
      address_pool: remote.address_pool,
      id: existing?.id ?? `vpn-${crypto.randomUUID()}`,
      name: "Réseau WireGuard TicketPro",
      provisioning_api_token_encrypted: null,
      provisioning_api_url: "",
      server_endpoint: remote.server_endpoint,
      server_port: remote.server_port,
      server_public_key: remote.server_public_key,
      status: "active" as const
    };
    if (existing) {
      await this.vpnNetworks.update(input);
      return { ...existing, ...input };
    }
    try {
      return await this.vpnNetworks.create(input);
    } catch (error) {
      const concurrentlyCreated = await this.vpnNetworks.findByAccount(this.accountId);
      if (!concurrentlyCreated) throw error;
      const reconciled = { ...input, id: concurrentlyCreated.id };
      await this.vpnNetworks.update(reconciled);
      return { ...concurrentlyCreated, ...reconciled };
    }
  }
}

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const candidate = error as { error?: unknown; message?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error.trim();
    }
  }
  return "erreur locale inconnue";
}

function routerInputFromRecovery(
  remote: SaasRouterRecoverySnapshot,
  localRouterId: string,
  accountId: string,
  internalProfileId: string,
  encryptedPassword: string,
  organizationId: string | null
): CreateRouterInput {
  return {
    account_id: accountId,
    api_port: remote.api_port,
    api_ssl_port: remote.api_ssl_port,
    board_name: remote.board_name,
    cloud_router_id: remote.id,
    connection_mode: remote.connection_mode,
    created_by_profile_id: internalProfileId,
    encrypted_password: encryptedPassword,
    hotspot_address: remote.hotspot_address,
    id: localRouterId,
    label: remote.label,
    last_seen_at: remote.last_seen_at,
    local_ip: remote.local_ip,
    model: remote.model,
    name: remote.name,
    notes: remote.notes ?? "",
    organization_id: organizationId,
    routeros_version: remote.routeros_version,
    serial_number: remote.serial_number,
    status: "warning",
    subscription_counted: 1,
    sync_status: "synced",
    username: remote.username,
    zone_id: null
  };
}

function connectionInputsFromRecovery(
  remote: SaasRouterRecoverySnapshot,
  localRouterId: string
): CreateRouterConnectionInput[] {
  const seenModes = new Map<string, number>();
  return remote.connections.map((connection) => {
    const occurrence = seenModes.get(connection.mode) ?? 0;
    seenModes.set(connection.mode, occurrence + 1);
    return {
      host: connection.host,
      id: occurrence === 0
        ? `${localRouterId}:${connection.mode}`
        : `${localRouterId}:${connection.mode}:${occurrence + 1}`,
      last_connected_at: null,
      last_error: "État restauré du VPS, vérification réelle en attente.",
      mode: connection.mode,
      port: connection.port,
      router_id: localRouterId,
      status: "inactive",
      sync_status: "synced",
      use_ssl: connection.use_ssl ? 1 : 0
    };
  });
}

function planInputFromRecovery(
  routerId: string,
  localPlanId: string,
  plan: SaasRouterRecoverySnapshot["plans"][number]
): CreateHotspotPlanInput {
  return {
    created_at: plan.created_at,
    created_by_profile_id: plan.created_by_profile_id,
    currency: plan.currency,
    data_limit_mb: plan.data_limit_mb,
    download_limit: plan.download_limit,
    duration_minutes: plan.duration_minutes,
    id: localPlanId,
    last_synced_at: plan.last_synced_at,
    mikrotik_id: plan.mikrotik_id,
    mikrotik_profile_name: plan.mikrotik_profile_name,
    name: plan.name,
    price_hint: plan.price_hint,
    revision: plan.revision,
    router_id: routerId,
    shared_users: plan.shared_users,
    status: plan.status,
    sync_status: "synced",
    upload_limit: plan.upload_limit,
    updated_at: plan.updated_at,
    updated_by_profile_id: plan.updated_by_profile_id,
    validity_minutes: plan.validity_minutes
  };
}

