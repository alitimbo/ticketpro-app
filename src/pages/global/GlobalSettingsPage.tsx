import { useEffect, useMemo, useState } from "react";
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
  AppLogRepository,
  AppSettingsRepository,
  DatabaseBackupService,
  InternalProfileRepository,
  useAppDatabase
} from "../../services/database";
import type { DatabaseBackup as DatabaseBackupRecord } from "../../services/database";
import { AuditLogService } from "../../services/logging";
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
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const accountId = session?.account_id ?? "";
  const isAdmin = canEditSensitiveSettings(session?.internal_profile_role);
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [internalProfiles, setInternalProfiles] = useState(() => loadInternalProfiles(accountId));
  const [profilePasswords, setProfilePasswords] = useState<ProfilePasswordDraft>({});
  const [profileLogs, setProfileLogs] = useState<InternalProfileLog[]>(() => readInternalProfileLogs(accountId));
  const [profileToDisable, setProfileToDisable] = useState<UserRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backups, setBackups] = useState<DatabaseBackupRecord[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [logsCleanedAt, setLogsCleanedAt] = useState<string | null>(null);
  const appSettingsRepository = useMemo(() => new AppSettingsRepository(database), [database]);
  const databaseBackupService = useMemo(() => new DatabaseBackupService(), []);
  const internalProfileRepository = useMemo(() => new InternalProfileRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const appLogRepository = useMemo(() => new AppLogRepository(database), [database]);

  useEffect(() => {
    if (!isPersistent || !isInitialized) {
      return;
    }

    void Promise.all([appSettingsRepository.get("app_settings"), databaseBackupService.list()]).then(([storedSettings, storedBackups]) => {
      if (storedSettings) {
        try {
          setSettings({ ...loadAppSettings(), ...JSON.parse(storedSettings) });
        } catch {
          // Les réglages invalides sont remplacés par les valeurs courantes.
        }
      }
      setBackups(storedBackups);
      setSelectedBackup((current) => current || storedBackups[0]?.file_name || "");
    });
  }, [appSettingsRepository, databaseBackupService, isInitialized, isPersistent]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountId) {
      return;
    }

    void internalProfileRepository.listByAccount(accountId).then((records) => {
      if (records.length === 0) {
        return;
      }
      setInternalProfiles((current) =>
        current.map((profile) => {
          const record = records.find((item) => item.id === profile.id || item.role === profile.role);
          if (!record) {
            return profile;
          }
          let permissions = profile.permissions;
          try {
            const parsed = JSON.parse(record.permissions_json) as unknown;
            if (Array.isArray(parsed)) {
              permissions = parsed as typeof profile.permissions;
            }
          } catch {
            permissions = profile.permissions;
          }
          return {
            ...profile,
            displayName: record.display_name,
            id: record.id,
            isEnabled: record.is_enabled === 1,
            lastUsedAt: record.last_used_at,
            permissions
          };
        })
      );
    });
  }, [accountId, internalProfileRepository, isInitialized, isPersistent]);

  const persistProfile = async (profile: (typeof internalProfiles)[number], passwordHash?: string) => {
    if (!isPersistent || !accountId) {
      return;
    }
    const existing = (await internalProfileRepository.listByAccount(accountId)).find((item) => item.id === profile.id);
    if (!existing) {
      return;
    }
    await internalProfileRepository.update({
      accountId,
      displayName: profile.displayName,
      id: profile.id,
      isEnabled: profile.isEnabled ? 1 : 0,
      lastUsedAt: profile.lastUsedAt,
      passwordHash: passwordHash ?? existing.password_hash,
      permissionsJson: JSON.stringify(profile.permissions)
    });
  };

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const saveSettings = async () => {
    const validationError = validateAppSettings(settings);

    if (validationError) {
      setMessage(validationError);
      return;
    }

    saveAppSettings(settings);
    if (isPersistent) {
      await appSettingsRepository.set("app_settings", JSON.stringify(settings));
      if (accountId) {
        await auditLogService.write({
          accountId,
          action: "settings.updated",
          category: "systeme",
          internalProfileId: session?.internal_profile_id ?? null,
          internalProfileRole: session?.internal_profile_role ?? null,
          message: "Paramètres avancés mis à jour."
        });
      }
    }
    setMessage("Paramètres enregistrés.");
  };

  const backupDatabase = async () => {
    if (isPersistent) {
      const fileName = `ticketpro-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
      const backup = await databaseBackupService.backup(fileName);
      const availableBackups = await databaseBackupService.list();
      setBackups(availableBackups);
      setSelectedBackup(backup.file_name);
      setLastBackup(backup.file_name);
      setMessage(`Sauvegarde créée : ${backup.file_name}.`);
      return;
    }
    setLastBackup(new Date().toLocaleString("fr-FR"));
    setMessage(`Sauvegarde locale préparée dans ${settings.backupFolder}.`);
  };

  const restoreDatabase = async () => {
    if (isPersistent) {
      const backupName = selectedBackup || backups[0]?.file_name;
      if (!backupName) {
        setMessage("Aucune sauvegarde disponible.");
        return;
      }
      await databaseBackupService.restore(backupName);
      setMessage("Base restaurée. Rechargement de l'application...");
      window.setTimeout(() => window.location.reload(), 300);
      return;
    }
    setMessage("Restauration préparée. Choisissez un fichier de sauvegarde local dans la prochaine étape.");
  };

  const cleanLogs = async () => {
    if (isPersistent && accountId) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const removedCount = await appLogRepository.deleteBefore(accountId, cutoff.toISOString());
      setLogsCleanedAt(new Date().toLocaleString("fr-FR"));
      setMessage(`${removedCount} ancien(s) log(s) nettoyé(s) dans SQLite.`);
      return;
    }
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
    if (isPersistent && accountId) {
      void auditLogService.write({
        accountId,
        action,
        category: "systeme",
        internalProfileId: session?.internal_profile_id ?? null,
        internalProfileRole: session?.internal_profile_role ?? null,
        message: userMessage
      });
    }
  };

  const updateProfileName = (role: UserRole, displayName: string) => {
    setInternalProfiles((current) => updateInternalProfileDisplayName(current, role, displayName));
    setMessage(null);
  };

  const saveProfileName = async (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    const profile = internalProfiles.find((item) => item.role === role);
    saveInternalProfiles(internalProfiles, accountId);
    if (profile) {
      await persistProfile(profile);
    }
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

  const confirmProfileDisable = async () => {
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
    const profile = result.profiles.find((item) => item.role === profileToDisable);
    if (profile) {
      await persistProfile(profile);
    }
    writeProfileLog(profileToDisable, "profile_disabled", "Profil désactivé.");
    setMessage("Profil désactivé.");
    setProfileToDisable(null);
  };

  const enableProfile = async (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    const result = setInternalProfileEnabled(internalProfiles, role, true);
    setInternalProfiles(result.profiles);
    saveInternalProfiles(result.profiles, accountId);
    const profile = result.profiles.find((item) => item.role === role);
    if (profile) {
      await persistProfile(profile);
    }
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

    const passwordHash = await hashProfilePassword(role, password);
    saveProfilePasswordHash(role, passwordHash, accountId);
    const profile = internalProfiles.find((item) => item.role === role);
    if (profile) {
      await persistProfile(profile, passwordHash);
    }
    setProfilePasswords((current) => ({ ...current, [role]: "" }));
    writeProfileLog(role, "profile_password_updated", "Mot de passe du profil mis à jour.");
    setMessage("Mot de passe du profil mis à jour.");
  };

  const resetProfilePassword = async (role: UserRole) => {
    if (!isAdmin) {
      denyProfileEdit();
      return;
    }

    resetProfilePasswordHash(role, accountId);
    const profile = internalProfiles.find((item) => item.role === role);
    if (profile) {
      await persistProfile(profile, "");
    }
    setProfilePasswords((current) => ({ ...current, [role]: "" }));
    writeProfileLog(role, "profile_password_reset", "Mot de passe du profil mis à jour.");
    setMessage("Mot de passe du profil mis à jour.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          isAdmin ? (
            <Button icon={Save} onClick={() => void saveSettings()} variant="primary">
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
        {isPersistent ? (
          <div className="router-form-grid">
            <label className="form-field">
              Sauvegarde à restaurer
              <select value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}>
                <option value="">Sélectionner une sauvegarde</option>
                {backups.map((backup) => (
                  <option key={backup.file_name} value={backup.file_name}>
                    {backup.file_name} ({Math.ceil(backup.size_bytes / 1024)} Ko)
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="data-list">
          <DataListItem
            description={lastBackup ? `Dernière sauvegarde : ${lastBackup}` : settings.backupFolder}
            icon={DatabaseBackup}
            meta={isAdmin ? <Button icon={DatabaseBackup} onClick={() => void backupDatabase()}>Sauvegarder</Button> : <Badge status="warning">Admin</Badge>}
            title="Sauvegarde base locale"
          />
          <DataListItem
            description="Restauration depuis un fichier local validé par l'Admin."
            icon={ArchiveRestore}
            meta={isAdmin ? <Button icon={ArchiveRestore} onClick={() => void restoreDatabase()}>Restaurer</Button> : <Badge status="warning">Admin</Badge>}
            title="Restauration base locale"
          />
          <DataListItem
            description={logsCleanedAt ? `Nettoyé le ${logsCleanedAt}` : "Conserve les logs récents utiles au diagnostic."}
            icon={Trash2}
            meta={isAdmin ? <Button icon={Trash2} onClick={() => void cleanLogs()} variant="danger">Nettoyer</Button> : <Badge status="warning">Admin</Badge>}
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
                  <Button disabled={!isAdmin} icon={Save} onClick={() => void saveProfileName(role)} variant="ghost">
                    Enregistrer nom
                  </Button>
                  <Button disabled={!isAdmin} icon={KeyRound} onClick={() => void changeProfilePassword(role)}>
                    Changer mot de passe
                  </Button>
                  <Button disabled={!isAdmin} icon={RotateCcw} onClick={() => void resetProfilePassword(role)} variant="ghost">
                    Réinitialiser
                  </Button>
                  {profile.isEnabled ? (
                    <Button disabled={!isAdmin} icon={Trash2} onClick={() => requestProfileDisable(role)} variant="danger">
                      Désactiver
                    </Button>
                  ) : (
                    <Button disabled={!isAdmin} icon={ShieldCheck} onClick={() => void enableProfile(role)} variant="primary">
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
