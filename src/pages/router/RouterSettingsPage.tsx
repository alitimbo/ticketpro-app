import { useMemo, useState } from "react";
import { KeyRound, Link, Phone, Printer, Router, Save, Search, ShieldCheck, Ticket } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { encryptLocalSecret } from "../../services/security/localSecrets";
import { FakeRouterAdapter, RouterService, RouterServiceError } from "../../services/router";
import { Badge, Button, Card, DataListItem, PageHeader, PasswordField, StatusDot } from "../../shared/ui";
import {
  canEditRouterSensitiveSettings,
  canViewRouterSettings,
  loadRouterSettings,
  saveRouterSettings,
  validateRouterSettings,
  type RouterSettings
} from "./routerSettingsPageModel";

export function RouterSettingsPage() {
  const { session } = useAuth();
  const canView = canViewRouterSettings(session?.internal_profile_role);
  const canEditSensitive = canEditRouterSensitiveSettings(session?.internal_profile_role);
  const [settings, setSettings] = useState<RouterSettings>(() => loadRouterSettings());
  const [message, setMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("Non testé");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const service = useMemo(
    () =>
      new RouterService({
        adapter: new FakeRouterAdapter({
          connectionMode: settings.connectionMode,
          host: settings.ipAddress,
          latencyMs: 0
        })
      }),
    [settings.connectionMode, settings.ipAddress]
  );

  const updateSettings = (partial: Partial<RouterSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const saveSettings = async () => {
    if (!canEditSensitive) {
      setMessage("Seul l'Admin peut modifier ces paramètres.");
      return;
    }

    const validationError = validateRouterSettings(settings);

    if (validationError) {
      setMessage(validationError);
      return;
    }

    if (settings.password.trim()) {
      await encryptLocalSecret(settings.password);
      setPasswordChanged(true);
      setSettings((current) => ({ ...current, password: "" }));
    }

    saveRouterSettings(settings);
    setMessage("Paramètres routeur enregistrés.");
  };

  const testConnection = async () => {
    try {
      await service.testConnection();
      setTestMessage("Routeur connecté");
      setMessage("Connexion réussie.");
    } catch (error) {
      setTestMessage(error instanceof RouterServiceError ? error.message : "Test impossible.");
      setMessage("Le test de connexion a échoué.");
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
        actions={
          canEditSensitive ? (
            <Button icon={Save} onClick={() => void saveSettings()} variant="primary">
              Enregistrer
            </Button>
          ) : null
        }
        description="Configuration du routeur, impression et affichage des tickets."
        eyebrow="Routeur"
        title="Paramètres routeur"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card title="Connexion routeur" description="Informations utilisées pour joindre le routeur.">
        <div className="router-form-grid">
          <label className="form-field">
            Nom routeur
            <input disabled={!canEditSensitive} value={settings.name} onChange={(event) => updateSettings({ name: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse IP
            <input disabled={!canEditSensitive} value={settings.ipAddress} onChange={(event) => updateSettings({ ipAddress: event.target.value })} />
          </label>
          <label className="form-field">
            Port API
            <input disabled={!canEditSensitive} value={settings.apiPort} onChange={(event) => updateSettings({ apiPort: event.target.value })} />
          </label>
          <label className="form-field">
            Port API SSL
            <input disabled={!canEditSensitive} value={settings.apiSslPort} onChange={(event) => updateSettings({ apiSslPort: event.target.value })} />
          </label>
          <label className="form-field">
            Mode connexion
            <select
              disabled={!canEditSensitive}
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
            <input disabled={!canEditSensitive} value={settings.username} onChange={(event) => updateSettings({ username: event.target.value })} />
          </label>
          <PasswordField
            autoComplete="new-password"
            disabled={!canEditSensitive}
            label="Mot de passe MikroTik"
            onChange={(password) => updateSettings({ password })}
            placeholder={passwordChanged ? "Mot de passe mis à jour" : "Laisser vide pour conserver"}
            value={settings.password}
          />
        </div>
        <div className="router-form-result">
          <Badge status={testMessage === "Routeur connecté" ? "success" : "warning"}>{testMessage}</Badge>
          <Button disabled={!canEditSensitive} icon={Search} onClick={() => void testConnection()}>
            Tester connexion
          </Button>
        </div>
      </Card>

      <Card title="Tickets et impression" description="Réglages visibles sur les tickets et valeurs par défaut.">
        <div className="router-form-grid">
          <label className="form-field">
            Plan par défaut
            <select disabled={!canEditSensitive} value={settings.defaultPlanId} onChange={(event) => updateSettings({ defaultPlanId: event.target.value })}>
              <option value="plan-1h">1h</option>
              <option value="plan-3h">3h-2Go</option>
              <option value="plan-jour">Journée</option>
            </select>
          </label>
          <label className="form-field">
            Imprimante par défaut
            <select disabled={!canEditSensitive} value={settings.printerId} onChange={(event) => updateSettings({ printerId: event.target.value })}>
              <option value="pdf-export">Export PDF</option>
              <option value="thermal-80-demo">Thermique 80 mm</option>
              <option value="thermal-58-demo">Thermique 58 mm</option>
            </select>
          </label>
          <label className="form-field">
            Téléphone support
            <input disabled={!canEditSensitive} value={settings.supportPhone} onChange={(event) => updateSettings({ supportPhone: event.target.value })} />
          </label>
          <label className="form-field">
            Nom affiché sur les tickets
            <input
              disabled={!canEditSensitive}
              value={settings.displayNameOnTickets}
              onChange={(event) => updateSettings({ displayNameOnTickets: event.target.value })}
            />
          </label>
        </div>
      </Card>

      <Card title="Résumé">
        <div className="data-list">
          <DataListItem description={`${settings.ipAddress} · API ${settings.apiPort} / SSL ${settings.apiSslPort}`} icon={Router} title="Routeur" />
          <DataListItem description={settings.connectionMode} icon={Link} meta={<Badge status="active">Configuré</Badge>} title="Mode connexion" />
          <DataListItem description="Mot de passe masqué et chiffré localement lors de l'enregistrement." icon={KeyRound} meta={<Badge status="success">Protégé</Badge>} title="Secret routeur" />
          <DataListItem description={settings.displayNameOnTickets} icon={Ticket} title="Nom sur tickets" />
          <DataListItem description={settings.supportPhone} icon={Phone} title="Téléphone support" />
          <DataListItem description={settings.printerId} icon={Printer} title="Imprimante" />
          <DataListItem description={canEditSensitive ? "Modification autorisée" : "Lecture seule pour ce profil"} icon={ShieldCheck} title="Permissions" />
        </div>
      </Card>
    </div>
  );
}
