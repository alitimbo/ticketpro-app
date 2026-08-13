import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Laptop,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Wrench
} from "lucide-react";
import {
  getSaasDeviceInventory,
  recoverCurrentSaasDevice,
  revokeSaasDevice,
  rotateCurrentSaasDeviceKey,
  type SaasDevice,
  type SaasDeviceInventory,
  SaasRequestError
} from "../../services/saas";
import {
  commitVpnIdentityRotation,
  disconnectEmbeddedVpn,
  EmbeddedVpnProvisioningService,
  ensureVpnIdentity,
  getVpnProviderStatus,
  prepareVpnIdentityRotation,
  repairEmbeddedVpn,
  type VpnProviderStatus,
  type VpnRuntimeState
} from "../../services/vpn";
import { Badge, Button, Card, ConfirmDialog, EmptyState, PasswordField } from "../../shared/ui";
import { useAuth } from "../../app/auth/AuthProvider";

type Operation = "connect" | "refresh" | "repair" | "recover" | "revoke" | "replace" | "rotate";

type SecureConnectionPanelProps = {
  onProviderChange?: (provider: VpnProviderStatus["provider"]) => void;
};

const provisioning = new EmbeddedVpnProvisioningService();

export function SecureConnectionPanel({ onProviderChange }: SecureConnectionPanelProps) {
  const { saasAccount } = useAuth();
  const [status, setStatus] = useState<VpnProviderStatus | null>(null);
  const [inventory, setInventory] = useState<SaasDeviceInventory | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [operationDeviceId, setOperationDeviceId] = useState<string | null>(null);
  const [confirmDevice, setConfirmDevice] = useState<SaasDevice | null>(null);
  const [recoveryDevice, setRecoveryDevice] = useState<SaasDevice | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDevice = useMemo(
    () => inventory?.devices.find((device) => device.installation_id === installationId) ?? null,
    [installationId, inventory]
  );
  const activeDevices = inventory?.active_count ?? 0;
  const collaboratorDevices = inventory?.collaborator_device_count ?? 0;
  const maxDevices = inventory?.max_devices ?? 0;
  const unlimitedDevices = inventory?.device_limit_mode === "unlimited";

  const refresh = useCallback(async (showLoader = false) => {
    if (showLoader) setOperation("refresh");
    try {
      const [nextStatus, identity, nextInventory] = await Promise.all([
        getVpnProviderStatus(),
        ensureVpnIdentity(),
        getSaasDeviceInventory()
      ]);
      setStatus(nextStatus);
      setInstallationId(identity.installationId);
      setInventory(nextInventory);
      onProviderChange?.(nextStatus.provider);
      if (showLoader) setError(null);
    } catch (refreshError) {
      setError(vpnErrorMessage(refreshError));
    } finally {
      if (showLoader) setOperation(null);
    }
  }, [onProviderChange]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = async (replacementDeviceId?: string) => {
    setOperation(replacementDeviceId ? "replace" : "connect");
    setOperationDeviceId(replacementDeviceId ?? null);
    setError(null);
    setMessage(null);
    try {
      const result = await provisioning.ensureConnected(undefined, replacementDeviceId);
      await refresh();
      setMessage(
        result.state === "CONNECTED"
          ? "Connexion sécurisée établie. Les MikroTik autorisés sont accessibles."
          : "Configuration appliquée. TicketPro termine la connexion en arrière-plan."
      );
    } catch (connectError) {
      setError(vpnErrorMessage(connectError));
      await refresh();
    } finally {
      setOperation(null);
      setOperationDeviceId(null);
    }
  };

  const repair = async () => {
    setOperation("repair");
    setError(null);
    setMessage(null);
    try {
      await repairEmbeddedVpn();
      await provisioning.ensureConnected();
      await refresh();
      setMessage("Le service VPN et le tunnel ont été réparés avec succès.");
    } catch (repairError) {
      setError(vpnErrorMessage(repairError));
      await refresh();
    } finally {
      setOperation(null);
    }
  };

  const revokeConfirmedDevice = async () => {
    const device = confirmDevice;
    if (!device) return;
    setConfirmDevice(null);
    setOperation("revoke");
    setOperationDeviceId(device.id);
    setError(null);
    try {
      await revokeSaasDevice(device.id);
      if (device.installation_id === installationId) await disconnectEmbeddedVpn();
      await refresh();
      setMessage(`${device.name} a été révoqué. Sa clé ne peut plus accéder au réseau privé.`);
    } catch (revokeError) {
      setError(vpnErrorMessage(revokeError));
    } finally {
      setOperation(null);
      setOperationDeviceId(null);
    }
  };

  const rotateCurrentKey = async () => {
    if (!currentDevice) return;
    setOperation("rotate");
    setOperationDeviceId(currentDevice.id);
    setError(null);
    setMessage(null);
    try {
      const current = await ensureVpnIdentity();
      const pending = await prepareVpnIdentityRotation();
      await rotateCurrentSaasDeviceKey({
        installationId: current.installationId,
        previousPublicKey: current.publicKey,
        publicKey: pending.publicKey
      });
      await commitVpnIdentityRotation();
      await provisioning.ensureConnected(currentDevice.name);
      await refresh();
      setMessage("La clé de cet appareil a été renouvelée. L'ancienne clé est immédiatement inutilisable.");
    } catch (rotationError) {
      setError(
        `${vpnErrorMessage(rotationError)} La rotation préparée sera reprise au prochain essai sans créer de doublon.`
      );
      await refresh();
    } finally {
      setOperation(null);
      setOperationDeviceId(null);
    }
  };

  const recoverCurrentDevice = async () => {
    const device = recoveryDevice;
    if (!device || !recoveryPassword) return;
    setOperation("recover");
    setOperationDeviceId(device.id);
    setError(null);
    setMessage(null);
    try {
      const current = await ensureVpnIdentity();
      const pending = await prepareVpnIdentityRotation();
      await recoverCurrentSaasDevice({
        installationId: current.installationId,
        previousPublicKey: current.publicKey,
        publicKey: pending.publicKey,
        password: recoveryPassword
      });
      await commitVpnIdentityRotation();
      setRecoveryDevice(null);
      setRecoveryPassword("");
      await provisioning.ensureConnected(device.name);
      await refresh();
      setMessage("Cet appareil a été restauré avec une nouvelle clé. L'ancienne clé reste définitivement révoquée.");
    } catch (recoveryError) {
      setError(vpnErrorMessage(recoveryError));
      await refresh();
    } finally {
      setOperation(null);
      setOperationDeviceId(null);
    }
  };

  const effectiveState: VpnRuntimeState = currentDevice?.status === "revoked"
    ? "REVOKED"
    : saasAccount && !saasAccount.subscription.is_active
      ? "SUBSCRIPTION_REQUIRED"
      : status?.state ?? "UNAVAILABLE";
  const presentation = vpnStatusPresentation(effectiveState);
  const StatusIcon = presentation.icon;
  const canReplace = !unlimitedDevices
    && !currentDevice
    && maxDevices > 0
    && activeDevices >= maxDevices;

  return (
    <div className="secure-vpn-stack">
      {message ? <div className="notice notice--success">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

      <Card
        actions={<Badge status={presentation.badge}>{presentation.label}</Badge>}
        className="secure-connection-card"
        description="TicketPro gère automatiquement le service Windows, l'identité locale et le tunnel privé."
        title="Connexion sécurisée"
      >
        <div className="secure-connection-summary">
          <div className={`secure-connection-state secure-connection-state--${presentation.tone}`}>
            <StatusIcon className={presentation.spinning ? "vpn-button--loading" : ""} aria-hidden="true" />
            <div>
              <strong>{presentation.label}</strong>
              <span>{presentation.description}</span>
            </div>
          </div>
          <div className="secure-connection-metrics">
            <ConnectionMetric label="Dernier handshake" value={formatHandshake(status?.lastHandshakeUnixSeconds)} />
            <ConnectionMetric label="Données reçues" value={formatBytes(status?.rxBytes ?? 0)} />
            <ConnectionMetric label="Données envoyées" value={formatBytes(status?.txBytes ?? 0)} />
            <ConnectionMetric label="Service" value={status?.serviceVersion ? `v${status.serviceVersion}` : "À vérifier"} />
          </div>
        </div>
        <div className="vpn-card-actions">
          <p>{vpnDetailMessage(status?.detailCode)}</p>
          <div className="secure-connection-actions">
            <Button
              disabled={Boolean(operation)}
              icon={operation === "refresh" ? LoaderCircle : RefreshCw}
              onClick={() => void refresh(true)}
            >
              Actualiser
            </Button>
            {effectiveState !== "CONNECTED" ? (
              <Button
                className={operation === "connect" ? "vpn-button--loading" : ""}
                disabled={Boolean(operation) || canReplace || ["REVOKED", "SUBSCRIPTION_REQUIRED"].includes(effectiveState)}
                icon={operation === "connect" ? LoaderCircle : ShieldCheck}
                onClick={() => void connect()}
                variant="primary"
              >
                {operation === "connect" ? "Connexion…" : "Se connecter"}
              </Button>
            ) : null}
            {effectiveState === "ERROR" || effectiveState === "UNAVAILABLE" || effectiveState === "DEGRADED" ? (
              <Button
                className={operation === "repair" ? "vpn-button--loading" : ""}
                disabled={Boolean(operation)}
                icon={operation === "repair" ? LoaderCircle : Wrench}
                onClick={() => void repair()}
              >
                {operation === "repair" ? "Réparation…" : "Réparer"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        actions={(
          <Badge status={!unlimitedDevices && activeDevices >= maxDevices && maxDevices > 0 ? "warning" : "success"}>
            {unlimitedDevices
              ? `${activeDevices} poste${activeDevices > 1 ? "s" : ""} propriétaire · Illimité`
              : `${activeDevices} / ${maxDevices} poste${maxDevices > 1 ? "s" : ""} propriétaire`}
          </Badge>
        )}
        className="device-inventory-card"
        description="Chaque installation possède sa propre clé et sa propre adresse VPN. Les accès des collaborateurs invités sont séparés et ne consomment pas le quota de postes du propriétaire."
        title="Mes appareils"
      >
        {collaboratorDevices > 0 ? (
          <div className="notice notice--info">
            {collaboratorDevices} accès collaborateur{collaboratorDevices > 1 ? "s" : ""} actif{collaboratorDevices > 1 ? "s" : ""} : révocables individuellement, sans impact sur votre forfait.
          </div>
        ) : null}
        {!inventory ? (
          <div className="secure-panel-loading"><LoaderCircle aria-hidden="true" /> Chargement des appareils…</div>
        ) : inventory.devices.length === 0 ? (
          <EmptyState icon={Laptop} title="Aucun appareil enregistré" description="Connectez ce PC pour créer sa première identité sécurisée." />
        ) : (
          <div className="device-inventory-list">
            {inventory.devices.map((device) => {
              const isCurrent = device.installation_id === installationId;
              const busy = operationDeviceId === device.id;
              const state = devicePresentation(device);
              return (
                <article className={`device-inventory-row${isCurrent ? " device-inventory-row--current" : ""}`} key={device.id}>
                  <div className="device-inventory-icon"><Laptop aria-hidden="true" /></div>
                  <div className="device-inventory-main">
                    <div className="device-inventory-title">
                      <strong>{device.name}</strong>
                      {isCurrent ? <Badge status="active">Cet appareil</Badge> : null}
                      <Badge status={state.badge}>{state.label}</Badge>
                    </div>
                    <span>{device.platform === "windows" ? "Windows" : device.platform} · TicketPro {device.app_version}</span>
                    <small>Dernière activité : {formatDate(device.last_seen_at)}</small>
                  </div>
                  <div className="device-inventory-vpn">
                    <code>{device.vpn?.assigned_address ?? "Adresse en attente"}</code>
                    <span>Clé version {device.vpn?.key_version ?? 1}</span>
                  </div>
                  <div className="device-inventory-actions">
                    {isCurrent && device.status !== "revoked" ? (
                      <Button
                        className={busy && operation === "rotate" ? "vpn-button--loading" : ""}
                        disabled={Boolean(operation)}
                        icon={busy && operation === "rotate" ? LoaderCircle : RotateCw}
                        onClick={() => void rotateCurrentKey()}
                      >
                        Nouvelle clé
                      </Button>
                    ) : null}
                    {isCurrent
                      && device.status === "revoked"
                      && activeDevices === 0
                      && saasAccount?.user.role === "owner" ? (
                      <Button
                        className={busy && operation === "recover" ? "vpn-button--loading" : ""}
                        disabled={Boolean(operation)}
                        icon={busy && operation === "recover" ? LoaderCircle : RotateCw}
                        onClick={() => {
                          setRecoveryPassword("");
                          setRecoveryDevice(device);
                        }}
                        variant="primary"
                      >
                        Restaurer cet appareil
                      </Button>
                    ) : null}
                    {!isCurrent && device.status !== "revoked" ? (
                      canReplace ? (
                        <Button
                          className={busy && operation === "replace" ? "vpn-button--loading" : ""}
                          disabled={Boolean(operation)}
                          icon={busy && operation === "replace" ? LoaderCircle : RefreshCw}
                          onClick={() => void connect(device.id)}
                          variant="primary"
                        >
                          Remplacer par ce PC
                        </Button>
                      ) : (
                        <Button
                          className={busy && operation === "revoke" ? "vpn-button--loading" : ""}
                          disabled={Boolean(operation)}
                          icon={busy && operation === "revoke" ? LoaderCircle : ShieldOff}
                          onClick={() => setConfirmDevice(device)}
                          variant="danger"
                        >
                          Révoquer
                        </Button>
                      )
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {canReplace ? (
          <div className="notice notice--warning">
            Limite atteinte. Choisissez un ancien appareil ci-dessus pour le remplacer par ce PC.
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        confirmLabel="Révoquer définitivement"
        description={confirmDevice
          ? `${confirmDevice.name} perdra immédiatement l'accès aux MikroTik. Cette opération ne déconnecte pas les autres appareils.`
          : ""}
        isOpen={Boolean(confirmDevice)}
        onCancel={() => setConfirmDevice(null)}
        onConfirm={() => void revokeConfirmedDevice()}
        title="Révoquer cet appareil ?"
      />
      {recoveryDevice ? (
        <div className="dialog-backdrop" role="presentation">
          <section aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 className="confirm-dialog__title">Restaurer cet appareil ?</h2>
            <p className="confirm-dialog__description">
              TicketPro créera une nouvelle clé locale pour ce PC. L'ancienne clé restera révoquée et aucun autre appareil ne sera réactivé.
            </p>
            <PasswordField
              disabled={operation === "recover"}
              label="Confirmez votre mot de passe propriétaire"
              name="device-recovery-password"
              onChange={setRecoveryPassword}
              value={recoveryPassword}
            />
            <div className="confirm-dialog__actions">
              <Button
                disabled={operation === "recover"}
                onClick={() => {
                  setRecoveryDevice(null);
                  setRecoveryPassword("");
                }}
                variant="ghost"
              >
                Annuler
              </Button>
              <Button
                className={operation === "recover" ? "vpn-button--loading" : ""}
                disabled={Boolean(operation) || !recoveryPassword}
                icon={operation === "recover" ? LoaderCircle : RotateCw}
                onClick={() => void recoverCurrentDevice()}
                variant="primary"
              >
                {operation === "recover" ? "Restauration…" : "Restaurer avec une nouvelle clé"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function vpnStatusPresentation(state: VpnRuntimeState) {
  switch (state) {
    case "CONNECTED":
      return { badge: "success" as const, description: "Le tunnel privé est opérationnel.", icon: CheckCircle2, label: "Connectée", spinning: false, tone: "success" };
    case "CONNECTING":
    case "INSTALLING":
      return { badge: "warning" as const, description: "Préparation du tunnel sécurisé en cours.", icon: LoaderCircle, label: "Connexion en cours", spinning: true, tone: "warning" };
    case "DEGRADED":
      return { badge: "warning" as const, description: "Le service fonctionne, mais une ressource privée répond mal.", icon: Clock3, label: "Connexion dégradée", spinning: false, tone: "warning" };
    case "REVOKED":
      return { badge: "error" as const, description: "La clé de cet appareil a été révoquée.", icon: ShieldOff, label: "Clé révoquée", spinning: false, tone: "error" };
    case "SUBSCRIPTION_REQUIRED":
      return { badge: "warning" as const, description: "Un abonnement actif est nécessaire.", icon: Clock3, label: "Abonnement requis", spinning: false, tone: "warning" };
    case "DISCONNECTED":
      return { badge: "offline" as const, description: "Le tunnel est arrêté ou non configuré.", icon: ShieldOff, label: "Déconnectée", spinning: false, tone: "offline" };
    case "ERROR":
      return { badge: "error" as const, description: "TicketPro n'a pas pu établir le tunnel.", icon: ShieldOff, label: "Erreur de configuration", spinning: false, tone: "error" };
    default:
      return { badge: "offline" as const, description: "Le service VPN intégré est indisponible.", icon: ShieldOff, label: "Indisponible", spinning: false, tone: "offline" };
  }
}

function devicePresentation(device: SaasDevice) {
  if (device.status === "revoked") return { badge: "error" as const, label: "Révoqué" };
  if (device.vpn?.applied_state === "error") return { badge: "error" as const, label: "Erreur VPN" };
  if (device.vpn?.applied_state === "pending") return { badge: "warning" as const, label: "Configuration…" };
  if (device.status === "active") return { badge: "success" as const, label: "En ligne" };
  if (device.status === "stale") return { badge: "warning" as const, label: "Inactif" };
  return { badge: "offline" as const, label: "Hors ligne" };
}

function vpnErrorMessage(error: unknown): string {
  if (error instanceof SaasRequestError) {
    const code = typeof error.details?.code === "string" ? error.details.code : "";
    if (code === "DEVICE_LIMIT_REACHED") return "La limite d'appareils est atteinte. Remplacez ou révoquez un ancien PC.";
    if (code === "DEVICE_REVOKED") return "Cet appareil a été révoqué. Le propriétaire peut le restaurer ici s'il ne reste aucun autre PC actif.";
    if (code === "DEVICE_RECOVERY_PASSWORD_INVALID") return "Mot de passe propriétaire incorrect.";
    if (code === "DEVICE_RECOVERY_OWNER_REQUIRED") return "Seul le propriétaire de l'organisation peut restaurer le dernier appareil.";
    if (code === "DEVICE_RECOVERY_REQUIRES_NO_ACTIVE_DEVICE") return "Un autre appareil actif existe encore. Utilisez-le pour gérer ou remplacer ce PC.";
    if (code === "SUBSCRIPTION_REQUIRED") return "Votre abonnement ne permet pas actuellement la connexion sécurisée.";
  }
  return error instanceof Error ? error.message : "L'opération VPN a échoué.";
}

function vpnDetailMessage(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    WIREGUARD_HANDSHAKE_PENDING: "Le tunnel est prêt et attend la première réponse du gateway.",
    WIREGUARD_HANDSHAKE_STALE: "Le dernier handshake est ancien. Vérifiez la connexion Internet.",
    WIREGUARD_ADAPTER_NOT_READY: "Windows termine la création de l'interface réseau TicketPro.",
    VPN_SERVICE_UNAVAILABLE: "Le service Windows TicketPro VPN ne répond pas.",
    TUNNEL_CONFIG_MISSING: "La configuration locale doit être resynchronisée depuis TicketPro."
  };
  return code ? messages[code] ?? `Diagnostic : ${code}` : "Aucune configuration WireGuard manuelle n'est nécessaire.";
}

function formatHandshake(timestamp: number | null | undefined): string {
  if (!timestamp) return "En attente";
  return formatDate(new Date(timestamp * 1_000).toISOString());
}

function formatDate(value: string | null): string {
  if (!value) return "Jamais";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Inconnue" : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
