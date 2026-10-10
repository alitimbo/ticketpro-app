import type { AuthSession } from "../../domain/auth";
import type { RouterRecord } from "../../domain/database";
import type { DatabaseClient } from "../../services/database";
import {
  RouterConnectionRepository,
  RouterRepository,
  VpnNetworkRepository,
  VpnPeerRepository
} from "../../services/database";
import { RouterCloudRecoveryService, RouterStateReconciliationService } from "../../services/recovery";
import { RouterService } from "../../services/router";
import { bootstrapSaasVpn, revokeSaasVpnPeer, upsertSaasVpnPeer } from "../../services/saas";
import { decryptLocalSecret } from "../../services/security/localSecrets";
import {
  EmbeddedVpnProvisioningService,
  generateWireGuardKeyPair,
  protectWireGuardPrivateKey,
  RouterRemoteAccessService,
  type RouterRemoteAccessStep
} from "../../services/vpn";

export const remoteAccessStepLabels: Record<RouterRemoteAccessStep, string> = {
  "local-router": "Connexion locale au routeur…",
  network: "Préparation du réseau VPN de l'organisation…",
  "pc-tunnel": "Connexion sécurisée de ce PC…",
  "router-config": "Configuration WireGuard du routeur…",
  "router-version": "Vérification de la version RouterOS…",
  verification: "Vérification à travers le VPN…"
};

export function createRouterRemoteAccessService(input: {
  accountId: string;
  database: DatabaseClient;
  organizationId: string | null;
  session: AuthSession;
}): RouterRemoteAccessService {
  const reconciliation = new RouterStateReconciliationService(input.database, input.session, {
    organizationId: input.organizationId
  });
  const recovery = new RouterCloudRecoveryService(
    input.database,
    input.accountId,
    input.session.internal_profile_id,
    undefined,
    input.organizationId
  );
  const createRouterService = (router: RouterRecord, host: string, port: number, password: string) => new RouterService({
    authSession: input.session,
    mikrotik: {
      connectionMode: host === router.local_ip ? "local" : "vpn",
      host,
      password,
      port,
      retries: 0,
      timeoutMs: 5000,
      useSsl: false,
      username: router.username
    },
    mode: "mikrotik"
  });
  return new RouterRemoteAccessService({
    accountId: input.accountId,
    afterEnabled: async (router, service) => {
      await reconciliation.reconcile(router, service as RouterService).catch(() => undefined);
      await recovery.backupRouter(router.id).catch(() => undefined);
    },
    bootstrapVpn: bootstrapSaasVpn,
    connections: new RouterConnectionRepository(input.database),
    createRouterService,
    decryptPassword: decryptLocalSecret,
    ensurePcTunnel: async () => (await new EmbeddedVpnProvisioningService().ensureConnected()).state,
    generateKeyPair: generateWireGuardKeyPair,
    networks: new VpnNetworkRepository(input.database),
    peers: new VpnPeerRepository(input.database),
    protectPrivateKey: protectWireGuardPrivateKey,
    revokePeer: revokeSaasVpnPeer,
    routers: new RouterRepository(input.database),
    upsertPeer: upsertSaasVpnPeer,
    wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  });
}
