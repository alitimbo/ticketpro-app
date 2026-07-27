import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, Network, RefreshCw, Shield, ShieldOff } from "lucide-react";
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
      localPeerId = peer.id;
      const privateKey = await revealWireGuardPrivateKey(peer.private_key_encrypted ?? "");
      const operatorConfig = buildOperatorWireGuardConfig({
        address: peer.assigned_address,
        allowedIps: network.address_pool,
        endpoint: `${network.server_endpoint}:${network.server_port}`,
        privateKey,
        publicKey: network.server_public_key
      });
      const tunnelName = `ticketpro-${peer.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 38)}`;
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
        await stopWireGuardTunnel(`ticketpro-${peer.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 38)}`);
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

      <Card title="Serveur central" description="La configuration sécurisée est reçue automatiquement depuis TicketPro. Aucun secret VPS n'est demandé.">
        {network ? (
          <div className="form-grid">
            <label>Réseau<input readOnly value={form.name} /></label>
            <label>Adresse publique<input readOnly value={form.serverEndpoint} /></label>
            <label>Clé publique du serveur<input readOnly value={form.serverPublicKey} /></label>
            <label>Port WireGuard<input readOnly value={form.serverPort} /></label>
            <label>Pool privé de l'organisation<input readOnly value={form.addressPool} /></label>
          </div>
        ) : (
          <div className="notice">{isSaving ? "Configuration automatique du VPN en cours…" : "Le VPN sera configuré automatiquement avec votre licence."}</div>
        )}
        <div className="card__footer">
          <Button icon={Shield} variant="primary" disabled={isSaving} onClick={() => void saveNetwork()}>
            {isSaving ? "Configuration…" : network ? "Resynchroniser" : "Réessayer"}
          </Button>
        </div>
      </Card>

      {!network ? (
        <EmptyState icon={Network} title="Réseau VPN en attente" description="TicketPro récupère automatiquement une configuration isolée depuis le VPS." />
      ) : (
        <div className="page-grid">
          <Card className="span-6" title="Ajouter un MikroTik" description="Le pair est injecté en LAN, puis validé dès qu'un tunnel opérateur permet d'atteindre son IP WireGuard.">
            <label>
              Routeur
              <select value={selectedRouterId} onChange={(event) => setSelectedRouterId(event.target.value)}>
                <option value="">Choisir un routeur</option>
                {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
              </select>
            </label>
            <div className="card__footer">
              <Button icon={KeyRound} variant="primary" onClick={() => void createRouterPeer()}>
                Provisionner le MikroTik
              </Button>
            </div>
          </Card>
          <Card className="span-6" title="Ajouter un poste opérateur" description="Le démarrage du tunnel valide automatiquement les routeurs en attente.">
            <label>
              Nom du poste
              <input placeholder="PC de Paris" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} />
            </label>
            <div className="card__footer">
              <Button icon={Download} variant="primary" onClick={() => void createOperatorPeer()}>
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
          <div className="data-list">
            {peers.map((peer) => (
              <div className="data-list-item" key={peer.id}>
                <div className="data-list-item__icon"><Shield /></div>
                <div className="data-list-item__content">
                  <strong>{peer.name}</strong>
                  <span>{peer.peer_type === "router" ? "MikroTik" : "Opérateur"} · {peer.assigned_address}</span>
                </div>
                <Badge status={peer.status === "active" ? "success" : peer.status === "revoked" ? "offline" : "warning"}>
                  {peer.status === "active" ? "Actif" : peer.status === "revoked" ? "Révoqué" : "Brouillon"}
                </Badge>
                {peer.status !== "revoked" ? (
                  <Button icon={ShieldOff} variant="danger" onClick={() => void revokePeer(peer)}>Révoquer</Button>
                ) : null}
              </div>
            ))}
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
