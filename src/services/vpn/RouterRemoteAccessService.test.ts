import { describe, expect, it, vi } from "vitest";
import type { RouterConnectionRecord, RouterRecord, VpnNetworkRecord, VpnPeerRecord } from "../../domain/database";
import {
  RouterRemoteAccessError,
  RouterRemoteAccessService,
  routerRemoteAccessState,
  type RouterRemoteAccessDependencies,
  type RouterRemoteAccessRouterService
} from "./RouterRemoteAccessService";

const router = {
  account_id: "acc", api_port: 8728, connection_mode: "local", encrypted_password: "enc", id: "r1",
  local_ip: "192.168.88.1", name: "Zone A", username: "ticketpro-api"
} as RouterRecord;
const network = {
  account_id: "acc", address_pool: "10.250.3.0/24", id: "net", name: "n", provisioning_api_token_encrypted: null,
  provisioning_api_url: "", server_endpoint: "vpn.ticketpro.test", server_port: 51820, server_public_key: "HUB=",
  status: "active"
} as VpnNetworkRecord;

function peer(overrides: Partial<VpnPeerRecord> = {}): VpnPeerRecord {
  return {
    account_id: "acc", allowed_ips: "10.250.3.9/32", assigned_address: "10.250.3.9/32", created_at: "", endpoint_address: null,
    endpoint_port: null, id: "peer-1", last_handshake_at: null, name: "Zone A", network_id: "net", peer_type: "router",
    private_key_encrypted: null, public_key: "ROUTER=", resource_id: "r1", router_id: "r1", status: "active", updated_at: "",
    ...overrides
  };
}

function setup(options: {
  existingPeers?: VpnPeerRecord[];
  installation?: boolean;
  localReachable?: boolean;
  provisionFails?: boolean;
  routerOs?: string;
  tunnel?: "CONNECTED" | "PENDING" | "SKIPPED";
  vpnReachable?: boolean | ((attempt: number) => boolean);
} = {}) {
  let connections: RouterConnectionRecord[] = [];
  const peers: VpnPeerRecord[] = [...(options.existingPeers ?? [])];
  let vpnAttempts = 0;
  const calls: string[] = [];
  const routerService = (host: string): RouterRemoteAccessRouterService => ({
    getSystemInfo: async () => ({ routerOsVersion: options.routerOs ?? "7.16.1" }) as never,
    getWireGuardInstallation: async () => options.installation
      ? { assignedAddress: "10.250.3.9/32", interfaceName: "ticketpro-vpn", publicKey: "ROUTER=", serverPublicKeys: ["HUB="] }
      : null,
    provisionWireGuard: async (config) => {
      calls.push(`provision:${config.assignedAddress}:${config.serverAllowedIps}:${config.privateKey ? "newkey" : "existing"}`);
      if (options.provisionFails) throw new Error("permission denied");
    },
    removeWireGuardPeer: async () => { calls.push(`remove:${host}`); },
    testConnection: async () => {
      if (host === router.local_ip) {
        if (options.localReachable === false) throw new Error("timeout");
        return;
      }
      vpnAttempts += 1;
      const reachable = typeof options.vpnReachable === "function" ? options.vpnReachable(vpnAttempts) : options.vpnReachable ?? true;
      if (!reachable) throw new Error("timeout");
    }
  });
  const deps: RouterRemoteAccessDependencies = {
    accountId: "acc",
    bootstrapVpn: async () => ({ address_pool: network.address_pool, server_endpoint: network.server_endpoint, server_port: 51820, server_public_key: "HUB=" }) as never,
    connections: {
      listByRouter: async () => connections,
      replaceForRouter: async (_id, next) => { connections = next.map((item) => ({ ...item, created_at: "", deleted_at: null, sync_status: "synced", updated_at: "" })) as RouterConnectionRecord[]; }
    },
    createRouterService: (_router, host) => routerService(host),
    decryptPassword: async () => "secret",
    ensurePcTunnel: async () => options.tunnel ?? "CONNECTED",
    generateKeyPair: () => ({ privateKey: "PRIV=", publicKey: "NEWKEY=" }),
    networks: { create: async () => network, findByAccount: async () => network, update: async () => undefined },
    peers: {
      create: async (input) => { const record = { ...input, created_at: "", updated_at: "" }; peers.push(record); return record; },
      listByAccount: async () => peers,
      updateStatus: async (_account, id, status) => { peers.filter((item) => item.id === id).forEach((item) => { item.status = status; }); }
    },
    protectPrivateKey: async (key) => `protected:${key}`,
    revokePeer: vi.fn(async () => undefined),
    routers: { setPreferredConnectionMode: vi.fn(async () => undefined) },
    upsertPeer: vi.fn(async (input) => ({ address_pool: network.address_pool, assigned_address: "10.250.3.12/32", public_key: input.publicKey, status: "active" as const })),
    wait: async () => undefined
  };
  return { calls, connections: () => connections, deps, peers, service: new RouterRemoteAccessService(deps) };
}

