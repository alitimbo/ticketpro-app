import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, Network, Plus, RefreshCw, Shield, ShieldOff } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { RouterRecord, VpnNetworkRecord, VpnPeerRecord } from "../../domain/database";
import { LicenseStateRepository, RouterConnectionRepository, RouterRepository, useAppDatabase, VpnNetworkRepository, VpnPeerRepository } from "../../services/database";
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
import { bootstrapLicenseVpn, revokeLicenseVpnPeer, unprotectLicenseToken, upsertLicenseVpnPeer } from "../../services/licensing";
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
  const licenseRepository = useMemo(() => new LicenseStateRepository(database), [database]);
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
    if (!accountId || !isInitialized) {
      return;
    }
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
    void load().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Impossible de charger le VPN."));
  }, [accountId, isInitialized, networkRepository, peerRepository, routerRepository]);

  const getLicenseCredentials = async () => {
    const stored = await licenseRepository.findCurrent();
    if (!stored || stored.account_id !== accountId || stored.status !== "active") {
      throw new Error("Une licence TicketPro active est requise pour utiliser le VPN.");
    }
    return {
      activationToken: await unprotectLicenseToken(stored.activation_token_encrypted),
      licenseId: stored.license_id
    };
  };

  const saveNetwork = async () => {
    if (!accountId) {
      setError("Compte actif introuvable.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const license = await getLicenseCredentials();
      const remote = await bootstrapLicenseVpn({
        accountId,
        activationToken: license.activationToken,
        licenseId: license.licenseId
      });
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
      if (network) {
        await networkRepository.update(input);
      } else {
        await networkRepository.create(input);
      }
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
      setError("Ce routeur possède déjà un pair VPN actif.");
      return;
    }
    let remotePublicKey: string | null = null;
    let localPeerId: string | null = null;
    try {
      setError(null);
      const keyPair = generateWireGuardKeyPair();
      const license = await getLicenseCredentials();
      const remotePeer = await upsertLicenseVpnPeer({
        accountId,
        activationToken: license.activationToken,
        licenseId: license.licenseId,
        name: router.name,
        peerType: "router",
        publicKey: keyPair.publicKey
      });
      if (!remotePeer.assigned_address) throw new Error("Le serveur VPN n'a pas attribué d'adresse au routeur.");
      remotePublicKey = keyPair.publicKey;
      const assignedAddress = remotePeer.assigned_address;
      const peer = await peerRepository.create({
        id: `vpn-peer-${crypto.randomUUID()}`,
        account_id: accountId,
        network_id: network.id,
        router_id: router.id,
        peer_type: "router",
        name: router.name,
        public_key: keyPair.publicKey,
        private_key_encrypted: await protectWireGuardPrivateKey(keyPair.privateKey),
        assigned_address: assignedAddress,
        allowed_ips: assignedAddress,
        endpoint_address: null,
        endpoint_port: null,
        status: "draft",
        last_handshake_at: null
      });
      localPeerId = peer.id;
      const privateKey = await revealWireGuardPrivateKey(peer.private_key_encrypted ?? "");
      const routerPassword = await decryptLocalSecret(router.encrypted_password);
      await new RouterService({
        authSession: session,
        mikrotik: {
          host: router.local_ip,
          password: routerPassword,
          port: router.api_port,
          useSsl: false,
          username: router.username
        },
        mode: "mikrotik"
      }).provisionWireGuard({
        assignedAddress: peer.assigned_address,
        interfaceName: "ticketpro-vpn",
        privateKey,
        serverAllowedIps: network.address_pool,
        serverEndpoint: network.server_endpoint,
        serverPort: network.server_port,
        serverPublicKey: network.server_public_key
      });
      await peerRepository.updateStatus(accountId, peer.id, "active");
      const existingConnections = await connectionRepository.listByRouter(router.id);
      await connectionRepository.replaceForRouter(router.id, [
        ...existingConnections.filter((connection) => connection.mode !== "vpn").map((connection) => ({
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
          host: peer.assigned_address.split("/")[0],
          id: `${router.id}:vpn`,
          last_connected_at: null,
          last_error: null,
          mode: "vpn",
          port: router.api_ssl_port,
          router_id: router.id,
          status: "inactive",
          use_ssl: 1
        }
      ]);
      await load();
      setMessage(`Pair VPN créé et injecté automatiquement dans ${router.name}.`);
    } catch (peerError: unknown) {
      if (remotePublicKey) {
        try {
          const license = await getLicenseCredentials();
          await revokeLicenseVpnPeer({
            accountId,
            activationToken: license.activationToken,
            licenseId: license.licenseId,
            peerType: "router",
            publicKey: remotePublicKey
          });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
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
      const name = operatorName.trim() || `Opérateur ${peers.filter((item) => item.peer_type === "operator").length + 1}`;
      const license = await getLicenseCredentials();
      const remotePeer = await upsertLicenseVpnPeer({
        accountId,
        activationToken: license.activationToken,
        licenseId: license.licenseId,
        name,
        peerType: "operator",
        publicKey: keyPair.publicKey
      });
      if (!remotePeer.assigned_address) throw new Error("Le serveur VPN n'a pas attribué d'adresse à l'opérateur.");
      remotePublicKey = keyPair.publicKey;
      const assignedAddress = remotePeer.assigned_address;
      const peer = await peerRepository.create({
        id: `vpn-peer-${crypto.randomUUID()}`,
        account_id: accountId,
        network_id: network.id,
        router_id: null,
        peer_type: "operator",
        name,
        public_key: keyPair.publicKey,
        private_key_encrypted: await protectWireGuardPrivateKey(keyPair.privateKey),
        assigned_address: assignedAddress,
        allowed_ips: assignedAddress,
        endpoint_address: network.server_endpoint,
        endpoint_port: network.server_port,
        status: "draft",
        last_handshake_at: null
      });
      localPeerId = peer.id;
      const privateKey = await revealWireGuardPrivateKey(peer.private_key_encrypted ?? "");
      await peerRepository.updateStatus(accountId, peer.id, "active");
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
      if (wireGuardAvailable) {
        await startWireGuardTunnel(tunnelName, operatorConfig);
      } else {
        downloadText(operatorConfig, `${safeFileName(peer.name)}-wireguard.conf`);
      }
      setOperatorName("");
      await load();
      setMessage(wireGuardAvailable ? `Profil ${peer.name} créé et tunnel WireGuard activé automatiquement.` : `Profil ${peer.name} créé. L'installation automatique de WireGuard a échoué ; le fichier de secours a été généré.`);
    } catch (peerError: unknown) {
      if (remotePublicKey) {
        try {
          const license = await getLicenseCredentials();
          await revokeLicenseVpnPeer({
            accountId,
            activationToken: license.activationToken,
            licenseId: license.licenseId,
            peerType: "operator",
            publicKey: remotePublicKey
          });
          if (localPeerId) await peerRepository.updateStatus(accountId, localPeerId, "revoked");
        } catch {
          // Le prochain contrôle serveur permettra de reprendre ce nettoyage.
        }
      }
      setError(peerError instanceof Error ? peerError.message : "Le pair opérateur n'a pas pu être créé.");
    }
  };

  const revokePeer = async (peer: VpnPeerRecord) => {
    if (!accountId) {
      return;
    }
    const license = await getLicenseCredentials();
    await revokeLicenseVpnPeer({
      accountId,
      activationToken: license.activationToken,
      licenseId: license.licenseId,
      peerType: peer.peer_type,
      publicKey: peer.public_key
    });
    if (peer.peer_type === "operator") {
      try {
        await stopWireGuardTunnel(`ticketpro-${peer.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 38)}`);
      } catch {
        // La révocation du peer reste prioritaire même si le service local est déjà arrêté.
      }
    }
    if (peer.peer_type === "router" && peer.router_id) {
      const router = routers.find((item) => item.id === peer.router_id);
      if (router) {
        try {
          const routerPassword = await decryptLocalSecret(router.encrypted_password);
          await new RouterService({
            authSession: session,
            mikrotik: {
              host: router.local_ip,
              password: routerPassword,
              port: router.api_port,
              useSsl: false,
              username: router.username
            },
            mode: "mikrotik"
          }).removeWireGuardPeer({ interfaceName: "ticketpro-vpn", serverPublicKey: network?.server_public_key ?? "" });
        } catch {
          // Le peer hub est déjà révoqué ; le nettoyage local sera retenté lors d'une prochaine connexion.
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
        <div className="card__footer"><Button icon={Shield} variant="primary" disabled={isSaving} onClick={() => void saveNetwork()}>{isSaving ? "Configuration…" : network ? "Resynchroniser" : "Réessayer"}</Button></div>
      </Card>

      {!network ? (
        <EmptyState icon={Network} title="Réseau VPN en attente" description="TicketPro récupère automatiquement une configuration isolée depuis le VPS." />
      ) : (
        <div className="page-grid">
          <Card className="span-6" title="Ajouter un MikroTik" description="TicketPro injecte automatiquement l’interface WireGuard et le pair via l’API RouterOS.">
            <label>Routeur<select value={selectedRouterId} onChange={(event) => setSelectedRouterId(event.target.value)}><option value="">Choisir un routeur</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select></label>
            <div className="card__footer"><Button icon={KeyRound} variant="primary" onClick={() => void createRouterPeer()}>Provisionner automatiquement le MikroTik</Button></div>
          </Card>
          <Card className="span-6" title="Ajouter un poste opérateur" description="Un profil permet à un utilisateur autorisé d’atteindre les routeurs du compte.">
            <label>Nom du poste<input placeholder="PC de Paris" value={operatorName} onChange={(event) => setOperatorName(event.target.value)} /></label>
            <div className="card__footer"><Button icon={Download} variant="primary" onClick={() => void createOperatorPeer()}>Créer le profil WireGuard</Button></div>
          </Card>
        </div>
      )}

      <Card title="Pairs provisionnés" description="Révoquez immédiatement un accès compromis. TicketPro applique automatiquement la révocation sur le VPS.">
        {peers.length === 0 ? <EmptyState icon={KeyRound} title="Aucun pair" description="Les pairs routeur et opérateur apparaîtront ici." /> : <div className="data-list">{peers.map((peer) => <div className="data-list-item" key={peer.id}><div className="data-list-item__icon"><Shield /></div><div className="data-list-item__content"><strong>{peer.name}</strong><span>{peer.peer_type === "router" ? "MikroTik" : "Opérateur"} · {peer.assigned_address}</span></div><Badge status={peer.status === "active" ? "success" : peer.status === "revoked" ? "offline" : "warning"}>{peer.status === "active" ? "Actif" : peer.status === "revoked" ? "Révoqué" : "Brouillon"}</Badge>{peer.status === "active" ? <Button icon={ShieldOff} variant="danger" onClick={() => void revokePeer(peer)}>Révoquer</Button> : null}</div>)}</div>}
      </Card>
    </div>
  );
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
