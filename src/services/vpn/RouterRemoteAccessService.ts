import type {
  RouterConnectionRecord,
  RouterRecord,
  VpnNetworkRecord,
  VpnPeerRecord
} from "../../domain/database";
import type {
  RouterSystemInfo,
  RouterWireGuardConfig,
  RouterWireGuardInstallation,
  RouterWireGuardPeerReference
} from "../../domain/router";
import type { LicenseVpnBootstrap, LicenseVpnPeerResult } from "../licensing";


export const remoteAccessInterfaceName = "ticketpro-vpn";
const routerApiPortOverVpn = 8728;

/**
 * State of the remote access of one router, as TicketPro knows it locally.
 * - on: a router peer is active and a VPN connection is recorded;
 * - pending: the router was configured but never answered through the tunnel;
 * - off: no remote access.
 */
export type RouterRemoteAccessState = {
  state: "off" | "pending" | "on";
  vpnHost: string | null;
};

export type RouterRemoteAccessStep =
  | "network"
  | "pc-tunnel"
  | "local-router"
  | "router-version"
  | "router-config"
  | "verification";

export type RouterRemoteAccessRouterService = {
  getSystemInfo(): Promise<RouterSystemInfo>;
  getWireGuardInstallation(interfaceName: string): Promise<RouterWireGuardInstallation | null>;
  provisionWireGuard(config: RouterWireGuardConfig): Promise<void>;
  removeWireGuardPeer(reference: RouterWireGuardPeerReference): Promise<unknown>;
  testConnection(): Promise<unknown>;
};

export type RouterRemoteAccessDependencies = {
  accountId: string;
  bootstrapVpn: () => Promise<LicenseVpnBootstrap>;
  connections: {
    listByRouter(routerId: string): Promise<RouterConnectionRecord[]>;
    replaceForRouter(routerId: string, connections: RouterConnectionInput[]): Promise<unknown>;
  };
  createRouterService(router: RouterRecord, host: string, port: number, password: string): RouterRemoteAccessRouterService;
  decryptPassword(encrypted: string): Promise<string>;
  /** Makes sure this PC's tunnel is up. "SKIPPED" means the historical WireGuard client is in use. */
  ensurePcTunnel(): Promise<"CONNECTED" | "DEGRADED" | "PENDING" | "SKIPPED">;
  generateKeyPair(): { privateKey: string; publicKey: string };
  networks: {
    create(input: VpnNetworkInput): Promise<VpnNetworkRecord>;
    findByAccount(accountId: string): Promise<VpnNetworkRecord | null>;
    update(input: VpnNetworkInput): Promise<void>;
  };
  peers: {
    create(input: VpnPeerInput): Promise<VpnPeerRecord>;
    listByAccount(accountId: string): Promise<VpnPeerRecord[]>;
    updateStatus(accountId: string, id: string, status: VpnPeerRecord["status"]): Promise<void>;
  };
  protectPrivateKey(privateKey: string): Promise<string>;
  revokePeer(input: { peerType: "router"; publicKey: string; resourceId: string }): Promise<unknown>;
  routers: {
    setPreferredConnectionMode(accountId: string, routerId: string, mode: "local"): Promise<unknown>;
  };
  upsertPeer(input: { name: string; peerType: "router"; publicKey: string; resourceId: string }): Promise<LicenseVpnPeerResult>;
  /** Optional work after a successful activation (state reconciliation, cloud backup). */
  afterEnabled?(router: RouterRecord, service: RouterRemoteAccessRouterService): Promise<void>;
  wait(milliseconds: number): Promise<void>;
};

type RouterConnectionInput = Omit<RouterConnectionRecord, "created_at" | "updated_at" | "deleted_at" | "sync_status"> &
  Partial<Pick<RouterConnectionRecord, "created_at" | "updated_at" | "deleted_at" | "sync_status">>;
type VpnNetworkInput = Omit<VpnNetworkRecord, "created_at" | "updated_at">;
type VpnPeerInput = Omit<VpnPeerRecord, "created_at" | "updated_at">;

