import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Globe2, KeyRound, Link, Phone, Router, Save, Search, ShieldCheck } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { TICKETPRO_SUPPORT_PHONE } from "../../config/ticketpro";
import type { RouterRecord } from "../../domain/database";
import {
  RouterConnectionRepository,
  RouterRepository,
  useAppDatabase
} from "../../services/database";
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

export function RouterSettingsPage() {
  const { session } = useAuth();
  const { routerId = "" } = useParams();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canView = canViewRouterSettings(session?.internal_profile_role);
  const canEditSensitive = canEditRouterSensitiveSettings(session?.internal_profile_role);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const [router, setRouter] = useState<RouterRecord | null>(null);
  const [settings, setSettings] = useState<RouterSettings>(defaultRouterSettings);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testMessage, setTestMessage] = useState("Non testé");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!isInitialized || !session || !routerId) {
      return undefined;
    }

    let mounted = true;

    void routerRepository.findById(routerId).then((record) => {
      if (!mounted) return;

      if (!record || record.deleted_at || record.account_id !== session.account_id) {
        setFeedback({ kind: "error", text: "Routeur introuvable pour cette organisation." });
        setIsLoading(false);
        return;
      }

      setRouter(record);
      setSettings(routerRecordToSettings(record));
      setIsLoading(false);
    }).catch((error) => {
      if (!mounted) return;
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Impossible de charger les paramètres du routeur."
      });
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [isInitialized, routerId, routerRepository, session]);

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

      <Card title="Résumé">
        <div className="data-list">
          <DataListItem
            description={`${settings.ipAddress || "Adresse inconnue"} · API ${settings.apiPort} / SSL ${settings.apiSslPort}`}
            icon={Router}
            title={settings.name || "Routeur sans nom"}
          />
          <DataListItem description={settings.hotspotAddress || "À configurer"} icon={Globe2} title="Adresse Hotspot" />
          <DataListItem description={settings.connectionMode} icon={Link} meta={<Badge status="active">Configuré</Badge>} title="Mode connexion" />
          <DataListItem description="Mot de passe chiffré localement et jamais affiché." icon={KeyRound} meta={<Badge status="success">Protégé</Badge>} title="Secret routeur" />
          <DataListItem description={TICKETPRO_SUPPORT_PHONE} icon={Phone} title="Support TicketPro" />
          <DataListItem description={canEditSensitive ? "Modification autorisée" : "Lecture seule pour ce profil"} icon={ShieldCheck} title="Permissions" />
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