describe("RouterRemoteAccessService", () => {
  it("reconnaît un routeur déjà en service sans rien réécrire dessus", async () => {
    const { calls, deps, service } = setup({ existingPeers: [peer()], localReachable: false });
    await expect(service.enable(router)).resolves.toEqual({ state: "on", vpnHost: "10.250.3.9" });
    expect(calls).toEqual([]);
    expect(deps.upsertPeer).not.toHaveBeenCalled();
  });

  it("active en un clic : configure le routeur en local puis vérifie à travers le VPN", async () => {
    const steps: string[] = [];
    const { calls, connections, peers, service } = setup({ vpnReachable: (attempt) => attempt >= 3 });
    await expect(service.enable(router, (step) => steps.push(step))).resolves.toEqual({ state: "on", vpnHost: "10.250.3.12" });
    expect(steps).toEqual(["network", "pc-tunnel", "local-router", "router-version", "router-config", "verification"]);
    expect(calls).toEqual(["provision:10.250.3.12/32:10.250.0.0/16:newkey"]);
    expect(peers[0]).toMatchObject({ private_key_encrypted: "protected:PRIV=", status: "active" });
    expect(connections()).toEqual([expect.objectContaining({ host: "10.250.3.12", mode: "vpn", status: "active" })]);
  });

  it("réutilise l'interface WireGuard déjà présente sur le routeur, sans nouvelle clé", async () => {
    const { calls, service } = setup({ installation: true });
    await service.enable(router);
    expect(calls).toEqual(["provision:10.250.3.12/32:10.250.0.0/16:existing"]);
  });

  it("exige le réseau local pour la première activation", async () => {
    const { service } = setup({ localReachable: false });
    await expect(service.enable(router)).rejects.toMatchObject({ step: "local-router" });
  });

  it("refuse RouterOS 6 avec un message clair", async () => {
    const { calls, service } = setup({ routerOs: "6.49.10" });
    await expect(service.enable(router)).rejects.toMatchObject({ step: "router-version" });
    expect(calls).toEqual([]);
  });

  it("n'annonce pas l'accès activé si le routeur ne répond pas à travers le tunnel", async () => {
    const { connections, peers, service } = setup({ vpnReachable: false });
    const error = await service.enable(router).catch((caught) => caught);
    expect(error).toBeInstanceOf(RouterRemoteAccessError);
    expect(error.step).toBe("verification");
    expect(peers[0].status).toBe("draft");
    expect(connections()[0]).toMatchObject({ status: "inactive" });
  });

  it("révoque la clé créée si la configuration du routeur échoue", async () => {
    const { deps, peers, service } = setup({ provisionFails: true });
    await expect(service.enable(router)).rejects.toMatchObject({ step: "router-config" });
    expect(deps.revokePeer).toHaveBeenCalledWith({ peerType: "router", publicKey: "NEWKEY=", resourceId: "r1" });
    expect(peers[0].status).toBe("revoked");
  });

  it("refuse si le tunnel du PC n'est pas établi", async () => {
    const { service } = setup({ tunnel: "PENDING" });
    await expect(service.enable(router)).rejects.toMatchObject({ step: "pc-tunnel" });
  });

  it("désactive : retire le tunnel du routeur, révoque la clé et repasse en local", async () => {
    const { calls, connections, deps, peers, service } = setup({ existingPeers: [peer()] });
    await service.enable(router);
    await service.disable({ ...router, connection_mode: "vpn" });
    expect(calls).toContain("remove:192.168.88.1");
    expect(deps.revokePeer).toHaveBeenCalledWith({ peerType: "router", publicKey: "ROUTER=", resourceId: "r1" });
    expect(peers[0].status).toBe("revoked");
    expect(connections()).toEqual([]);
    expect(deps.routers.setPreferredConnectionMode).toHaveBeenCalledWith("acc", "r1", "local");
  });

  it("décrit l'état à partir des pairs et connexions locales", () => {
    expect(routerRemoteAccessState("r1", [], [])).toEqual({ state: "off", vpnHost: null });
    expect(routerRemoteAccessState("r1", [peer({ status: "draft" })], [])).toEqual({ state: "pending", vpnHost: "10.250.3.9" });
    expect(routerRemoteAccessState("r1", [peer()], [{ host: "10.250.3.9", mode: "vpn" } as RouterConnectionRecord]))
      .toEqual({ state: "on", vpnHost: "10.250.3.9" });
  });
});