export class RouterRemoteAccessError extends Error {
  constructor(readonly step: RouterRemoteAccessStep, message: string) {
    super(message);
    this.name = "RouterRemoteAccessError";
  }
}

export function routerRemoteAccessState(
  routerId: string,
  peers: VpnPeerRecord[],
  connections: RouterConnectionRecord[]
): RouterRemoteAccessState {
  const peer = peers.find((item) => item.peer_type === "router" && item.router_id === routerId && item.status !== "revoked");
  const vpnConnection = connections.find((connection) => connection.mode === "vpn" && !connection.deleted_at);
  if (!peer) return { state: "off", vpnHost: null };
  const vpnHost = vpnConnection?.host || peer.assigned_address.split("/")[0];
  return { state: peer.status === "active" && vpnConnection ? "on" : "pending", vpnHost };
}

/**
 * One switch for the remote access of a router, as in Winbox-like tools:
 * the first activation needs the router's local network, then TicketPro
 * reaches it from anywhere through the organization's WireGuard tunnel.
 * Nothing is reported as enabled before RouterOS answered through the tunnel.
 */
export class RouterRemoteAccessService {
  constructor(private readonly deps: RouterRemoteAccessDependencies) {}

  async state(router: RouterRecord): Promise<RouterRemoteAccessState> {
    const [peers, connections] = await Promise.all([
      this.deps.peers.listByAccount(this.deps.accountId),
      this.deps.connections.listByRouter(router.id)
    ]);
    return routerRemoteAccessState(router.id, peers, connections);
  }

