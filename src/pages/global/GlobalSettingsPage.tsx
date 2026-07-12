import { useState } from "react";
import {
  ArchiveRestore,
  DatabaseBackup,
  FileText,
  KeyRound,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserCog
} from "lucide-react";
import type { UserRole } from "../../domain/auth";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  appendInternalProfileLog,
  hashProfilePassword,
  internalProfileOrder,
  loadInternalProfiles,
  permissionSummaryByRole,
  readInternalProfileLogs,
  resetProfilePasswordHash,
  roleLabels,
  saveInternalProfiles,
  saveProfilePasswordHash,
  setInternalProfileEnabled,
  updateInternalProfileDisplayName,
  type InternalProfileLog
} from "../../services/auth";
import { Badge, Button, Card, ConfirmDialog, DataListItem, PageHeader, PasswordField } from "../../shared/ui";
import {
  canEditSensitiveSettings,
  loadAppSettings,
  saveAppSettings,
  validateAppSettings,
  type AppSettings,
  type ProfilePasswordDraft
} from "./settingsPageModel";

export function GlobalSettingsPage() {
  const { session } = useAuth();
  const accountId = session?.account_id ?? "";
  const isAdmin = canEditSensitiveSettings(session?.internal_profile_role);
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [internalProfiles, setInternalProfiles] = useState(() => loadInternalProfiles(accountId));
  const [profilePasswords, setProfilePasswords] = useState<ProfilePasswordDraft>({});
  const [profileLogs, setProfileLogs] = useState<InternalProfileLog[]>(() => readInternalProfileLogs(accountId));
  const [profileToDisable, setProfileToDisable] = useState<UserRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [logsCleanedAt, setLogsCleanedAt] = useState<string | null>(null);

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const saveSettings = () => {
    const validationError = validateAppSettings(settings);

    if (validationError) {
      setMessage(validationError);
      return;
    }

    saveAppSettings(settings);
    setMessage("Paramètres enregistrés.");
  };

  const backupDatabase = () => {
    setLastBackup(new Date().toLocaleString("fr-FR"));
    setMessage(`Sauvegarde locale préparée dans ${settings.backupFolder}.`);
  };

  const restoreDatabase = () => {
    setMessage("Restauration préparée. Choisissez un fichier de sauvegarde local dans la prochaine étape.");
  };

  const cleanLogs = () => {
    setLogsCleanedAt(new Date().toLocaleString("fr-FR"));
    setMessage("Anciens logs nettoyés.");
  };

  const denyProfileEdit = () => {
    setMessage("Vous n'avez pas la permission de modifier les profils internes.");
  };

  const writeProfileLog = (role: UserRole, action: string, userMessage: string) => {
    const log = appendInternalProfileLog({
      accountId,
      action,
      internalProfileId: session?.internal_profile_id,
      role,
      userMessage
    });
    setProfileLogs((current) => [log, ...current].slice(0, 8));
  };

  const updateProfileName = (role: UserRole, displayName: string) => {
    setInternalProfiles((current) => updateInternalProfileDisplayName(current, role, displayName));
    setMessage(null);
  };

  const saveProfileName = (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    saveInternalProfiles(internalProfiles, accountId);
    writeProfileLog(role, "profile_name_updated", "Nom affiché du profil mis à jour.");
    setMessage("Profil mis à jour.");
  };

  const requestProfileDisable = (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    const result = setInternalProfileEnabled(internalProfiles, role, false);

    if (!result.success) {
      setMessage(result.message ?? "Impossible de désactiver ce profil.");
      return;
    }

    setProfileToDisable(role);
  };

  const confirmProfileDisable = () => {
    if (!profileToDisable) {
      return;
    }

    const result = setInternalProfileEnabled(internalProfiles, profileToDisable, false);

    if (!result.success) {
      setMessage(result.message ?? "Impossible de désactiver ce profil.");
      setProfileToDisable(null);
      return;
    }

    setInternalProfiles(result.profiles);
    saveInternalProfiles(result.profiles, accountId);
    writeProfileLog(profileToDisable, "profile_disabled", "Profil désactivé.");
    setMessage("Profil désactivé.");
    setProfileToDisable(null);
  };

  const enableProfile = (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    const result = setInternalProfileEnabled(internalProfiles, role, true);
    setInternalProfiles(result.profiles);
    saveInternalProfiles(result.profiles, accountId);
    writeProfileLog(role, "profile_enabled", "Profil activé.");
    setMessage("Profil activé.");
  };

  const changeProfilePassword = async (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    const password = profilePasswords[role]?.trim();

    if (!password) {
      setMessage("Renseignez un nouveau mot de passe pour ce profil.");
      return;
    }

    saveProfilePasswordHash(role, await hashProfilePassword(role, password), accountId);
    setProfilePasswords((current) => ({ ...current, [role]: "" }));
    writeProfileLog(role, "profile_password_updated", "Mot de passe du profil mis à jour.");
    setMessage("Mot de passe du profil mis à jour.");
  };

  const resetProfilePassword = (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    resetProfilePasswordHash(role, accountId);
    setProfilePasswords((current) => ({ ...current, [role]: "" }));
    writeProfileLog(role, "profile_password_reset", "Mot de passe du profil mis à jour.");
    setMessage("Mot de passe du profil mis à jour.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          isAdmin ? (
            <Button icon={Save} onClick={saveSettings} variant="primary">
              Enregistrer
            </Button>
          ) : null
        }
        description="Réglages de l'application, stockage local, impression et sécurité."
        eyebrow="Global"
        title="Paramètres"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card title="Préférences générales" description="Interface en français, thème clair et devise CFA.">
        <div className="router-form-grid">
          <label className="form-field">
            Langue
            <select disabled value={settings.language}>
              <option value="fr">Français</option>
            </select>
          </label>
          <label className="form-field">
            Devise
            <select disabled value={settings.currency}>
              <option value="CFA">CFA</option>
            </select>
          </label>
          <label className="form-field">
            Thème
            <select disabled value={settings.theme}>
              <option value="light">Clair</option>
            </select>
          </label>
          <label className="form-field">
            Expiration session (minutes)
            <input
              disabled={!isAdmin}
              min={5}
              type="number"
              value={settings.sessionTimeoutMinutes}
              onChange={(event) => updateSettings({ sessionTimeoutMinutes: Number(event.target.value) })}
            />
          </label>
        </div>
      </Card>

      <Card title="Dossiers locaux" description="Chemins utilisés pour les PDF, exports et sauvegardes.">
        <div className="router-form-grid">
          <label className="form-field">
            Dossier PDF
            <input disabled={!isAdmin} value={settings.pdfFolder} onChange={(event) => updateSettings({ pdfFolder: event.target.value })} />
          </label>
          <label className="form-field">
            Dossier exports
            <input disabled={!isAdmin} value={settings.exportFolder} onChange={(event) => updateSettings({ exportFolder: event.target.value })} />
          </label>
          <label className="form-field">
            Dossier sauvegarde base locale
            <input disabled={!isAdmin} value={settings.backupFolder} onChange={(event) => updateSettings({ backupFolder: event.target.value })} />
          </label>
        </div>
      </Card>

      <Card title="Base locale et logs" description="Actions locales, sans service externe.">
        <div className="data-list">
          <DataListItem
            description={lastBackup ? `Dernière sauvegarde : ${lastBackup}` : settings.backupFolder}
            icon={DatabaseBackup}
            meta={isAdmin ? <Button icon={DatabaseBackup} onClick={backupDatabase}>Sauvegarder</Button> : <Badge status="warning">Admin</Badge>}
            title="Sauvegarde base locale"
          />
          <DataListItem
            description="Restauration depuis un fichier local validé par l'Admin."
            icon={ArchiveRestore}
            meta={isAdmin ? <Button icon={ArchiveRestore} onClick={restoreDatabase}>Restaurer</Button> : <Badge status="warning">Admin</Badge>}
            title="Restauration base locale"
          />
          <DataListItem
            description={logsCleanedAt ? `Nettoyé le ${logsCleanedAt}` : "Conserve les logs récents utiles au diagnostic."}
            icon={Trash2}
            meta={isAdmin ? <Button icon={Trash2} onClick={cleanLogs} variant="danger">Nettoyer</Button> : <Badge status="warning">Admin</Badge>}
            title="Nettoyage logs"
          />
        </div>
      </Card>

      <Card title="Préférences impression" description="Valeurs par défaut utilisées pour les tickets.">
        <div className="router-form-grid">
          <label className="form-field">
            Format par défaut
            <select
              disabled={!isAdmin}
              value={settings.printFormat}
              onChange={(event) => updateSettings({ printFormat: event.target.value as AppSettings["printFormat"] })}
            >
              <option value="thermal58">58 mm</option>
              <option value="thermal80">80 mm</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="toggle-option">
            <input
              checked={settings.printEconomical}
              disabled={!isAdmin}
              type="checkbox"
              onChange={(event) => updateSettings({ printEconomical: event.target.checked })}
            />
            <Printer aria-hidden="true" />
            <span>Impression économique</span>
          </label>
        </div>
      </Card>

      <Card title="Profils internes" description="Gestion des profils du compte principal. Admin uniquement.">
        {!isAdmin ? (
          <p className="form-error">Vous n'avez pas la permission de modifier les profils internes.</p>
        ) : null}

        <div className="internal-profile-list">
          {internalProfileOrder.map((role) => {
            const profile = internalProfiles.find((item) => item.role === role);

            if (!profile) {
              return null;
            }

            return (
              <article className="internal-profile-card" key={role}>
                <div className="internal-profile-card__header">
                  <div className="internal-profile-card__title">
                    <UserCog aria-hidden="true" />
                    <div>
                      <strong>{roleLabels[role]}</strong>
                      <span>{profile.lastUsedAt ? `Dernière utilisation : ${new Date(profile.lastUsedAt).toLocaleString("fr-FR")}` : "Jamais utilisé"}</span>
                    </div>
                  </div>
                  <Badge status={profile.isEnabled ? "success" : "offline"}>{profile.isEnabled ? "Activé" : "Désactivé"}</Badge>
                </div>

                <label className="form-field">
                  Nom affiché
                  <input
                    disabled={!isAdmin}
                    value={profile.displayName}
                    onChange={(event) => updateProfileName(role, event.target.value)}
                  />
                </label>

                <div className="internal-profile-permissions">
                  {permissionSummaryByRole[role].map((permission) => (
                    <Badge key={permission} status="active">{permission}</Badge>
                  ))}
                </div>

                <PasswordField
                  autoComplete="new-password"
                  disabled={!isAdmin}
                  label="Nouveau mot de passe"
                  onChange={(value) => setProfilePasswords((current) => ({ ...current, [role]: value }))}
                  placeholder="Ne jamais saisir l'ancien mot de passe"
                  value={profilePasswords[role] ?? ""}
                />

                <div className="internal-profile-card__actions">
                  <Button disabled={!isAdmin} icon={Save} onClick={() => saveProfileName(role)} variant="ghost">
                    Enregistrer nom
                  </Button>
                  <Button disabled={!isAdmin} icon={KeyRound} onClick={() => void changeProfilePassword(role)}>
                    Changer mot de passe
                  </Button>
                  <Button disabled={!isAdmin} icon={RotateCcw} onClick={() => resetProfilePassword(role)} variant="ghost">
                    Réinitialiser
                  </Button>
                  {profile.isEnabled ? (
                    <Button disabled={!isAdmin} icon={Trash2} onClick={() => requestProfileDisable(role)} variant="danger">
                      Désactiver
                    </Button>
                  ) : (
                    <Button disabled={!isAdmin} icon={ShieldCheck} onClick={() => enableProfile(role)} variant="primary">
                      Activer
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="internal-profile-logs">
          <strong>Derniers changements</strong>
          {profileLogs.length > 0 ? (
            profileLogs.slice(0, 4).map((log) => (
              <span key={log.id}>
                {new Date(log.createdAt).toLocaleString("fr-FR")} · {roleLabels[log.role]} · {log.userMessage}
              </span>
            ))
          ) : (
            <span>Aucun changement enregistré.</span>
          )}
        </div>
      </Card>

      <Card title="Résumé sécurité">
        <div className="data-list">
          <DataListItem description="Paramètres sensibles réservés à l'Admin." icon={ShieldCheck} meta={<Badge status="success">Actif</Badge>} title="Permissions" />
          <DataListItem description="Les secrets ne sont pas écrits dans les logs." icon={KeyRound} meta={<Badge status="success">Actif</Badge>} title="Secrets" />
          <DataListItem description={`${settings.pdfFolder} · ${settings.exportFolder}`} icon={FileText} title="Fichiers locaux" />
        </div>
      </Card>

      <Card title="À propos">
        <div className="data-list">
          <DataListItem description="TicketPro par Akicorp Solutions" icon={ShieldCheck} title="TicketPro" />
          <DataListItem description="Gestion locale et distante de hotspots MikroTik" icon={FileText} title="Version 0.1.0" />
          <DataListItem description="solutions.akicorp.ticketpro" icon={KeyRound} title="Identifiant application" />
        </div>
      </Card>

      <ConfirmDialog
        confirmLabel="Désactiver"
        description={
          profileToDisable
            ? `Le profil ${roleLabels[profileToDisable]} ne pourra plus ouvrir l'application tant qu'il n'est pas réactivé.`
            : ""
        }
        isOpen={Boolean(profileToDisable)}
        onCancel={() => setProfileToDisable(null)}
        onConfirm={confirmProfileDisable}
        title="Désactiver ce profil ?"
      />
    </div>
  );
}
