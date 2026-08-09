import type { VpnNetworkRecord } from "../../domain/database";
import { VpnPeerRepository, type DatabaseClient } from "../database";
import {
  listSaasVpnOperatorPeers,
  type SaasVpnPeer
} from "../saas";
import {
  listInstalledTicketProTunnels,
  stopWireGuardTunnel,
  type InstalledWireGuardTunnel
} from "../vpn";

export type WireGuardOperatorRecoveryResult = {
  adopted: number;
  removedRevoked: number;
  unresolved: number;
};

type WireGuardOperatorRecoveryDependencies = {
  listInstalled?: () => Promise<InstalledWireGuardTunnel[]>;
  listRemote?: () => Promise<SaasVpnPeer[]>;
  removeInstalled?: (tunnelName: string) => Promise<void>;
};

export class WireGuardOperatorRecoveryService {
  private readonly peers: VpnPeerRepository;
  private readonly listInstalled: () => Promise<InstalledWireGuardTunnel[]>;
  private readonly listRemote: () => Promise<SaasVpnPeer[]>;
  private readonly removeInstalled: (tunnelName: string) => Promise<void>;

  constructor(
    database: DatabaseClient,
    private readonly accountId: string,
    dependencies: WireGuardOperatorRecoveryDependencies = {}
  ) {
    this.peers = new VpnPeerRepository(database);
    this.listInstalled = dependencies.listInstalled ?? listInstalledTicketProTunnels;
    this.listRemote = dependencies.listRemote ?? listSaasVpnOperatorPeers;
    this.removeInstalled = dependencies.removeInstalled ?? stopWireGuardTunnel;
  }

  async recover(network: VpnNetworkRecord): Promise<WireGuardOperatorRecoveryResult> {
    if (network.account_id !== this.accountId) {
      throw new Error("Le réseau VPN ne correspond pas au compte connecté.");
    }

    const [installedTunnels, remotePeers] = await Promise.all([
      this.listInstalled(),
      this.listRemote()
    ]);
    const remoteByPublicKey = new Map(
      remotePeers.map((peer) => [peer.public_key, peer])
    );
    const result: WireGuardOperatorRecoveryResult = {
      adopted: 0,
      removedRevoked: 0,
      unresolved: 0
    };

    for (const tunnel of installedTunnels) {
      const remote = (
        tunnel.publicKey
          ? remoteByPublicKey.get(tunnel.publicKey)
          : undefined
      ) ?? remotePeers.find((peer) =>
        tunnel.assignedAddress
        && peer.assigned_address
        && stripCidr(peer.assigned_address) === stripCidr(tunnel.assignedAddress)
      );
      if (!remote) {
        // Ce tunnel peut appartenir à un autre compte utilisé sur le même PC.
        result.unresolved += 1;
        continue;
      }
      if (remote.status === "revoked") {
        await this.removeInstalled(tunnel.tunnelName);
        result.removedRevoked += 1;
        continue;
      }
      if (!remote.assigned_address) {
        result.unresolved += 1;
        continue;
      }

      await this.peers.create({
        account_id: this.accountId,
        allowed_ips: remote.assigned_address,
        assigned_address: remote.assigned_address,
        endpoint_address: network.server_endpoint,
        endpoint_port: network.server_port,
        id: tunnel.tunnelName,
        last_handshake_at: null,
        name: remote.name || "Poste opérateur récupéré",
        network_id: network.id,
        peer_type: "operator",
        resource_id: remote.resource_id,
        // Le service Windows conserve déjà la clé privée. TicketPro n'a pas
        // besoin de l'extraire ou de l'envoyer au VPS pour adopter le tunnel.
        private_key_encrypted: null,
        public_key: remote.public_key,
        router_id: null,
        status: tunnel.active ? "active" : "draft"
      });
      result.adopted += 1;
    }

    return result;
  }
}

function stripCidr(address: string): string {
  return address.split("/")[0].trim();
}