  async enable(
    router: RouterRecord,
    onStep: (step: RouterRemoteAccessStep) => void = () => undefined
  ): Promise<RouterRemoteAccessState> {
    onStep("network");
    const network = await this.ensureNetwork();

    onStep("pc-tunnel");
    const tunnel = await this.deps.ensurePcTunnel();
    if (tunnel === "SKIPPED") {
      throw new RouterRemoteAccessError(
        "pc-tunnel",
        "Ce poste utilise encore l'ancien client WireGuard : activez l'accès distant depuis la page VPN."
      );
    }
    if (tunnel === "PENDING") {
      throw new RouterRemoteAccessError(
        "pc-tunnel",
        "La connexion sécurisée de ce PC n'est pas établie. Vérifiez Internet puis réessayez."
      );
    }

    const password = await this.deps.decryptPassword(router.encrypted_password);
    const peers = await this.deps.peers.listByAccount(this.deps.accountId);
    const existingPeer = peers.find((peer) =>
      peer.peer_type === "router" && peer.router_id === router.id && peer.status !== "revoked"
    ) ?? null;

    // A router already configured (in use in production) is only verified
    // through the tunnel: nothing is rewritten on it.
    if (existingPeer) {
      const vpnHost = existingPeer.assigned_address.split("/")[0];
      if (await this.answersOverVpn(router, vpnHost, password, 3)) {
        await this.markEnabled(router, existingPeer, vpnHost, password);
        return { state: "on", vpnHost };
      }
    }

    onStep("local-router");
    const local = this.deps.createRouterService(router, router.local_ip, router.api_port, password);
    try {
      await local.testConnection();
    } catch {
      throw new RouterAdapterUnreachable();
    }

    onStep("router-version");
    const info = await local.getSystemInfo();
    const major = Number.parseInt(info.routerOsVersion ?? "", 10);
    if (Number.isFinite(major) && major < 7) {
      throw new RouterRemoteAccessError(
        "router-version",
        `RouterOS ${info.routerOsVersion} ne prend pas en charge WireGuard. Mettez le routeur à jour en RouterOS 7 pour activer l'accès à distance.`
      );
    }

    onStep("router-config");
    const installation = await local.getWireGuardInstallation(remoteAccessInterfaceName);
    const keyPair = installation ? null : this.deps.generateKeyPair();
    const publicKey = installation?.publicKey ?? keyPair?.publicKey;
    if (!publicKey) {
      throw new RouterRemoteAccessError("router-config", "La clé publique WireGuard du routeur est introuvable.");
    }
    const remotePeer = await this.deps.upsertPeer({
      name: router.name,
      peerType: "router",
      publicKey,
      resourceId: router.id
    });
    if (!remotePeer.assigned_address) {
      throw new RouterRemoteAccessError("router-config", "Le serveur VPN n'a pas attribué d'adresse au routeur.");
    }
    let peer: VpnPeerRecord | null = null;
    try {
      peer = await this.deps.peers.create({
        account_id: this.deps.accountId,
        allowed_ips: remotePeer.assigned_address,
        assigned_address: remotePeer.assigned_address,
        endpoint_address: null,
        endpoint_port: null,
        id: existingPeer?.public_key === publicKey ? existingPeer.id : `vpn-peer-${crypto.randomUUID()}`,
        last_handshake_at: null,
        name: router.name,
        network_id: network.id,
        peer_type: "router",
        private_key_encrypted: keyPair ? await this.deps.protectPrivateKey(keyPair.privateKey) : existingPeer?.private_key_encrypted ?? null,
        public_key: publicKey,
        resource_id: router.id,
        router_id: router.id,
        status: "draft"
      });
      if (existingPeer && existingPeer.id !== peer.id) {
        await this.deps.peers.updateStatus(this.deps.accountId, existingPeer.id, "revoked");
      }
      await local.provisionWireGuard({
        assignedAddress: peer.assigned_address,
        interfaceName: remoteAccessInterfaceName,
        privateKey: keyPair?.privateKey,
        serverAllowedIps: routerAllowedIpsForNetwork(network.address_pool),
        serverEndpoint: network.server_endpoint,
        serverPort: network.server_port,
        serverPublicKey: network.server_public_key
      });
    } catch (error) {
      // A key created by this attempt is never left half configured.
      if (keyPair) {
        await this.deps.revokePeer({ peerType: "router", publicKey, resourceId: router.id }).catch(() => undefined);
        if (peer) await this.deps.peers.updateStatus(this.deps.accountId, peer.id, "revoked").catch(() => undefined);
      }
      throw error instanceof RouterRemoteAccessError
        ? error
        : new RouterRemoteAccessError("router-config", `Configuration WireGuard du routeur impossible : ${messageOf(error)}`);
    }

    onStep("verification");
    const vpnHost = peer.assigned_address.split("/")[0];
    await this.persistVpnConnection(router, vpnHost, false, "Vérification de l'accès distant en cours.");
    if (!(await this.answersOverVpn(router, vpnHost, password, 10))) {
      await this.persistVpnConnection(router, vpnHost, false, "Le routeur ne répond pas encore à travers le tunnel.");
      throw new RouterRemoteAccessError(
        "verification",
        `Le routeur est configuré mais ne répond pas à travers le VPN (${vpnHost}). Vérifiez qu'il a accès à Internet (UDP ${network.server_port} sortant), puis réessayez.`
      );
    }
    await this.markEnabled(router, peer, vpnHost, password);
    return { state: "on", vpnHost };
  }

  async disable(router: RouterRecord): Promise<void> {
    const peers = await this.deps.peers.listByAccount(this.deps.accountId);
    const routerPeers = peers.filter((peer) =>
      peer.peer_type === "router" && peer.router_id === router.id && peer.status !== "revoked"
    );
    const network = await this.deps.networks.findByAccount(this.deps.accountId);
    const password = await this.deps.decryptPassword(router.encrypted_password);
    // Remove the tunnel on the router while it is still reachable, locally
    // first, otherwise through the tunnel itself; then revoke the key.
    for (const peer of routerPeers) {
      const hosts = [
        { host: router.local_ip, port: router.api_port },
        { host: peer.assigned_address.split("/")[0], port: routerApiPortOverVpn }
      ];
      for (const target of hosts) {
        try {
          await this.deps.createRouterService(router, target.host, target.port, password).removeWireGuardPeer({
            interfaceName: remoteAccessInterfaceName,
            serverPublicKey: network?.server_public_key ?? ""
          });
          break;
        } catch {
          // Next path; the revoked key is unusable anyway.
        }
      }
      await this.deps.revokePeer({ peerType: "router", publicKey: peer.public_key, resourceId: router.id });
      await this.deps.peers.updateStatus(this.deps.accountId, peer.id, "revoked");
    }
    const connections = await this.deps.connections.listByRouter(router.id);
    await this.deps.connections.replaceForRouter(
      router.id,
      connections.filter((connection) => connection.mode !== "vpn").map(connectionInput)
    );
    if (router.connection_mode === "vpn") {
      await this.deps.routers.setPreferredConnectionMode(this.deps.accountId, router.id, "local");
    }
  }

