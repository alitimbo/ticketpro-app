import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Globe2,
  KeyRound,
  Monitor,
  Network,
  RefreshCw,
  Server,
  Shield,
  ShieldOff
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
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
import { bootstrapSaasVpn, revokeSaasVpnPeer, upsertSaasVpnPeer } from "../../services/saas";
import { Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import { decryptLocalSecret } from "../../services/security/localSecrets";
import { RouterService } from "../../services/router";

type NetworkForm = {
  name: string;
  serverEndpoint: string;
  serverPublicKey: string;
  serverPort: string;
  addressPool: string;
};

const initialNetworkForm: NetworkForm = {
  addressPool: "10.250.0.0/24",
  name: "Réseau WireGuard principal",
  serverEndpoint: "",
  serverPort: "51820",
  serverPublicKey: ""
};

export function VpnPage() {
  const { accountSession, session } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const networkRepository = useMemo(() => new VpnNetworkRepository(database), [database]);
  const peerRepository = useMemo(() => new VpnPeerRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const [network, setNetwork] = useState<VpnNetworkRecord | null>(null);
  const [peers, setPeers] = useState<VpnPeerRecord[]>([]);
  const [routers, setRouters] = useState<RouterRecord[]>([]);
  const [form, setForm] = useState<NetworkForm>(initialNetworkForm);
  const [selectedRouterId, setSelectedRouterId] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const bootstrapAccountRef = useRef<string | null>(null);

  const load = async () => {
    if (!accountId || !isInitialized) return;

    const [storedNetwork, storedPeers, storedRouters] = await Promise.all([
      networkRepository.findByAccount(accountId),
      peerRepository.listByAccount(accountId),
      routerRepository.listByAccount(accountId)
    ]);
    setNetwork(storedNetwork);
    setPeers(storedPeers);
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
  };

  useEffect(() => {
    void load().catch((loadError: unknown) =>
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger le VPN.")
    );
  }, [accountId, isInitialized, networkRepository, peerRepository, routerRepository]);

  const saveNetwork = async () => {
    if (!accountId) {
      setError("Compte actif introuvable.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const remote = await bootstrapSaasVpn();
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
      setMessage("Réseau VPN configuré automatiquement et isolé pour votre organisation.");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Le réseau VPN n'a pas pu être configuré.");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const needsSecureBootstrap = !network || Boolean(network.provisioning_api_token_encrypted);
    if (!accountId || !isLoaded || !needsSecureBootstrap || bootstrapAccountRef.current === accountId) return;
    bootstrapAccountRef.current = accountId;
    void saveNetwork();
  }, [accountId, isLoaded, network]);

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
    if (!accountId) return 0;
    let activatedCount = 0;

    for (const routerPeer of peers.filter(
      (peer) => peer.peer_type === "router" && peer.status === "draft" && peer.router_id
    )) {
      const router = routers.find((item) => item.id === routerPeer.router_id);
      if (!router) continue;
      const vpnHost = routerPeer.assigned_address.split("/")[0];

      try {
        const password = await decryptLocalSecret(router.encrypted_password);
        await verifyRouterOverVpn(router, vpnHost, password);
        await persistVpnConnection(router, vpnHost, true, null);
        await peerRepository.updateStatus(accountId, routerPeer.id, "active");
        activatedCount += 1;
      } catch (validationError) {
        await persistVpnConnection(
          router,
          vpnHost,
          false,
          validationError instanceof Error ? validationError.message : "Validation distante impossible."
        );
      }
    }

    return activatedCount;
  };

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
    if (peers.some((peer) => peer.router_id === router.id && peer.status !== "revoked")) {
      setError("Ce routeur possède déjà un pair VPN actif ou en cours de validation.");
      return;
    }

    let remotePublicKey: string | null = null;
    let localPeerId: string | null = null;
    try {
      setError(null);
      setMessage("Provisionnement WireGuard du MikroTik en cours…");
      const keyPair = generateWireGuardKeyPair();
      const remotePeer = await upsertSaasVpnPeer({
        name: router.name,
        peerType: "router",
        publicKey: keyPair.publicKey
      });
      if (!remotePeer.assigned_address) {
        throw new Error("Le serveur VPN n'a pas attribué d'adresse au routeur.");
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
        router_id: router.id,
        peer_type: "router",
        name: router.name,
        public_key: keyPair.publicKey,
        private_key_encrypted: await protectWireGuardPrivateKey(keyPair.privateKey),
        assigned_address: remotePeer.assigned_address,
        allowed_ips: remotePeer.assigned_address,
        endpoint_address: null,
        endpoint_port: null,
        status: "draft",
        last_handshake_at: null
      });
      await reconcileConflictingLocalPeers(assignmentConflicts);
      localPeerId = peer.id;
      const privateKey = await revealWireGuardPrivateKey(peer.private_key_encrypted ?? "");
      const routerPassword = await decryptLocalSecret(router.encrypted_password);
      await createRouterService(router, router.local_ip, router.api_port, routerPassword).provisionWireGuard({
        assignedAddress: peer.assigned_address,
        interfaceName: "ticketpro-vpn",
        privateKey,
        serverAllowedIps: network.address_pool,
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
          await persistVpnConnection(router, vpnHost, true, null);
          await peerRepository.updateStatus(accountId, peer.id, "active");
          validatedNow = true;
        } catch {
          validatedNow = false;
        }
      }

      await load();
      setMessage(
        validatedNow
          ? `Pair VPN créé et connexion RouterOS distante validée pour ${router.name}.`
          : `Pair VPN injecté dans ${router.name}. Activez un poste opérateur pour valider la connexion distante.`
      );
    } catch (peerError: unknown) {
      if (remotePublicKey) {
        try {
          await revokeSaasVpnPeer({ peerType: "router", publicKey: remotePublicKey });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
      setMessage(null);
      setError(peerError instanceof Error ? peerError.message : "Le pair routeur n'a pas pu être créé.");
    }
  };

  const createOperatorPeer = async () => {
    if (!accountId || !network) {
      setError("Enregistrez d'abord le réseau VPN.");
      return;
    }

    let remotePublicKey: string | null = null;
    let localPeerId: string | null = null;
    try {
      setError(null);
      const keyPair = generateWireGuardKeyPair();
      const name =
        operatorName.trim() || `Opérateur ${peers.filter((item) => item.peer_type === "operator").length + 1}`;
      const remotePeer = await upsertSaasVpnPeer({ name, peerType: "operator", publicKey: keyPair.publicKey });
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

      let activatedRouters = 0;
      if (wireGuardAvailable) {
        await startWireGuardTunnel(tunnelName, operatorConfig);
        await peerRepository.updateStatus(accountId, peer.id, "active");
        activatedRouters = await validateDraftRouterPeers();
      } else {
        downloadText(operatorConfig, `${safeFileName(peer.name)}-wireguard.conf`);
      }

      setOperatorName("");
      await load();
      setMessage(
        wireGuardAvailable
          ? `Profil ${peer.name} activé. ${activatedRouters} routeur(s) distant(s) validé(s).`
          : `Profil ${peer.name} créé en brouillon. Importez le fichier généré dans WireGuard pour l'activer.`
      );
    } catch (peerError: unknown) {
      if (remotePublicKey) {
        try {
          await revokeSaasVpnPeer({ peerType: "operator", publicKey: remotePublicKey });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
      setError(peerError instanceof Error ? peerError.message : "Le pair opérateur n'a pas pu être créé.");
    }
  };

  const revokePeer = async (peer: VpnPeerRecord) => {
    if (!accountId) return;

    await revokeSaasVpnPeer({ peerType: peer.peer_type, publicKey: peer.public_key });
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
          // Le nettoyage local sera retenté lors d'une prochaine connexion LAN.
        }
      }
    }
    await peerRepository.updateStatus(accountId, peer.id, "revoked");
    await load();
    setMessage(`Pair ${peer.name} révoqué automatiquement sur TicketPro et sur le serveur WireGuard.`);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button icon={RefreshCw} onClick={() => void load()}>Actualiser</Button>}
        description="Un tunnel isolé par compte pour piloter les MikroTik sans exposer leur API sur Internet."
        eyebrow="Administration réseau"
        title="VPN distant WireGuard"
      />

      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

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
          <Card className="span-6 vpn-provision-card" title="Ajouter un MikroTik" description="Le pair est injecté en LAN, puis validé dès qu'un tunnel opérateur permet d'atteindre son IP WireGuard.">
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
              <Button icon={KeyRound} variant="primary" disabled={!selectedRouterId} onClick={() => void createRouterPeer()}>
                Provisionner le MikroTik
              </Button>
            </div>
          </Card>
          <Card className="span-6 vpn-provision-card" title="Ajouter un poste opérateur" description="Le démarrage du tunnel valide automatiquement les routeurs en attente.">
            <div className="vpn-provision-card__body">
              <label className="vpn-form-field">
                <span className="vpn-field-label"><Monitor aria-hidden="true" /> Nom du poste</span>
                <input placeholder="Ex. PC de Paris" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} />
                <small>Choisissez un nom clair pour identifier facilement cette machine.</small>
              </label>
            </div>
            <div className="vpn-card-actions">
              <Button icon={Download} variant="primary" disabled={!operatorName.trim()} onClick={() => void createOperatorPeer()}>
                Créer le profil WireGuard
              </Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Pairs provisionnés" description="Un pair routeur reste en brouillon jusqu'à une vraie commande RouterOS réussie via WireGuard.">
        {peers.length === 0 ? (
          <EmptyState icon={KeyRound} title="Aucun pair" description="Les pairs routeur et opérateur apparaîtront ici." />
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
              {peers.map((peer) => (
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
                    <Badge status={peer.status === "active" ? "success" : peer.status === "revoked" ? "offline" : "warning"}>
                      {peer.status === "active" ? "Actif" : peer.status === "revoked" ? "Révoqué" : "Brouillon"}
                    </Badge>
                  </div>
                  <div className="vpn-peer-action">
                    <span className="vpn-peer-cell__label">Action</span>
                    {peer.status !== "revoked" ? (
                      <Button icon={ShieldOff} variant="danger" onClick={() => void revokePeer(peer)}>Révoquer</Button>
                    ) : (
                      <span className="vpn-peer-action__empty">Aucune action</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function createRouterService(router: RouterRecord, host: string, port: number, password: string): RouterService {
  return new RouterService({
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

async function verifyRouterOverVpn(router: RouterRecord, host: string, password: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await createRouterService(router, host, 8728, password).testConnection();
      return;
    } catch (validationError) {
      lastError = validationError;
      await delay(1500);
    }
  }

  throw new Error(
    `RouterOS ne répond pas sur ${host}:8728 via WireGuard. Vérifiez le handshake, le firewall input et le service API. ${lastError instanceof Error ? lastError.message : ""}`.trim()
  );
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
