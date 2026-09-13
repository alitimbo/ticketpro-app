import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  Download,
  Globe2,
  KeyRound,
  LoaderCircle,
  Monitor,
  Network,
  RefreshCw,
  RotateCw,
  Server,
  Shield,
  ShieldOff
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { AuthSession } from "../../domain/auth";
import type { RouterRecord, VpnNetworkRecord, VpnPeerRecord } from "../../domain/database";
import {
  RouterConnectionRepository,
  RouterRepository,
  useAppDatabase,
  VpnNetworkRepository,
  VpnPeerRepository
} from "../../services/database";
import {
  buildOperatorWireGuardConfig,
  buildWireGuardTunnelName,
  generateWireGuardKeyPair,
  installWireGuard,
  isWireGuardAvailable,
  protectWireGuardPrivateKey,
  revealWireGuardPrivateKey,
  startWireGuardTunnel,
  stopWireGuardTunnel
} from "../../services/vpn";
import {
  bootstrapSaasVpn,
  listSaasVpnPeers,
  revokeSaasVpnPeer,
  rotateSaasVpnPeer,
  upsertSaasVpnPeer,
  type SaasVpnPeer
} from "../../services/saas";
import { Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import { decryptLocalSecret } from "../../services/security/localSecrets";
import { RouterService } from "../../services/router";
import {
  RouterCloudRecoveryService,
  RouterStateReconciliationService,
  WireGuardOperatorRecoveryService
} from "../../services/recovery";
import { SecureConnectionPanel } from "./SecureConnectionPanel";

type NetworkForm = {
  name: string;
  serverEndpoint: string;
  serverPublicKey: string;
  serverPort: string;
  addressPool: string;
};

type VpnOperation = {
  kind: "create-router" | "create-operator" | "renew" | "revoke";
  resourceId: string;
};

const initialNetworkForm: NetworkForm = {
  addressPool: "10.250.0.0/24",
  name: "Réseau WireGuard principal",
  serverEndpoint: "",
  serverPort: "51820",
  serverPublicKey: ""
};

// Les PC peuvent appartenir à une autre organisation que le routeur tout en
// restant filtrés par le pare-feu multi-tenant du hub. Le MikroTik doit donc
// accepter le super-réseau du hub, pas seulement son sous-réseau d'organisation.
// Les réseaux externes ou historiques conservent leur routage configuré.
function routerAllowedIpsForNetwork(addressPool: string): string {
  return /^10\.250\.\d{1,3}\.\d{1,3}\/(?:2[4-9]|3[0-2])$/.test(addressPool)
    ? "10.250.0.0/16"
    : addressPool;
}

export function VpnPage() {
  const [searchParams] = useSearchParams();
  const { accountSession, saasAccount, session } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const networkRepository = useMemo(() => new VpnNetworkRepository(database), [database]);
  const peerRepository = useMemo(() => new VpnPeerRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const recoveryService = useMemo(
    () => accountId && session
      ? new RouterCloudRecoveryService(
          database,
          accountId,
          session.internal_profile_id,
          undefined,
          saasAccount?.organization.id ?? null
        )
      : null,
    [accountId, database, saasAccount?.organization.id, session]
  );
  const reconciliationService = useMemo(
    () => session ? new RouterStateReconciliationService(database, session, {
      organizationId: saasAccount?.organization.id ?? null
    }) : null,
    [database, saasAccount?.organization.id, session]
  );
  const operatorRecoveryService = useMemo(
    () => accountId
      ? new WireGuardOperatorRecoveryService(database, accountId)
      : null,
    [accountId, database]
  );
  const [network, setNetwork] = useState<VpnNetworkRecord | null>(null);
  const [peers, setPeers] = useState<VpnPeerRecord[]>([]);
  const [routers, setRouters] = useState<RouterRecord[]>([]);
  const [remotePeers, setRemotePeers] = useState<SaasVpnPeer[]>([]);
  const [remoteStatusError, setRemoteStatusError] = useState(false);
  const [form, setForm] = useState<NetworkForm>(initialNetworkForm);
  const [selectedRouterId, setSelectedRouterId] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bootstrappedScope, setBootstrappedScope] = useState<string | null>(null);
  const [operation, setOperation] = useState<VpnOperation | null>(null);
  const [vpnProvider, setVpnProvider] = useState<"EMBEDDED" | "LEGACY">("EMBEDDED");
  const requestedRouterId = searchParams.get("router")?.trim() ?? "";
  const activeVpnScope = `${accountId ?? ""}:${saasAccount?.organization.id ?? "legacy"}`;
  const activeVpnScopeRef = useRef(activeVpnScope);
  activeVpnScopeRef.current = activeVpnScope;
  const operationRef = useRef<VpnOperation | null>(null);
  const bootstrapAccountRef = useRef<string | null>(null);
  const operatorRecoveryRef = useRef<string | null>(null);
  const routerValidationRef = useRef<string | null>(null);

  const beginOperation = (nextOperation: VpnOperation): boolean => {
    if (operationRef.current) return false;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setError(null);
    return true;
  };

  const endOperation = () => {
    operationRef.current = null;
    setOperation(null);
  };

  const refreshRemotePeers = async () => {
    if (!accountId) return;
    const requestedScope = activeVpnScopeRef.current;
    try {
      const nextPeers = await listSaasVpnPeers();
      if (activeVpnScopeRef.current !== requestedScope) return;
      setRemotePeers(nextPeers);
      setRemoteStatusError(false);
    } catch {
      if (activeVpnScopeRef.current !== requestedScope) return;
      setRemoteStatusError(true);
    }
  };

  const load = async () => {
    if (!accountId || !isInitialized) return;
    const requestedScope = activeVpnScope;
    setIsLoaded(false);
    setPeers([]);
    setRouters([]);

    const [storedNetwork, storedPeers, storedRouters] = await Promise.all([
      networkRepository.findByAccount(accountId),
      peerRepository.listByAccount(accountId),
      saasAccount?.organization.id
        ? routerRepository.listByOrganization(accountId, saasAccount.organization.id)
        : routerRepository.listByAccount(accountId)
    ]);
    if (activeVpnScopeRef.current !== requestedScope) return;
    const routerIds = new Set(storedRouters.map((router) => router.id));
    setNetwork(storedNetwork);
    setPeers(storedPeers.filter((peer) => peer.peer_type !== "router" || (
      peer.router_id !== null && routerIds.has(peer.router_id)
    )));
    setRouters(storedRouters);
    if (storedNetwork) {
      setForm({
        addressPool: storedNetwork.address_pool,
        name: storedNetwork.name,
        serverEndpoint: storedNetwork.server_endpoint,
        serverPort: String(storedNetwork.server_port),
        serverPublicKey: storedNetwork.server_public_key
      });
    }
    setIsLoaded(true);
    await refreshRemotePeers();
  };

  useEffect(() => {
    void load().catch((loadError: unknown) =>
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger le VPN.")
    );
  }, [accountId, isInitialized, networkRepository, peerRepository, routerRepository, saasAccount?.organization.id]);

  useEffect(() => {
    if (!requestedRouterId || !routers.some((router) => router.id === requestedRouterId)) return;
    setSelectedRouterId((current) => current === requestedRouterId ? current : requestedRouterId);
  }, [requestedRouterId, routers]);

  useEffect(() => {
    if (!accountId || !network) return;
    const timer = window.setInterval(() => void refreshRemotePeers(), 10_000);
    return () => window.clearInterval(timer);
  }, [accountId, network]);

  const saveNetwork = async () => {
    if (!accountId) {
      setError("Compte actif introuvable.");
      return;
    }
    setIsSaving(true);
    setError(null);
    const activeScope = activeVpnScope;
    try {
      const remote = await bootstrapSaasVpn();
      if (activeVpnScopeRef.current !== activeScope) return;
      const input = {
        id: network?.id ?? `vpn-${crypto.randomUUID()}`,
        account_id: accountId,
        name: "Réseau WireGuard TicketPro",
        server_endpoint: remote.server_endpoint,
        server_public_key: remote.server_public_key,
        server_port: remote.server_port,
        address_pool: remote.address_pool,
        provisioning_api_url: "",
        provisioning_api_token_encrypted: null,
        status: "active" as const
      };
      if (network) await networkRepository.update(input);
      else await networkRepository.create(input);
      await load();
      setBootstrappedScope(activeScope);
      setMessage("Réseau VPN configuré automatiquement et isolé pour votre organisation.");
    } catch (saveError: unknown) {
      bootstrapAccountRef.current = null;
      setBootstrappedScope(null);
      setError(saveError instanceof Error ? saveError.message : "Le réseau VPN n'a pas pu être configuré.");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const bootstrapScope = activeVpnScope;
    if (!accountId || !isLoaded || bootstrapAccountRef.current === bootstrapScope) return;
    setBootstrappedScope(null);
    bootstrapAccountRef.current = bootstrapScope;
    void saveNetwork();
  }, [accountId, isLoaded, saasAccount?.organization.id]);

  useEffect(() => {
    const activeScope = activeVpnScope;
    if (
      !accountId
      || !network
      || !operatorRecoveryService
      || !isInitialized
      || bootstrappedScope !== activeScope
    ) return;
    const recoveryKey = `${activeScope}:${network.id}`;
    if (operatorRecoveryRef.current === recoveryKey) return;
    operatorRecoveryRef.current = recoveryKey;

    void operatorRecoveryService.recover(network)
      .then(async (result) => {
        if (result.adopted > 0 || result.removedRevoked > 0) {
          await load();
        }
        if (result.adopted > 0) {
          setMessage(
            `${result.adopted} tunnel(s) WireGuard existant(s) récupéré(s) automatiquement sur ce PC.`
          );
        }
        if (result.unresolved > 0) {
          setError(
            `${result.unresolved} tunnel(s) TicketPro installé(s) n'appartiennent pas au compte actif ou ne peuvent pas être identifiés. Ils ont été conservés par sécurité.`
          );
        }
      })
      .catch((recoveryError: unknown) => {
        operatorRecoveryRef.current = null;
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "La récupération du tunnel WireGuard existant a échoué."
        );
      });
  }, [accountId, bootstrappedScope, isInitialized, network, operatorRecoveryService, saasAccount?.organization.id]);

  const persistVpnConnection = async (
    router: RouterRecord,
    host: string,
    active: boolean,
    errorMessage: string | null
  ) => {
    const existingConnections = await connectionRepository.listByRouter(router.id);
    await connectionRepository.replaceForRouter(router.id, [
      ...existingConnections
        .filter((connection) => connection.mode !== "vpn")
        .map((connection) => ({
          host: connection.host,
          id: connection.id,
          last_connected_at: connection.last_connected_at,
          last_error: connection.last_error,
          mode: connection.mode,
          port: connection.port,
          router_id: connection.router_id,
          status: connection.status,
          use_ssl: connection.use_ssl
        })),
      {
        host,
        id: `${router.id}:vpn`,
        last_connected_at: active ? new Date().toISOString() : null,
        last_error: errorMessage,
        mode: "vpn",
        port: 8728,
        router_id: router.id,
        status: active ? "active" : "inactive",
        use_ssl: 0
      }
    ]);
  };

  const reconcileConflictingLocalPeers = async (conflicts: VpnPeerRecord[]) => {
    await stopConflictingOperatorTunnels(conflicts);
    for (const conflict of conflicts.filter((peer) => peer.peer_type === "router" && peer.router_id)) {
      const router = routers.find((item) => item.id === conflict.router_id);
      if (!router) continue;
      await persistVpnConnection(
        router,
        conflict.assigned_address.split("/")[0],
        false,
        "Ancien pair VPN remplacé après resynchronisation avec le serveur."
      );
    }
  };

  const validateDraftRouterPeers = async (): Promise<number> => {
    if (!accountId || !session || !reconciliationService) return 0;
    const draftRouterPeers = peers.filter(
      (peer) => peer.peer_type === "router" && peer.status === "draft" && peer.router_id
    );
    const results = await mapWithConcurrency(draftRouterPeers, 8, async (routerPeer) => {
      const router = routers.find((item) => item.id === routerPeer.router_id);
      if (!router) return false;
      const vpnHost = routerPeer.assigned_address.split("/")[0];

      try {
        const password = await decryptLocalSecret(router.encrypted_password);
        await verifyRouterOverVpn(router, vpnHost, password, 3);
        await reconciliationService.reconcile(
          router,
          createRouterService(router, vpnHost, 8728, password, session)
        );
        await persistVpnConnection(router, vpnHost, true, null);
        await peerRepository.updateStatus(accountId, routerPeer.id, "active");
        return true;
      } catch (validationError) {
        await persistVpnConnection(
          router,
          vpnHost,
          false,
          validationError instanceof Error ? validationError.message : "Validation distante impossible."
        );
        return false;
      }
    });

    return results.filter(Boolean).length;
  };

  useEffect(() => {
    const activeOperators = peers
      .filter((peer) => peer.peer_type === "operator" && peer.status === "active")
      .map((peer) => peer.id)
      .sort();
    const draftRouters = peers
      .filter((peer) => peer.peer_type === "router" && peer.status === "draft")
      .map((peer) => peer.id)
      .sort();
    if (activeOperators.length === 0 || draftRouters.length === 0) return;
    const validationKey = `${activeOperators.join(",")}:${draftRouters.join(",")}`;
    if (routerValidationRef.current === validationKey) return;
    routerValidationRef.current = validationKey;
    void validateDraftRouterPeers()
      .then(async (activatedRouters) => {
        await load();
        if (activatedRouters > 0) {
          setMessage(
            `${activatedRouters} routeur(s) restauré(s) et validé(s) automatiquement via le tunnel WireGuard récupéré.`
          );
        }
      })
      .catch((validationError: unknown) => {
        routerValidationRef.current = null;
        setError(
          validationError instanceof Error
            ? validationError.message
            : "La validation automatique des routeurs restaurés a échoué."
        );
      });
  }, [peers, routers]);

  const createRouterPeer = async () => {
    if (!accountId || !network) {
      setError("Enregistrez d'abord le réseau VPN.");
      return;
    }
    const router = routers.find((item) => item.id === selectedRouterId);
    if (!router) {
      setError("Sélectionnez un routeur.");
      return;
    }
    if (!beginOperation({ kind: "create-router", resourceId: router.id })) return;
    if (peers.some((peer) => peer.router_id === router.id && peer.status !== "revoked")) {
      setError("Ce routeur possède déjà un pair VPN actif ou en cours de validation.");
      endOperation();
      return;
    }

    let remotePublicKey: string | null = null;
    let shouldRollbackRemotePeer = false;
    let localPeerId: string | null = null;
    try {
      setError(null);
      setMessage("Provisionnement WireGuard du MikroTik en cours…");
      const routerPassword = await decryptLocalSecret(router.encrypted_password);
      const routerService = createRouterService(
        router,
        router.local_ip,
        router.api_port,
        routerPassword,
        session
      );
      const existingInstallation = await routerService.getWireGuardInstallation("ticketpro-vpn");
      const keyPair = existingInstallation ? null : generateWireGuardKeyPair();
      const publicKey = existingInstallation?.publicKey ?? keyPair?.publicKey;
      if (!publicKey) {
        throw new Error("La clé publique WireGuard du MikroTik est introuvable.");
      }
      const remotePeer = await upsertSaasVpnPeer({
        name: router.name,
        peerType: "router",
        publicKey,
        resourceId: router.id
      });
      if (!remotePeer.assigned_address) {
        throw new Error("Le serveur VPN n'a pas attribué d'adresse au routeur.");
      }
      remotePublicKey = publicKey;
      shouldRollbackRemotePeer = Boolean(keyPair);
      const assignmentConflicts = await peerRepository.findAssignmentConflicts(
        accountId,
        network.id,
        remotePeer.assigned_address,
        publicKey
      );
      const peer = await peerRepository.create({
        id: `vpn-peer-${crypto.randomUUID()}`,
        account_id: accountId,
        network_id: network.id,
        router_id: router.id,
        resource_id: router.id,
        peer_type: "router",
        name: router.name,
        public_key: publicKey,
        private_key_encrypted: keyPair ? await protectWireGuardPrivateKey(keyPair.privateKey) : null,
        assigned_address: remotePeer.assigned_address,
        allowed_ips: remotePeer.assigned_address,
        endpoint_address: null,
        endpoint_port: null,
        status: "draft",
        last_handshake_at: null
      });
      await reconcileConflictingLocalPeers(assignmentConflicts);
      localPeerId = peer.id;
      await routerService.provisionWireGuard({
        assignedAddress: peer.assigned_address,
        interfaceName: "ticketpro-vpn",
        privateKey: keyPair?.privateKey,
        serverAllowedIps: routerAllowedIpsForNetwork(network.address_pool),
        serverEndpoint: network.server_endpoint,
        serverPort: network.server_port,
        serverPublicKey: network.server_public_key
      });

      const vpnHost = peer.assigned_address.split("/")[0];
      await persistVpnConnection(
        router,
        vpnHost,
        false,
        "Validation distante en attente d'un tunnel opérateur actif."
      );

      let validatedNow = false;
      if (peers.some((item) => item.peer_type === "operator" && item.status === "active")) {
        try {
          await verifyRouterOverVpn(router, vpnHost, routerPassword);
          await reconciliationService?.reconcile(
            router,
            createRouterService(router, vpnHost, 8728, routerPassword, session)
          );
          await persistVpnConnection(router, vpnHost, true, null);
          await peerRepository.updateStatus(accountId, peer.id, "active");
          validatedNow = true;
        } catch {
          validatedNow = false;
        }
      }

      let cloudBackupPending = false;
      try {
        await recoveryService?.backupRouter(router.id);
      } catch {
        cloudBackupPending = true;
      }
      await load();
      const provisioningMessage = validatedNow
          ? existingInstallation
            ? `Tunnel VPN existant récupéré et connexion RouterOS distante validée pour ${router.name}.`
            : `Pair VPN créé et connexion RouterOS distante validée pour ${router.name}.`
          : existingInstallation
            ? `Tunnel VPN existant récupéré pour ${router.name}. Activez un poste opérateur pour valider la connexion distante.`
            : `Pair VPN injecté dans ${router.name}. Activez un poste opérateur pour valider la connexion distante.`;
      setMessage(
        provisioningMessage
        + (cloudBackupPending ? " Sauvegarde VPS en attente de reconnexion." : "")
      );
    } catch (peerError: unknown) {
      if (remotePublicKey && shouldRollbackRemotePeer) {
        try {
          await revokeSaasVpnPeer({ peerType: "router", publicKey: remotePublicKey, resourceId: router.id });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
      setMessage(null);
      setError(peerError instanceof Error ? peerError.message : "Le pair routeur n'a pas pu être créé.");
    } finally {
      endOperation();
    }
  };

  const createOperatorPeer = async () => {
    if (!accountId || !network) {
      setError("Enregistrez d'abord le réseau VPN.");
      return;
    }

    const resourceId = `operator:${crypto.randomUUID()}`;
    if (!beginOperation({ kind: "create-operator", resourceId })) return;
    let remotePublicKey: string | null = null;
    let localPeerId: string | null = null;
    try {
      setError(null);
      const keyPair = generateWireGuardKeyPair();
      const name =
        operatorName.trim() || `Opérateur ${peers.filter((item) => item.peer_type === "operator").length + 1}`;
      const remotePeer = await upsertSaasVpnPeer({
        name,
        peerType: "operator",
        publicKey: keyPair.publicKey,
        resourceId
      });
      if (!remotePeer.assigned_address) {
        throw new Error("Le serveur VPN n'a pas attribué d'adresse à l'opérateur.");
      }
      remotePublicKey = keyPair.publicKey;
      const assignmentConflicts = await peerRepository.findAssignmentConflicts(
        accountId,
        network.id,
        remotePeer.assigned_address,
        keyPair.publicKey
      );
      const peer = await peerRepository.create({
        id: `vpn-peer-${crypto.randomUUID()}`,
        account_id: accountId,
        network_id: network.id,
        router_id: null,
        resource_id: resourceId,
        peer_type: "operator",
        name,
        public_key: keyPair.publicKey,
        private_key_encrypted: await protectWireGuardPrivateKey(keyPair.privateKey),
        assigned_address: remotePeer.assigned_address,
        allowed_ips: remotePeer.assigned_address,
        endpoint_address: network.server_endpoint,
        endpoint_port: network.server_port,
        status: "draft",
        last_handshake_at: null
      });
      await reconcileConflictingLocalPeers(assignmentConflicts);
      localPeerId = peer.id;
      const privateKey = await revealWireGuardPrivateKey(peer.private_key_encrypted ?? "");
      const operatorConfig = buildOperatorWireGuardConfig({
        address: peer.assigned_address,
        allowedIps: network.address_pool,
        endpoint: `${network.server_endpoint}:${network.server_port}`,
        privateKey,
        publicKey: network.server_public_key
      });
      const tunnelName = buildWireGuardTunnelName(peer.id);
      let wireGuardAvailable = await isWireGuardAvailable();
      if (!wireGuardAvailable) {
        try {
          await installWireGuard();
          wireGuardAvailable = await isWireGuardAvailable();
        } catch {
          wireGuardAvailable = false;
        }
      }

      let validationStarted = false;
      if (wireGuardAvailable) {
        await startWireGuardTunnel(tunnelName, operatorConfig);
        await peerRepository.updateStatus(accountId, peer.id, "active");
        validationStarted = true;
      } else {
        downloadText(operatorConfig, `${safeFileName(peer.name)}-wireguard.conf`);
      }

      setOperatorName("");
      await load();
      setMessage(
        wireGuardAvailable
          ? `Profil ${peer.name} activé. Validation et restauration des routeurs en arrière-plan…`
          : `Profil ${peer.name} créé en brouillon. Importez le fichier généré dans WireGuard pour l'activer.`
      );
      if (validationStarted) {
        void validateDraftRouterPeers()
          .then(async (activatedRouters) => {
            await load();
            setMessage(
              `Profil ${peer.name} activé. ${activatedRouters} routeur(s) distant(s) `
              + "validé(s) et réconcilié(s) avec leur état MikroTik réel."
            );
          })
          .catch((validationError: unknown) => {
            setError(
              validationError instanceof Error
                ? validationError.message
                : "La restauration distante n'a pas pu être terminée."
            );
          });
      }
    } catch (peerError: unknown) {
      if (remotePublicKey) {
        try {
          await revokeSaasVpnPeer({ peerType: "operator", publicKey: remotePublicKey, resourceId });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
      setError(peerError instanceof Error ? peerError.message : "Le pair opérateur n'a pas pu être créé.");
    } finally {
      endOperation();
    }
  };

  const revokePeer = async (peer: VpnPeerRecord) => {
    if (!accountId) return;
    if (!beginOperation({ kind: "revoke", resourceId: peer.resource_id })) return;
    try {
      await revokeSaasVpnPeer({
        peerType: peer.peer_type,
        publicKey: peer.public_key,
        resourceId: peer.resource_id
      });
      if (peer.peer_type === "operator") {
        try {
          await stopWireGuardTunnel(buildWireGuardTunnelName(peer.id));
        } catch {
          // La révocation distante reste prioritaire.
        }
      }
      if (peer.peer_type === "router" && peer.router_id) {
        const router = routers.find((item) => item.id === peer.router_id);
        if (router) {
          try {
            const routerPassword = await decryptLocalSecret(router.encrypted_password);
            await createRouterService(router, router.local_ip, router.api_port, routerPassword).removeWireGuardPeer({
              interfaceName: "ticketpro-vpn",
              serverPublicKey: network?.server_public_key ?? ""
            });
          } catch {
            // Le nettoyage RouterOS sera retenté lors d'une prochaine connexion LAN.
          }
          await persistVpnConnection(
            router,
            peer.assigned_address.split("/")[0],
            false,
            "Clé WireGuard révoquée."
          );
        }
      }
      await peerRepository.updateStatus(accountId, peer.id, "revoked");
      await load();
      setMessage(`Clé ${peer.name} révoquée. Elle est immédiatement inutilisable sur le serveur WireGuard.`);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "La clé WireGuard n'a pas pu être révoquée.");
    } finally {
      endOperation();
    }
  };

  const renewPeer = async (peer: VpnPeerRecord) => {
    if (!accountId || !network || peer.status === "revoked") return;
    const renewalWarning = peer.peer_type === "router"
      ? "Le routeur doit être joignable sur le réseau local. L'ancienne clé sera révoquée définitivement après cette vérification. Continuer ?"
      : "L'ancienne clé sera révoquée définitivement et remplacée sur ce poste. Continuer ?";
    if (!window.confirm(renewalWarning)) return;
    if (!beginOperation({ kind: "renew", resourceId: peer.resource_id })) return;

    const keyPair = generateWireGuardKeyPair();
    let remoteRotated = false;
    let replacementId: string | null = null;
    try {
      let routerRenewalContext: {
        password: string;
        router: RouterRecord;
        service: RouterService;
      } | null = null;
      if (peer.peer_type === "router") {
        const router = routers.find((item) => item.id === peer.router_id);
        if (!router) throw new Error("Le routeur associé à cette clé est introuvable.");
        const password = await decryptLocalSecret(router.encrypted_password);
        const service = createRouterService(router, router.local_ip, router.api_port, password, session);
        await service.testConnection();
        routerRenewalContext = { password, router, service };
      }

      const remotePeer = await rotateSaasVpnPeer({
        name: peer.name,
        peerType: peer.peer_type,
        previousPublicKey: peer.public_key,
        publicKey: keyPair.publicKey,
        resourceId: peer.resource_id
      });
      remoteRotated = true;
      if (!remotePeer.assigned_address) throw new Error("Le serveur VPN n'a pas conservé l'adresse du pair.");

      if (peer.peer_type === "operator") {
        try {
          await stopWireGuardTunnel(buildWireGuardTunnelName(peer.id));
        } catch {
          // L'ancienne clé est déjà révoquée sur le serveur.
        }
      }

      const replacement = await peerRepository.create({
        id: `vpn-peer-${crypto.randomUUID()}`,
        account_id: accountId,
        network_id: network.id,
        router_id: peer.router_id,
        resource_id: peer.resource_id,
        peer_type: peer.peer_type,
        name: peer.name,
        public_key: keyPair.publicKey,
        private_key_encrypted: await protectWireGuardPrivateKey(keyPair.privateKey),
        assigned_address: remotePeer.assigned_address,
        allowed_ips: remotePeer.assigned_address,
        endpoint_address: peer.peer_type === "operator" ? network.server_endpoint : null,
        endpoint_port: peer.peer_type === "operator" ? network.server_port : null,
        status: "draft",
        last_handshake_at: null
      });
      replacementId = replacement.id;

      if (peer.peer_type === "operator") {
        const operatorConfig = buildOperatorWireGuardConfig({
          address: replacement.assigned_address,
          allowedIps: network.address_pool,
          endpoint: `${network.server_endpoint}:${network.server_port}`,
          privateKey: keyPair.privateKey,
          publicKey: network.server_public_key
        });
        if (!await isWireGuardAvailable()) await installWireGuard();
        await startWireGuardTunnel(buildWireGuardTunnelName(replacement.id), operatorConfig);
        await peerRepository.updateStatus(accountId, replacement.id, "active");
      } else {
        if (!routerRenewalContext) throw new Error("La connexion locale au routeur est indisponible.");
        const { password, router, service } = routerRenewalContext;
        await service.provisionWireGuard({
          assignedAddress: replacement.assigned_address,
          interfaceName: "ticketpro-vpn",
          privateKey: keyPair.privateKey,
          serverAllowedIps: routerAllowedIpsForNetwork(network.address_pool),
          serverEndpoint: network.server_endpoint,
          serverPort: network.server_port,
          serverPublicKey: network.server_public_key
        });
        const vpnHost = replacement.assigned_address.split("/")[0];
        await persistVpnConnection(router, vpnHost, false, "Validation de la nouvelle clé en cours.");
        try {
          await verifyRouterOverVpn(router, vpnHost, password);
          await peerRepository.updateStatus(accountId, replacement.id, "active");
          await persistVpnConnection(router, vpnHost, true, null);
        } catch {
          // Le pair reste en connexion jusqu'à la validation distante.
        }
      }

      await load();
      setMessage(`Nouvelle clé créée pour ${peer.name}. L'ancienne clé a été révoquée définitivement.`);
    } catch (renewError) {
      if (remoteRotated) {
        try {
          await revokeSaasVpnPeer({
            peerType: peer.peer_type,
            publicKey: keyPair.publicKey,
            resourceId: peer.resource_id
          });
          if (replacementId) await peerRepository.updateStatus(accountId, replacementId, "revoked");
        } catch {
          // Le serveur reste la source d'autorité et refusera toute réactivation de l'ancienne clé.
        }
      }
      await peerRepository.updateStatus(accountId, peer.id, "revoked");
      await load();
      setError(
        `${renewError instanceof Error ? renewError.message : "Le renouvellement a échoué."} `
        + "L'ancienne clé reste révoquée pour protéger le réseau."
      );
    } finally {
      endOperation();
    }
  };

  const getPeerConnectionState = (peer: VpnPeerRecord) => {
    const peerOperation = operation?.resourceId === peer.resource_id ? operation : null;
    if (peerOperation?.kind === "create-router" || peerOperation?.kind === "create-operator" || peerOperation?.kind === "renew") {
      return { badge: "warning" as const, label: "En cours de connexion" };
    }
    if (peer.status === "revoked" || peerOperation?.kind === "revoke") {
      return { badge: "offline" as const, label: "Clé révoquée" };
    }
    const remotePeer = remotePeers.find((item) => item.public_key === peer.public_key)
      ?? remotePeers.find((item) => item.resource_id === peer.resource_id && item.status !== "revoked");
    if (remoteStatusError || !remotePeer || remotePeer.connection_status === "configuration_error") {
      return { badge: "error" as const, label: "Erreur de configuration" };
    }
    if (remotePeer.connection_status === "connected") {
      return { badge: "success" as const, label: "Connectée" };
    }
    if (peer.status === "draft") {
      return { badge: "warning" as const, label: "En cours de connexion" };
    }
    return { badge: "offline" as const, label: "Déconnectée" };
  };

  const visiblePeers = vpnProvider === "EMBEDDED"
    ? peers.filter((peer) => peer.peer_type === "router")
    : peers;

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button disabled={Boolean(operation)} icon={RefreshCw} onClick={() => void load()}>Actualiser</Button>}
        description="Un tunnel isolé par compte pour piloter les MikroTik sans exposer leur API sur Internet."
        eyebrow="Administration réseau"
        title="VPN distant WireGuard"
      />

      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

      <SecureConnectionPanel onProviderChange={setVpnProvider} />

      <Card
        actions={network ? <Badge status="success">Connecté</Badge> : <Badge status="warning">En attente</Badge>}
        className="vpn-server-card"
        title="Serveur central"
        description="La configuration sécurisée est reçue automatiquement depuis TicketPro. Aucun secret VPS n'est demandé."
      >
        {network ? (
          <div className="vpn-server-grid">
            <label className="vpn-readonly-field">
              <span className="vpn-field-label"><Network aria-hidden="true" /> Réseau</span>
              <input readOnly value={form.name} />
            </label>
            <label className="vpn-readonly-field">
              <span className="vpn-field-label"><Globe2 aria-hidden="true" /> Adresse publique</span>
              <input readOnly value={form.serverEndpoint} />
            </label>
            <label className="vpn-readonly-field vpn-readonly-field--wide">
              <span className="vpn-field-label"><KeyRound aria-hidden="true" /> Clé publique du serveur</span>
              <input className="vpn-monospace-input" readOnly title={form.serverPublicKey} value={form.serverPublicKey} />
            </label>
            <label className="vpn-readonly-field">
              <span className="vpn-field-label"><Server aria-hidden="true" /> Port WireGuard</span>
              <input readOnly value={form.serverPort} />
            </label>
            <label className="vpn-readonly-field">
              <span className="vpn-field-label"><Shield aria-hidden="true" /> Pool privé de l'organisation</span>
              <input className="vpn-monospace-input" readOnly value={form.addressPool} />
            </label>
          </div>
        ) : (
          <div className="notice">{isSaving ? "Configuration automatique du VPN en cours…" : "Le VPN sera configuré automatiquement avec votre licence."}</div>
        )}
        <div className="vpn-card-actions">
          <p>Les paramètres sont gérés automatiquement et restent isolés pour votre organisation.</p>
          <Button icon={Shield} variant="primary" disabled={isSaving} onClick={() => void saveNetwork()}>
            {isSaving ? "Configuration…" : network ? "Resynchroniser" : "Réessayer"}
          </Button>
        </div>
      </Card>

      {!network ? (
        <EmptyState icon={Network} title="Réseau VPN en attente" description="TicketPro récupère automatiquement une configuration isolée depuis le VPS." />
      ) : (
        <div className="page-grid vpn-provision-grid">
          <Card className="span-6 vpn-provision-card" title={requestedRouterId ? "Configurer l'accès distant" : "Ajouter un MikroTik"} description="Le pair est injecté en LAN, puis validé dès qu'un tunnel opérateur permet d'atteindre son IP WireGuard.">
            <div className="vpn-provision-card__body">
              <label className="vpn-form-field">
                <span className="vpn-field-label"><Network aria-hidden="true" /> Routeur à provisionner</span>
                <span className="vpn-select">
                  <select value={selectedRouterId} onChange={(event) => setSelectedRouterId(event.target.value)}>
                    <option value="">Sélectionner un routeur</option>
                    {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
                <small>Seuls les routeurs enregistrés dans ce compte sont proposés.</small>
              </label>
            </div>
            <div className="vpn-card-actions">
              <Button
                className={operation?.kind === "create-router" ? "vpn-button--loading" : ""}
                icon={operation?.kind === "create-router" ? LoaderCircle : KeyRound}
                variant="primary"
                disabled={!selectedRouterId || Boolean(operation)}
                onClick={() => void createRouterPeer()}
              >
                {operation?.kind === "create-router" ? "Création en cours…" : "Provisionner le MikroTik"}
              </Button>
            </div>
          </Card>
          {vpnProvider === "LEGACY" ? <Card className="span-6 vpn-provision-card" title="Ajouter un poste opérateur" description="Le démarrage du tunnel valide automatiquement les routeurs en attente.">
            <div className="vpn-provision-card__body">
              <label className="vpn-form-field">
                <span className="vpn-field-label"><Monitor aria-hidden="true" /> Nom du poste</span>
                <input placeholder="Ex. PC de Paris" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} />
                <small>Choisissez un nom clair pour identifier facilement cette machine.</small>
              </label>
            </div>
            <div className="vpn-card-actions">
              <Button
                className={operation?.kind === "create-operator" ? "vpn-button--loading" : ""}
                icon={operation?.kind === "create-operator" ? LoaderCircle : Download}
                variant="primary"
                disabled={!operatorName.trim() || Boolean(operation)}
                onClick={() => void createOperatorPeer()}
              >
                {operation?.kind === "create-operator" ? "Création en cours…" : "Créer le profil WireGuard"}
              </Button>
            </div>
          </Card> : null}
        </div>
      )}

      <Card
        title={vpnProvider === "EMBEDDED" ? "Routeurs connectés au VPN" : "Pairs provisionnés"}
        description={vpnProvider === "EMBEDDED"
          ? "Les postes Windows sont gérés dans Mes appareils. Cette liste contient uniquement les accès MikroTik du compte."
          : "Un pair routeur reste en brouillon jusqu'à une vraie commande RouterOS réussie via WireGuard."}
      >
        {visiblePeers.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={vpnProvider === "EMBEDDED" ? "Aucun routeur connecté au VPN" : "Aucun pair"}
            description={vpnProvider === "EMBEDDED"
              ? "Provisionnez un MikroTik pour créer son accès sécurisé. Les PC apparaissent uniquement dans Mes appareils."
              : "Les pairs routeur et opérateur apparaîtront ici."}
          />
        ) : (
          <div className="vpn-peer-table">
            <div aria-hidden="true" className="vpn-peer-table__header">
              <span>Pair</span>
              <span>Type</span>
              <span>Adresse VPN</span>
              <span>État</span>
              <span>Action</span>
            </div>
            <div className="vpn-peer-list">
              {visiblePeers.map((peer) => {
                const connectionState = getPeerConnectionState(peer);
                const isPeerBusy = operation?.resourceId === peer.resource_id;
                return (
                <div className="vpn-peer-row" key={peer.id}>
                  <div className="vpn-peer-identity">
                    <div className="data-list-item__icon"><Shield /></div>
                    <div className="vpn-peer-identity__content">
                      <strong>{peer.name}</strong>
                      <span>{peer.peer_type === "router" ? "Accès au routeur" : "Poste de gestion"}</span>
                    </div>
                  </div>
                  <div className="vpn-peer-cell">
                    <span className="vpn-peer-cell__label">Type</span>
                    <strong>{peer.peer_type === "router" ? "MikroTik" : "Opérateur"}</strong>
                  </div>
                  <div className="vpn-peer-cell">
                    <span className="vpn-peer-cell__label">Adresse VPN</span>
                    <code>{peer.assigned_address}</code>
                  </div>
                  <div className="vpn-peer-cell">
                    <span className="vpn-peer-cell__label">État</span>
                    <Badge status={connectionState.badge}>
                      {connectionState.label}
                    </Badge>
                  </div>
                  <div className="vpn-peer-action">
                    <span className="vpn-peer-cell__label">Action</span>
                    {peer.status !== "revoked" ? (
                      <div className="vpn-peer-actions">
                        <Button
                          className={isPeerBusy && operation?.kind === "renew" ? "vpn-button--loading" : ""}
                          disabled={Boolean(operation)}
                          icon={isPeerBusy && operation?.kind === "renew" ? LoaderCircle : RotateCw}
                          onClick={() => void renewPeer(peer)}
                        >
                          {isPeerBusy && operation?.kind === "renew" ? "Renouvellement…" : "Nouvelle clé"}
                        </Button>
                        <Button
                          className={isPeerBusy && operation?.kind === "revoke" ? "vpn-button--loading" : ""}
                          disabled={Boolean(operation)}
                          icon={isPeerBusy && operation?.kind === "revoke" ? LoaderCircle : ShieldOff}
                          variant="danger"
                          onClick={() => void revokePeer(peer)}
                        >
                          {isPeerBusy && operation?.kind === "revoke" ? "Révocation…" : "Révoquer"}
                        </Button>
                      </div>
                    ) : (
                      <span className="vpn-peer-action__empty">Aucune action</span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function createRouterService(
  router: RouterRecord,
  host: string,
  port: number,
  password: string,
  authSession?: AuthSession | null
): RouterService {
  return new RouterService({
    authSession,
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
}

async function stopConflictingOperatorTunnels(conflicts: VpnPeerRecord[]): Promise<void> {
  for (const conflict of conflicts.filter((peer) => peer.peer_type === "operator")) {
    try {
      await stopWireGuardTunnel(buildWireGuardTunnelName(conflict.id));
    } catch {
      // Le pair n'existe plus sur le hub : l'ancien service local peut déjà être absent.
    }
  }
}

async function verifyRouterOverVpn(
  router: RouterRecord,
  host: string,
  password: string,
  maximumAttempts = 10
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      await createRouterService(router, host, 8728, password).testConnection();
      return;
    } catch (validationError) {
      lastError = validationError;
      if (attempt + 1 < maximumAttempts) {
        await delay(1500);
      }
    }
  }

  throw new Error(
    `RouterOS ne répond pas sur ${host}:8728 via WireGuard. Vérifiez le handshake, le firewall input et le service API. ${lastError instanceof Error ? lastError.message : ""}`.trim()
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), items.length) },
      () => worker()
    )
  );
  return results;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function downloadText(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "ticketpro";
}
