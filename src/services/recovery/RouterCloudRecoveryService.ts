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
  saveSnapshot: typeof saveSaasRouterRecoverySnapshot;
};

const defaultCloudClient: RouterRecoveryCloudClient = {
  bootstrapVpn: bootstrapSaasVpn,
  getSnapshots: getSaasRouterRecoverySnapshots,
  saveSnapshot: saveSaasRouterRecoverySnapshot
};

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
    private readonly cloud: RouterRecoveryCloudClient = defaultCloudClient
  ) {
    this.connections = new RouterConnectionRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.routers = new RouterRepository(database);
    this.vpnNetworks = new VpnNetworkRepository(database);
    this.vpnPeers = new VpnPeerRepository(database);
  }

  async backupRouter(routerId: string): Promise<SaasRouterRecoverySnapshot> {
    const router = await this.routers.findById(routerId);
    if (!router || router.account_id !== this.accountId || router.deleted_at) {
      throw new Error("Routeur local introuvable pour la sauvegarde cloud.");
    }
    const [connections, plans, vpnPeer] = await Promise.all([
      this.connections.listByRouter(router.id),
      this.plans.listByRouter(router.id),
      this.vpnPeers.findByRouter(this.accountId, router.id)
    ]);
    const credential = await decryptLocalSecret(router.encrypted_password);
    return this.cloud.saveSnapshot({
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
      id: router.id,
      label: router.label,
      last_seen_at: router.last_seen_at,
      local_ip: router.local_ip,
      model: router.model,
      name: router.name,
      notes: router.notes,
      plans: plans.map((plan) => ({
        data_limit_mb: plan.data_limit_mb,
        download_limit: plan.download_limit,
        duration_minutes: plan.duration_minutes,
        id: plan.id,
        mikrotik_profile_name: plan.mikrotik_profile_name,
        name: plan.name,
        price_hint: plan.price_hint,
        shared_users: plan.shared_users,
        status: plan.status,
        upload_limit: plan.upload_limit,
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
  }

  async backupAll(): Promise<void> {
    const routers = await this.routers.listByAccount(this.accountId);
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

  async restoreMissingRouters(): Promise<RouterRecoveryResult> {
    const remoteRouters = await this.cloud.getSnapshots();
    const localRouters = await this.routers.listByAccount(this.accountId);
    const localStableIdentities = new Set<string>();
    const localByStableIdentity = new Map<string, (typeof localRouters)[number]>();
    for (const router of localRouters) {
      const stableIdentity = routerAccessPolicyCloudId(
        router,
        await this.connections.listByRouter(router.id)
      );
      localStableIdentities.add(stableIdentity);
      localByStableIdentity.set(stableIdentity, router);
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
        if (
          localRouters.some((router) => router.id === remote.id)
          || localStableIdentities.has(remote.stable_identity)
        ) {
          const existing = localRouters.find((router) =>
            router.id === remote.id
          ) ?? localByStableIdentity.get(remote.stable_identity);
          if (existing?.id === remote.id) {
            await this.restoreMissingDependents(remote, vpnNetwork);
          }
          result.skippedRouterIds.push(remote.id);
          continue;
        }

        const encryptedPassword = await encryptLocalSecret(remote.credential);
        await this.routers.create(routerInputFromRecovery(
          remote,
          this.accountId,
          this.internalProfileId,
          encryptedPassword
        ));
        await this.restoreMissingDependents(remote, vpnNetwork);
        localStableIdentities.add(remote.stable_identity);
        result.restoredRouterIds.push(remote.id);
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
    vpnNetwork: Awaited<ReturnType<RouterCloudRecoveryService["ensureVpnNetwork"]>> | null
  ): Promise<void> {
    const connections = await this.connections.listByRouter(remote.id);
    if (connections.length === 0) {
      await this.connections.replaceForRouter(
        remote.id,
        connectionInputsFromRecovery(remote)
      );
    }

    const localPlans = await this.plans.listByRouter(remote.id);
    for (const plan of remote.plans) {
      if (!localPlans.some((local) =>
        local.id === plan.id
        || (
          local.mikrotik_profile_name
          && local.mikrotik_profile_name === plan.mikrotik_profile_name
        )
      )) {
        await this.plans.create(planInputFromRecovery(remote.id, plan));
      }
    }

    if (
      remote.vpn
      && vpnNetwork
      && !(await this.vpnPeers.findByRouter(this.accountId, remote.id))
    ) {
      await this.vpnPeers.create({
        account_id: this.accountId,
        allowed_ips: remote.vpn.assigned_address,
        assigned_address: remote.vpn.assigned_address,
        endpoint_address: null,
        endpoint_port: null,
        id: `vpn-peer-recovered-${remote.id}`,
        last_handshake_at: null,
        name: remote.name,
        network_id: vpnNetwork.id,
        peer_type: "router",
        resource_id: remote.id,
        private_key_encrypted: null,
        public_key: remote.vpn.public_key,
        router_id: remote.id,
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
    return this.vpnNetworks.create(input);
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
  accountId: string,
  internalProfileId: string,
  encryptedPassword: string
): CreateRouterInput {
  return {
    account_id: accountId,
    api_port: remote.api_port,
    api_ssl_port: remote.api_ssl_port,
    board_name: remote.board_name,
    connection_mode: remote.connection_mode,
    created_by_profile_id: internalProfileId,
    encrypted_password: encryptedPassword,
    hotspot_address: remote.hotspot_address,
    id: remote.id,
    label: remote.label,
    last_seen_at: remote.last_seen_at,
    local_ip: remote.local_ip,
    model: remote.model,
    name: remote.name,
    notes: remote.notes ?? "",
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
  remote: SaasRouterRecoverySnapshot
): CreateRouterConnectionInput[] {
  const seenModes = new Map<string, number>();
  return remote.connections.map((connection) => {
    const occurrence = seenModes.get(connection.mode) ?? 0;
    seenModes.set(connection.mode, occurrence + 1);
    return {
      host: connection.host,
      id: occurrence === 0
        ? `${remote.id}:${connection.mode}`
        : `${remote.id}:${connection.mode}:${occurrence + 1}`,
      last_connected_at: null,
      last_error: "État restauré du VPS, vérification réelle en attente.",
      mode: connection.mode,
      port: connection.port,
      router_id: remote.id,
      status: "inactive",
      sync_status: "synced",
      use_ssl: connection.use_ssl ? 1 : 0
    };
  });
}

function planInputFromRecovery(
  routerId: string,
  plan: SaasRouterRecoverySnapshot["plans"][number]
): CreateHotspotPlanInput {
  return {
    data_limit_mb: plan.data_limit_mb,
    download_limit: plan.download_limit,
    duration_minutes: plan.duration_minutes,
    id: plan.id,
    mikrotik_profile_name: plan.mikrotik_profile_name,
    name: plan.name,
    price_hint: plan.price_hint,
    router_id: routerId,
    shared_users: plan.shared_users,
    status: plan.status,
    sync_status: "synced",
    upload_limit: plan.upload_limit,
    validity_minutes: plan.validity_minutes
  };
}
