import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Network,
  Plus,
  RadioTower,
  Save,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { RouterRecord } from "../../domain/database";
import {
  RouterConnectionRepository,
  RouterRepository,
  useAppDatabase
} from "../../services/database";
import {
  defaultRouterAccessPolicy,
  normalizeMacAddress,
  routerAccessPolicyCloudId,
  RouterAccessPolicySyncService,
  validateRouterAccessPolicy,
  type InfrastructureDevice,
  type RouterAccessPolicy,
  type RouterAccessPolicySyncStatus
} from "../../services/access";
import { createPersistedRouterService, RouterServiceError } from "../../services/router";
import { encryptLocalSecret } from "../../services/security/localSecrets";
import { Badge, Button, Card, DataListItem, PageHeader, PasswordField, StatusDot } from "../../shared/ui";
import {
  canEditRouterSensitiveSettings,
  canViewRouterSettings,
  defaultRouterSettings,
  routerRecordToSettings,
  validateRouterSettings,
  type RouterSettings
} from "./routerSettingsPageModel";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

const emptyInfrastructureDevice: Omit<InfrastructureDevice, "id"> = {
  internetBypass: true,
  ipAddress: "",
  macAddress: "",
  mode: "bridge",
  name: "",
  type: "antenna"
};

export function RouterSettingsPage() {
  const { session } = useAuth();
  const { routerId = "" } = useParams();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canView = canViewRouterSettings(session?.internal_profile_role);
  const canEditSensitive = canEditRouterSensitiveSettings(session?.internal_profile_role);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const accessPolicySyncService = useMemo(
    () => new RouterAccessPolicySyncService(database),
    [database]
  );
  const [router, setRouter] = useState<RouterRecord | null>(null);
  const [settings, setSettings] = useState<RouterSettings>(defaultRouterSettings);
  const [accessPolicy, setAccessPolicy] = useState<RouterAccessPolicy>(() =>
    structuredClone(defaultRouterAccessPolicy)
  );
  const [savedAccessPolicy, setSavedAccessPolicy] = useState<RouterAccessPolicy>(() =>
    structuredClone(defaultRouterAccessPolicy)
  );
  const [accessPolicySyncStatus, setAccessPolicySyncStatus] =
    useState<RouterAccessPolicySyncStatus>("offline");
  const [cloudRouterId, setCloudRouterId] = useState(routerId);
  const [conflictingRemotePolicy, setConflictingRemotePolicy] =
    useState<{ policy: RouterAccessPolicy; revision: number } | null>(null);
  const [infrastructureDraft, setInfrastructureDraft] = useState(emptyInfrastructureDevice);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testMessage, setTestMessage] = useState("Non testé");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAccessPolicy, setIsSavingAccessPolicy] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!isInitialized || !session || !routerId) {
      return undefined;
    }

    let mounted = true;

    void (async () => {
      try {
        const record = await routerRepository.findById(routerId);
        if (!mounted) return;
        if (!record || record.deleted_at || record.account_id !== session.account_id) {
          setFeedback({ kind: "error", text: "Routeur introuvable pour cette organisation." });
          setIsLoading(false);
          return;
        }
        const connections = await connectionRepository.listByRouter(routerId);
        const stableCloudRouterId = routerAccessPolicyCloudId(record, connections);
        const policySync = await accessPolicySyncService.load(
          session.account_id,
          routerId,
          stableCloudRouterId
        );
        if (!mounted) return;
        setRouter(record);
        setSettings(routerRecordToSettings(record));
        setCloudRouterId(stableCloudRouterId);
        setAccessPolicy(policySync.policy);
        setSavedAccessPolicy(structuredClone(policySync.policy));
        setAccessPolicySyncStatus(policySync.status);
        setConflictingRemotePolicy(
          policySync.status === "conflict" && policySync.remotePolicy
            ? { policy: policySync.remotePolicy, revision: policySync.revision }
            : null
        );
        setIsLoading(false);
      } catch (error) {
        if (!mounted) return;
        setFeedback({
          kind: "error",
          text: error instanceof Error ? error.message : "Impossible de charger les paramètres du routeur."
        });
        setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [accessPolicySyncService, connectionRepository, isInitialized, routerId, routerRepository, session]);

  const updateSettings = (partial: Partial<RouterSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    setFeedback(null);
    setTestMessage("À retester");
  };

  const saveSettings = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut modifier ces paramètres." });
      return;
    }

    const validationError = validateRouterSettings(settings);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const encryptedPassword = settings.password.trim()
        ? await encryptLocalSecret(settings.password)
        : router.encrypted_password;
      const name = settings.name.trim();
      const updated = await routerRepository.update({
        ...router,
        api_port: Number(settings.apiPort),
        api_ssl_port: Number(settings.apiSslPort),
        connection_mode: settings.connectionMode,
        encrypted_password: encryptedPassword,
        hotspot_address: settings.hotspotAddress.trim(),
        label: name,
        local_ip: settings.ipAddress.trim(),
        name,
        sync_status: "local",
        username: settings.username.trim()
      });

      setRouter(updated);
      setSettings(routerRecordToSettings(updated));
      setFeedback({
        kind: "success",
        text: "Paramètres enregistrés dans la base locale et connexion locale mise à jour."
      });
      setTestMessage("À retester");
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "L'enregistrement des paramètres a échoué."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    if (!router || !session) {
      setFeedback({ kind: "error", text: "Le routeur n'est pas encore chargé." });
      return;
    }

    if (hasUnsavedConnectionChanges(router, settings)) {
      setFeedback({
        kind: "error",
        text: "Enregistrez d'abord les modifications de connexion, puis relancez le test."
      });
      return;
    }

    setIsTesting(true);
    setFeedback(null);

    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      const result = await service.testConnection();

      if (connections.some((connection) => connection.mode === result.mode)) {
        await routerRepository.recordConnectionTest({
          accountId: session.account_id,
          checkedAt: result.checkedAt,
          errorMessage: null,
          internalProfileId: session.internal_profile_id,
          mode: result.mode,
          routerId: router.id,
          status: "connected"
        });
      }
      setRouter((current) => current ? { ...current, last_seen_at: result.checkedAt, status: "active" } : current);
      setTestMessage("Routeur connecté");
      setFeedback({ kind: "success", text: `Connexion RouterOS réussie en mode ${result.mode}.` });
    } catch (error) {
      const detail = error instanceof RouterServiceError || error instanceof Error
        ? error.message
        : "Test impossible.";
      setTestMessage("Connexion échouée");
      setFeedback({ kind: "error", text: detail });
    } finally {
      setIsTesting(false);
    }
  };

  const updateAccessPolicy = (partial: Partial<RouterAccessPolicy>) => {
    setAccessPolicy((current) => ({ ...current, ...partial }));
    setFeedback(null);
  };

  const addInfrastructureDevice = () => {
    const device: InfrastructureDevice = {
      ...infrastructureDraft,
      id: globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ipAddress: infrastructureDraft.ipAddress.trim(),
      macAddress: normalizeMacAddress(infrastructureDraft.macAddress),
      name: infrastructureDraft.name.trim()
    };
    const candidate = {
      ...accessPolicy,
      infrastructureDevices: [...accessPolicy.infrastructureDevices, device]
    };
    const validationError = validateRouterAccessPolicy(candidate);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }
    setAccessPolicy(candidate);
    setInfrastructureDraft(emptyInfrastructureDevice);
    setFeedback(null);
  };

  const removeInfrastructureDevice = (id: string) => {
    updateAccessPolicy({
      infrastructureDevices: accessPolicy.infrastructureDevices.filter(
        (device) => device.id !== id
      )
    });
  };

  const applyInfrastructurePolicy = async (
    previousPolicy: RouterAccessPolicy,
    nextPolicy: RouterAccessPolicy
  ) => {
    if (!router || !session) throw new Error("Routeur ou session introuvable.");
    const previousById = new Map(
      previousPolicy.infrastructureDevices.map((device) => [device.id, device])
    );
    const nextById = new Map(
      nextPolicy.infrastructureDevices.map((device) => [device.id, device])
    );
    const removals = previousPolicy.infrastructureDevices.filter((device) => {
      const next = nextById.get(device.id);
      return device.internetBypass && (!next || !next.internetBypass);
    });
    const upserts = nextPolicy.infrastructureDevices.filter(
      (device) => device.internetBypass
    );
    if (removals.length === 0 && upserts.length === 0) return;

    const connections = await connectionRepository.listByRouter(router.id);
    const service = await createPersistedRouterService({
      authSession: session,
      connections,
      database,
      router
    });
    for (const device of removals) {
      await service.removeHotspotBypass(device.id, device.macAddress);
    }
    for (const device of upserts) {
      const previous = previousById.get(device.id);
      if (previous?.internetBypass && previous.macAddress !== device.macAddress) {
        await service.removeHotspotBypass(previous.id, previous.macAddress);
      }
      await service.upsertHotspotBypass({
        address: device.ipAddress,
        comment: `${device.name} (${device.type})`,
        id: device.id,
        macAddress: device.macAddress
      });
    }
  };

  const saveAccessPolicy = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut modifier cette politique réseau." });
      return;
    }

    const validationError = validateRouterAccessPolicy(accessPolicy);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }
    if (hasUnsavedConnectionChanges(router, settings)) {
      setFeedback({
        kind: "error",
        text: "Enregistrez d'abord les paramètres de connexion avant d'appliquer la politique réseau."
      });
      return;
    }

    setIsSavingAccessPolicy(true);
    setFeedback(null);

    try {
      await applyInfrastructurePolicy(savedAccessPolicy, accessPolicy);

      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        accessPolicy,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setFeedback(syncResult.status === "synced"
        ? {
            kind: "success",
            text: "Politique synchronisée avec RouterOS, la base locale et le VPS."
          }
        : syncResult.status === "conflict"
          ? {
              kind: "error",
              text: "Conflit détecté avec un autre PC. Aucune configuration distante n'a été écrasée."
            }
          : {
              kind: "success",
              text: "RouterOS et la base locale sont à jour. La synchronisation VPS reprendra automatiquement dès le retour du réseau."
            });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof RouterServiceError || error instanceof Error
          ? error.message
          : "Impossible d'appliquer la politique d'accès."
      });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const resolveAccessPolicyConflict = async (choice: "local" | "remote") => {
    if (!conflictingRemotePolicy || !router || !session) return;
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      const syncResult = choice === "remote"
        ? await (async () => {
            await applyInfrastructurePolicy(
              savedAccessPolicy,
              conflictingRemotePolicy.policy
            );
            return accessPolicySyncService.acceptRemote(
              session.account_id,
              router.id,
              conflictingRemotePolicy.policy,
              conflictingRemotePolicy.revision,
              cloudRouterId
            );
          })()
        : await accessPolicySyncService.overwriteRemote(
            session.account_id,
            router.id,
            accessPolicy,
            conflictingRemotePolicy.revision,
            cloudRouterId
          );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(null);
      setFeedback({
        kind: "success",
        text: choice === "remote"
          ? "La version du VPS a été appliquée localement et sur RouterOS."
          : "La version de ce PC a remplacé la version du VPS."
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Impossible de résoudre le conflit de synchronisation."
      });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  if (!canView) {
    return (
      <div className="page-stack">
        <PageHeader description="Accès réservé aux profils autorisés." eyebrow="Routeur" title="Paramètres routeur" />
        <Card>
          <StatusDot label="Accès non autorisé" status="error" />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        actions={canEditSensitive ? (
          <Button disabled={isLoading || isSaving || !router} icon={Save} onClick={() => void saveSettings()} variant="primary">
            {isSaving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        ) : null}
        description="Configuration réelle du routeur et de son portail captif."
        eyebrow="Routeur"
        title="Paramètres routeur"
      />

      {feedback ? (
        <p className={`form-error${feedback.kind === "success" ? " form-error--success" : ""}`}>
          {feedback.text}
        </p>
      ) : null}

      <Card title="Connexion routeur" description="Ces informations sont enregistrées pour ce routeur et utilisées par RouterOS.">
        <div className="router-form-grid">
          <label className="form-field">
            Nom du routeur
            <input disabled={!canEditSensitive || isLoading} value={settings.name} onChange={(event) => updateSettings({ name: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse IP locale
            <input disabled={!canEditSensitive || isLoading} value={settings.ipAddress} onChange={(event) => updateSettings({ ipAddress: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse Hotspot / portail captif
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="Ex. wifi.mon-etablissement.com"
              value={settings.hotspotAddress}
              onChange={(event) => updateSettings({ hotspotAddress: event.target.value })}
            />
            <small>Adresse que les clients saisiront dans leur navigateur. Elle figurera sur chaque ticket.</small>
          </label>
          <label className="form-field">
            Port API
            <input disabled={!canEditSensitive || isLoading} value={settings.apiPort} onChange={(event) => updateSettings({ apiPort: event.target.value })} />
          </label>
          <label className="form-field">
            Port API SSL
            <input disabled={!canEditSensitive || isLoading} value={settings.apiSslPort} onChange={(event) => updateSettings({ apiSslPort: event.target.value })} />
          </label>
          <label className="form-field">
            Mode de connexion prioritaire
            <select
              disabled={!canEditSensitive || isLoading}
              value={settings.connectionMode}
              onChange={(event) => updateSettings({ connectionMode: event.target.value as RouterSettings["connectionMode"] })}
            >
              <option value="local">Local</option>
              <option value="distant_ip">Adresse distante</option>
              <option value="vpn">VPN</option>
              <option value="agent_future">Agent distant futur</option>
            </select>
          </label>
          <label className="form-field">
            Utilisateur MikroTik
            <input disabled={!canEditSensitive || isLoading} value={settings.username} onChange={(event) => updateSettings({ username: event.target.value })} />
          </label>
          <PasswordField
            autoComplete="new-password"
            disabled={!canEditSensitive || isLoading}
            label="Nouveau mot de passe MikroTik"
            onChange={(password) => updateSettings({ password })}
            placeholder="Laisser vide pour conserver le mot de passe actuel"
            value={settings.password}
          />
        </div>
        <div className="router-form-result">
          <Badge status={testMessage === "Routeur connecté" ? "success" : testMessage === "Connexion échouée" ? "error" : "warning"}>
            {testMessage}
          </Badge>
          <Button disabled={!canEditSensitive || isLoading || isTesting || !router} icon={Search} onClick={() => void testConnection()}>
            {isTesting ? "Test en cours…" : "Tester la connexion réelle"}
          </Button>
        </div>
      </Card>

      <Card
        title="Contrôle d'accès et anti-partage"
        description="Associez chaque voucher à son premier appareil. Les contrôles TTL avancés restent en observation jusqu'à leur calibration sur un routeur réel."
      >
        <div className="option-list">
          <label className="toggle-option">
            <input
              checked={accessPolicy.lockVoucherToFirstMac}
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => updateAccessPolicy({
                lockVoucherToFirstMac: event.target.checked
              })}
              type="checkbox"
            />
            <ShieldCheck aria-hidden="true" />
            <span>Verrouiller le voucher sur le premier appareil connecté</span>
          </label>
          <label className="form-field">
            Contrôle du partage de connexion
            <select
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => updateAccessPolicy({
                antiSharingMode: event.target.value as RouterAccessPolicy["antiSharingMode"]
              })}
              value={accessPolicy.antiSharingMode}
            >
              <option value="disabled">Désactivé</option>
              <option value="observe">Observation et préparation</option>
              <option disabled value="strict">Strict — après calibration réelle</option>
            </select>
            <small>
              Le verrou MAC empêche le même voucher sur plusieurs appareils. Un téléphone faisant du NAT
              exige en plus une calibration TTL/Hop Limit avant tout blocage strict.
            </small>
          </label>
          <label className="toggle-option">
            <input
              checked={accessPolicy.monitorIpv4Ttl}
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => updateAccessPolicy({
                monitorIpv4Ttl: event.target.checked
              })}
              type="checkbox"
            />
            <Network aria-hidden="true" />
            <span>Préparer la surveillance TTL IPv4</span>
          </label>
          <label className="toggle-option">
            <input
              checked={accessPolicy.monitorIpv6HopLimit}
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => updateAccessPolicy({
                monitorIpv6HopLimit: event.target.checked
              })}
              type="checkbox"
            />
            <Network aria-hidden="true" />
            <span>Préparer la surveillance Hop Limit IPv6</span>
          </label>
        </div>
      </Card>

      <Card
        title="Antennes et équipements d'infrastructure"
        description="Seuls les équipements en bridge transparent peuvent être bypassés. Leurs clients restent soumis au portail captif."
      >
        <div className="router-form-result">
          <StatusDot
            label={accessPolicySyncLabel(accessPolicySyncStatus)}
            status={
              accessPolicySyncStatus === "synced"
                ? "active"
                : accessPolicySyncStatus === "conflict"
                  ? "error"
                  : "warning"
            }
          />
          <span>La configuration locale reste utilisable même pendant une coupure Internet.</span>
        </div>

        {conflictingRemotePolicy ? (
          <div className="router-form-result">
            <span>
              Une autre installation a modifié cette politique. Choisissez explicitement la version à conserver.
            </span>
            <div className="button-row">
              <Button
                disabled={isSavingAccessPolicy}
                onClick={() => void resolveAccessPolicyConflict("remote")}
              >
                Utiliser la version VPS
              </Button>
              <Button
                disabled={isSavingAccessPolicy}
                onClick={() => void resolveAccessPolicyConflict("local")}
                variant="primary"
              >
                Conserver cette version
              </Button>
            </div>
          </div>
        ) : null}

        <div className="router-form-grid">
          <label className="form-field">
            Nom de l'équipement
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="Ex. Antenne toit nord"
              value={infrastructureDraft.name}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                name: event.target.value
              }))}
            />
          </label>
          <label className="form-field">
            Type
            <select
              disabled={!canEditSensitive || isLoading}
              value={infrastructureDraft.type}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                type: event.target.value as InfrastructureDevice["type"]
              }))}
            >
              <option value="antenna">Antenne</option>
              <option value="access_point">Point d'accès</option>
              <option value="repeater">Répéteur</option>
              <option value="other">Autre</option>
            </select>
          </label>
          <label className="form-field">
            Mode réseau
            <select
              disabled={!canEditSensitive || isLoading}
              value={infrastructureDraft.mode}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                mode: event.target.value as InfrastructureDevice["mode"]
              }))}
            >
              <option value="bridge">Bridge transparent</option>
              <option value="router_nat">Routeur / NAT — bypass interdit</option>
              <option value="unknown">Inconnu — bypass interdit</option>
            </select>
          </label>
          <label className="form-field">
            Adresse MAC
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="AA:BB:CC:DD:EE:FF"
              value={infrastructureDraft.macAddress}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                macAddress: event.target.value
              }))}
            />
          </label>
          <label className="form-field">
            Adresse IP fixe ou réservée
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="192.168.88.10"
              value={infrastructureDraft.ipAddress}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                ipAddress: event.target.value
              }))}
            />
            <small>L'adresse doit rester stable sur le MikroTik.</small>
          </label>
          <label className="toggle-option">
            <input
              checked={infrastructureDraft.internetBypass}
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => setInfrastructureDraft((current) => ({
                ...current,
                internetBypass: event.target.checked
              }))}
              type="checkbox"
            />
            <RadioTower aria-hidden="true" />
            <span>Autoriser Internet pour l'équipement</span>
          </label>
        </div>
        <div className="router-form-result">
          <span>
            Le bypass concerne uniquement l'adresse de gestion de l'antenne, jamais les clients situés derrière.
          </span>
          <Button
            disabled={!canEditSensitive || isLoading}
            icon={Plus}
            onClick={addInfrastructureDevice}
          >
            Ajouter
          </Button>
        </div>

        {accessPolicy.infrastructureDevices.length > 0 ? (
          <div className="data-list">
            {accessPolicy.infrastructureDevices.map((device) => (
              <DataListItem
                description={`${device.ipAddress} · ${device.macAddress} · ${
                  device.mode === "bridge" ? "Bridge transparent" : "Non bridge"
                }`}
                icon={RadioTower}
                key={device.id}
                meta={(
                  <Button
                    disabled={!canEditSensitive || isSavingAccessPolicy}
                    icon={Trash2}
                    onClick={() => removeInfrastructureDevice(device.id)}
                    variant="ghost"
                  >
                    Retirer
                  </Button>
                )}
                title={`${device.name}${device.internetBypass ? " · bypass Internet" : ""}`}
              />
            ))}
          </div>
        ) : (
          <StatusDot label="Aucun équipement d'infrastructure déclaré." status="warning" />
        )}

        <div className="router-form-result">
          <span>Les modifications ne prennent effet qu'après synchronisation.</span>
          <Button
            disabled={!canEditSensitive || isLoading || isSavingAccessPolicy || !router}
            icon={Save}
            onClick={() => void saveAccessPolicy()}
            variant="primary"
          >
            {isSavingAccessPolicy ? "Synchronisation…" : "Enregistrer et appliquer"}
          </Button>
        </div>
      </Card>

      {!isPersistent ? (
        <Card>
          <StatusDot label="La persistance native est indisponible dans ce mode." status="warning" />
        </Card>
      ) : null}
    </div>
  );
}

function hasUnsavedConnectionChanges(router: RouterRecord, settings: RouterSettings): boolean {
  return router.local_ip !== settings.ipAddress.trim()
    || router.api_port !== Number(settings.apiPort)
    || router.api_ssl_port !== Number(settings.apiSslPort)
    || router.username !== settings.username.trim()
    || router.connection_mode !== settings.connectionMode
    || settings.password.trim().length > 0;
}

function accessPolicySyncLabel(status: RouterAccessPolicySyncStatus): string {
  const labels: Record<RouterAccessPolicySyncStatus, string> = {
    conflict: "Conflit entre deux installations",
    offline: "VPS momentanément inaccessible",
    pending: "Synchronisation VPS en attente",
    synced: "Synchronisé avec le VPS"
  };
  return labels[status];
}