  private async ensureNetwork(): Promise<VpnNetworkRecord> {
    const existing = await this.deps.networks.findByAccount(this.deps.accountId);
    let remote: LicenseVpnBootstrap;
    try {
      remote = await this.deps.bootstrapVpn();
    } catch (error) {
      if (existing) return existing;
      throw new RouterRemoteAccessError("network", `Configuration du serveur VPN indisponible : ${messageOf(error)}`);
    }
    const input: VpnNetworkInput = {
      account_id: this.deps.accountId,
      address_pool: remote.address_pool,
      id: existing?.id ?? `vpn-${crypto.randomUUID()}`,
      name: "Réseau WireGuard TicketPro",
      provisioning_api_token_encrypted: null,
      provisioning_api_url: "",
      server_endpoint: remote.server_endpoint,
      server_port: remote.server_port,
      server_public_key: remote.server_public_key,
      status: "active"
    };
    if (existing) {
      await this.deps.networks.update(input);
      return { ...existing, ...input };
    }
    return this.deps.networks.create(input);
  }

  private async answersOverVpn(router: RouterRecord, host: string, password: string, attempts: number): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.deps.createRouterService(router, host, routerApiPortOverVpn, password).testConnection();
        return true;
      } catch {
        if (attempt + 1 < attempts) await this.deps.wait(1500);
      }
    }
    return false;
  }

  private async markEnabled(router: RouterRecord, peer: VpnPeerRecord, vpnHost: string, password: string) {
    await this.persistVpnConnection(router, vpnHost, true, null);
    if (peer.status !== "active") await this.deps.peers.updateStatus(this.deps.accountId, peer.id, "active");
    if (this.deps.afterEnabled) {
      await this.deps.afterEnabled(
        router,
        this.deps.createRouterService(router, vpnHost, routerApiPortOverVpn, password)
      ).catch(() => undefined);
    }
  }

  private async persistVpnConnection(router: RouterRecord, host: string, active: boolean, errorMessage: string | null) {
    const connections = await this.deps.connections.listByRouter(router.id);
    await this.deps.connections.replaceForRouter(router.id, [
      ...connections.filter((connection) => connection.mode !== "vpn").map(connectionInput),
      {
        host,
        id: `${router.id}:vpn`,
        last_connected_at: active ? new Date().toISOString() : null,
        last_error: errorMessage,
        mode: "vpn",
        port: routerApiPortOverVpn,
        router_id: router.id,
        status: active ? "active" : "inactive",
        use_ssl: 0
      }
    ]);
  }
}

class RouterAdapterUnreachable extends RouterRemoteAccessError {
  constructor() {
    super(
      "local-router",
      "Le routeur n'est pas joignable sur le réseau local. Pour la première activation, connectez ce PC au réseau du routeur."
    );
  }
}

// The hub filters traffic between organizations; the router must accept the
// whole hub supernet so that PCs of other member organizations can reach it.
export function routerAllowedIpsForNetwork(addressPool: string): string {
  return /^10\.250\.\d{1,3}\.\d{1,3}\/(?:2[4-9]|3[0-2])$/.test(addressPool)
    ? "10.250.0.0/16"
    : addressPool;
}

function connectionInput(connection: RouterConnectionRecord): RouterConnectionInput {
  return {
    host: connection.host,
    id: connection.id,
    last_connected_at: connection.last_connected_at,
    last_error: connection.last_error,
    mode: connection.mode,
    port: connection.port,
    router_id: connection.router_id,
    status: connection.status,
    use_ssl: connection.use_ssl
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
