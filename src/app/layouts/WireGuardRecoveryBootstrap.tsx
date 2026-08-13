import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  useAppDatabase,
  VpnNetworkRepository
} from "../../services/database";
import { WireGuardOperatorRecoveryService } from "../../services/recovery";
import { bootstrapSaasVpn } from "../../services/saas";
import { EmbeddedVpnProvisioningService } from "../../services/vpn";

export function WireGuardRecoveryBootstrap() {
  const { accountSession, saasAccount, session } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  // Le tunnel est une condition technique pour joindre les routeurs autorises.
  // Il ne donne pas le droit d'administrer les pairs VPN.
  const canUseSecureConnection = Boolean(
    session?.permissions.includes("global.routers.select")
  );

  useEffect(() => {
    if (!accountId || !session || !isInitialized || !canUseSecureConnection) return;
    const scopedAccountId = accountId;
    const provisioning = new EmbeddedVpnProvisioningService();
    let heartbeatTimer: number | null = null;
    let disposed = false;
    void recoverExistingTunnel()
      .then((embedded) => {
        if (!embedded || disposed) return;
        heartbeatTimer = window.setInterval(() => {
          void provisioning.heartbeatCurrent().catch(() => undefined);
        }, 120_000);
      })
      .catch(() => {
        // Une panne réseau ou un refus temporaire sera retenté après une
        // reconnexion ou au chargement explicite de la page VPN.
      });

    async function recoverExistingTunnel(): Promise<boolean> {
      const embedded = await provisioning.ensureConnected();
      if (embedded.state !== "SKIPPED") return true;

      const networks = new VpnNetworkRepository(database);
      let network = await networks.findByAccount(scopedAccountId);
      const remote = await bootstrapSaasVpn();
      const input = {
        account_id: scopedAccountId,
        address_pool: remote.address_pool,
        id: network?.id ?? `vpn-${crypto.randomUUID()}`,
        name: "Réseau WireGuard TicketPro",
        provisioning_api_token_encrypted: null,
        provisioning_api_url: "",
        server_endpoint: remote.server_endpoint,
        server_port: remote.server_port,
        server_public_key: remote.server_public_key,
        status: "active" as const
      };
      if (network) {
        await networks.update(input);
        network = {
          ...network,
          ...input,
          updated_at: new Date().toISOString()
        };
      } else {
        network = await networks.create(input);
      }
      await new WireGuardOperatorRecoveryService(database, scopedAccountId).recover(network);
      return false;
    }

    return () => {
      disposed = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    };
  }, [accountId, canUseSecureConnection, database, isInitialized, saasAccount?.organization.id, session?.account_id]);

  return null;
}
