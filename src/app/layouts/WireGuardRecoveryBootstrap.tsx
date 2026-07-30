import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  useAppDatabase,
  VpnNetworkRepository
} from "../../services/database";
import { WireGuardOperatorRecoveryService } from "../../services/recovery";
import { bootstrapSaasVpn } from "../../services/saas";

const recoveredAccounts = new Set<string>();

export function WireGuardRecoveryBootstrap() {
  const { accountSession, session } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const canUseVpn = Boolean(session?.permissions.includes("global.vpn"));

  useEffect(() => {
    if (!accountId || !session || !isInitialized || !canUseVpn) return;
    if (recoveredAccounts.has(accountId)) return;
    const scopedAccountId = accountId;
    recoveredAccounts.add(scopedAccountId);

    void recoverExistingTunnel()
      .catch(() => {
        // Une panne réseau ou un refus temporaire sera retenté après une
        // reconnexion ou au chargement explicite de la page VPN.
        recoveredAccounts.delete(scopedAccountId);
      });

    async function recoverExistingTunnel() {
      const networks = new VpnNetworkRepository(database);
      let network = await networks.findByAccount(scopedAccountId);
      if (!network) {
        const remote = await bootstrapSaasVpn();
        network = await networks.create({
          account_id: scopedAccountId,
          address_pool: remote.address_pool,
          id: `vpn-${crypto.randomUUID()}`,
          name: "Réseau WireGuard TicketPro",
          provisioning_api_token_encrypted: null,
          provisioning_api_url: "",
          server_endpoint: remote.server_endpoint,
          server_port: remote.server_port,
          server_public_key: remote.server_public_key,
          status: "active"
        });
      }
      await new WireGuardOperatorRecoveryService(database, scopedAccountId).recover(network);
    }
  }, [accountId, canUseVpn, database, isInitialized, session]);

  return null;
}
