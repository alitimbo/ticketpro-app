import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ArchiveRestore,
  Clock3,
  DatabaseBackup,
  Download,
  FileText,
  Info,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserCircle
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  AppSettingsRepository,
  DatabaseBackupService,
  useAppDatabase,
  type DatabaseBackup as DatabaseBackupRecord
} from "../../services/database";
import {
  allowedLogRetentionDays,
  AuditLogService,
  LogRetentionService
} from "../../services/logging";
import {
  appUpdatesAreSupported,
  checkForAppUpdate,
  describeAppUpdateError,
  getAppMetadata,
  installAvailableAppUpdate,
  type AppMetadata,
  type AppUpdate
} from "../../services/app";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataListItem,
  PageHeader,
  StatusDot
} from "../../shared/ui";
import {
  canEditSensitiveSettings,
  loadAppSettings,
  saveAppSettings,
  validateAppSettings,
  type AppSettings
} from "./settingsPageModel";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

const fallbackMetadata: AppMetadata = {
  identifier: "solutions.akicorp.ticketpro",
  name: "TicketPro",
  version: "—"
};

export function GlobalSettingsPage() {
  const location = useLocation();
  const { saasAccount, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const accountId = session?.account_id ?? "";
  const isAdmin = canEditSensitiveSettings(session?.internal_profile_role);
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [backups, setBackups] = useState<DatabaseBackupRecord[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [lastBackup, setLastBackup] = useState<DatabaseBackupRecord | null>(null);
  const [restoreConfirmationOpen, setRestoreConfirmationOpen] = useState(false);
  const [cleanupConfirmationOpen, setCleanupConfirmationOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [eligibleLogCount, setEligibleLogCount] = useState(0);
  const [logsCleanedAt, setLogsCleanedAt] = useState<string | null>(null);
  const [appMetadata, setAppMetadata] = useState<AppMetadata>(fallbackMetadata);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const [updateBusy, setUpdateBusy] = useState<"checking" | "installing" | null>(null);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const updateSectionRef = useRef<HTMLDivElement>(null);
  const appSettingsRepository = useMemo(
    () => new AppSettingsRepository(database),
    [database]
  );
  const databaseBackupService = useMemo(() => new DatabaseBackupService(), []);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const logRetentionService = useMemo(
    () => new LogRetentionService(database),
    [database]
  );

  useEffect(() => {
    let mounted = true;
    void getAppMetadata().then((metadata) => {
      if (mounted) setAppMetadata(metadata);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (location.hash !== "#mise-a-jour") return;

    const animationFrame = window.requestAnimationFrame(() => {
      const section = updateSectionRef.current;
      if (!section) return;
      section.scrollIntoView({ behavior: "smooth", block: "center" });
      section.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [location.hash, location.key]);

  useEffect(() => {
    if (!isPersistent || !isInitialized) return;
    let mounted = true;
    void Promise.all([
      appSettingsRepository.get("app_settings"),
      databaseBackupService.list(),
      accountId ? logRetentionService.getPolicy(accountId) : null
    ]).then(([storedSettings, storedBackups, logPolicy]) => {
      if (!mounted) return;
      if (storedSettings) {
        try {
          setSettings({ ...loadAppSettings(), ...JSON.parse(storedSettings) });
        } catch {
          // Les valeurs locales sûres restent utilisées.
        }
      }
      setBackups(storedBackups);
      setSelectedBackup((current) => current || storedBackups[0]?.file_name || "");
      if (logPolicy) {
        setRetentionDays(logPolicy.days);
        setLogsCleanedAt(
          logPolicy.lastCleanupAt
            ? new Date(logPolicy.lastCleanupAt).toLocaleString("fr-FR")
            : null
        );
        void logRetentionService
          .countEligible(accountId, logPolicy.days)
          .then((count) => {
            if (mounted) setEligibleLogCount(count);
          });
      }
    }).catch((error) => {
      if (!mounted) return;
      setFeedback({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Impossible de charger les paramètres locaux."
      });
    });
    return () => {
      mounted = false;
    };
  }, [
    accountId,
    appSettingsRepository,
    databaseBackupService,
    isInitialized,
    isPersistent,
    logRetentionService
  ]);

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    setFeedback(null);
  };

  const saveSessionSettings = async () => {
    const validationError = validateAppSettings(settings);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }
    try {
      saveAppSettings(settings);
      if (isPersistent) {
        await appSettingsRepository.set("app_settings", JSON.stringify(settings));
        if (accountId) {
          await auditLogService.write({
            accountId,
            action: "settings.session_updated",
            category: "systeme",
            internalProfileId: session?.internal_profile_id ?? null,
            internalProfileRole: session?.internal_profile_role ?? null,
            message: "Durée de session mise à jour."
          });
        }
      }
      setFeedback({
        kind: "success",
        text: "Durée de session enregistrée. Elle s'appliquera aux prochaines sessions."
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Enregistrement impossible."
      });
    }
  };

  const backupDatabase = async () => {
    if (!isPersistent) {
      setFeedback({
        kind: "error",
        text: "La sauvegarde SQLite est disponible uniquement dans l'application desktop."
      });
      return;
    }
    try {
      const fileName = `ticketpro-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
      const backup = await databaseBackupService.backup(fileName);
      const availableBackups = await databaseBackupService.list();
      setBackups(availableBackups);
      setSelectedBackup(backup.file_name);
      setLastBackup(backup);
      setFeedback({
        kind: "success",
        text: `Sauvegarde créée et vérifiée : ${backup.file_name}.`
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "La sauvegarde a échoué."
      });
    }
  };

  const restoreDatabase = async () => {
    const backupName = selectedBackup || backups[0]?.file_name;
    if (!backupName) {
      setFeedback({ kind: "error", text: "Aucune sauvegarde disponible." });
      setRestoreConfirmationOpen(false);
      return;
    }
    try {
      await databaseBackupService.restore(backupName);
      setFeedback({
        kind: "success",
        text: "Base restaurée. Rechargement de l'application…"
      });
      setRestoreConfirmationOpen(false);
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setRestoreConfirmationOpen(false);
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "La restauration a échoué."
      });
    }
  };

  const changeRetentionDays = async (days: number) => {
    setRetentionDays(days);
    setFeedback(null);
    if (!isPersistent || !accountId) return;
    try {
      const savedDays = await logRetentionService.setRetentionDays(accountId, days);
      setRetentionDays(savedDays);
      setEligibleLogCount(
        await logRetentionService.countEligible(accountId, savedDays)
      );
      setFeedback({
        kind: "success",
        text: `Conservation automatique réglée sur ${savedDays} jours.`
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Réglage des logs impossible."
      });
    }
  };

  const cleanLogs = async () => {
    if (!isPersistent || !accountId) {
      setCleanupConfirmationOpen(false);
      setFeedback({
        kind: "error",
        text: "Le nettoyage des logs exige la base locale desktop."
      });
      return;
    }
    try {
      const result = await logRetentionService.cleanNow(accountId, retentionDays);
      setLogsCleanedAt(new Date(result.runAt).toLocaleString("fr-FR"));
      setEligibleLogCount(0);
      setCleanupConfirmationOpen(false);
      setFeedback({
        kind: "success",
        text: `${result.removedCount} ancien(s) log(s) supprimé(s).`
      });
    } catch (error) {
      setCleanupConfirmationOpen(false);
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Nettoyage impossible."
      });
    }
  };

  const checkUpdates = async () => {
    if (!appUpdatesAreSupported()) {
      setFeedback({
        kind: "error",
        text: "Le contrôle des mises à jour est disponible uniquement dans TicketPro Desktop."
      });
      return;
    }
    setUpdateBusy("checking");
    setFeedback(null);
    try {
      const update = await checkForAppUpdate(true);
      setAvailableUpdate(update);
      setUpdateChecked(true);
      setFeedback({
        kind: "success",
        text: update
          ? `La version ${update.version} est prête à être installée.`
          : `TicketPro ${appMetadata.version} est à jour.`
      });
    } catch (error) {
      setFeedback({ kind: "error", text: describeAppUpdateError(error) });
    } finally {
      setUpdateBusy(null);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy("installing");
    setUpdateProgress(0);
    setFeedback({
      kind: "success",
      text: "Création de la sauvegarde locale avant téléchargement…"
    });
    try {
      await installAvailableAppUpdate((progress) => {
        setUpdateProgress(progress.percent);
        setFeedback({
          kind: "success",
          text: progress.percent === null
            ? "Téléchargement sécurisé de la mise à jour…"
            : `Téléchargement de la mise à jour : ${progress.percent} %.`
        });
      });
    } catch (error) {
      setFeedback({ kind: "error", text: describeAppUpdateError(error) });
      setUpdateBusy(null);
    }
  };

  const selectedBackupRecord = backups.find(
    (backup) => backup.file_name === selectedBackup
  );

  return (
    <div className="page-stack">
      <PageHeader
        description="Session, sauvegardes locales, entretien des logs et informations de l'application."
        eyebrow="Global"
        title="Paramètres"
      />

      {feedback ? (
        <p className={`form-error${feedback.kind === "success" ? " form-error--success" : ""}`}>
          {feedback.text}
        </p>
      ) : null}

      <Card
        title="Compte et session"
        description="La durée choisie protège une session inactive sur ce PC."
      >
        <div className="router-form-grid">
          <label className="form-field">
            Expiration après inactivité
            <select
              disabled={!isAdmin}
              value={settings.sessionTimeoutMinutes}
              onChange={(event) => updateSettings({
                sessionTimeoutMinutes: Number(event.target.value)
              })}
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 heure</option>
              <option value={120}>2 heures</option>
              <option value={240}>4 heures</option>
              <option value={480}>8 heures</option>
            </select>
          </label>
        </div>
        <div className="data-list">
          <DataListItem
            description={saasAccount?.organization.name ?? "Organisation locale"}
            icon={UserCircle}
            title="Organisation"
          />
          <DataListItem
            description={session?.account_email || "Non renseigné"}
            icon={UserCircle}
            title="Compte connecté"
          />
          <DataListItem
            description={session?.internal_profile_label ?? "Profil inconnu"}
            icon={ShieldCheck}
            meta={<Badge status="active">{session?.internal_profile_role ?? "—"}</Badge>}
            title="Rôle actif"
          />
        </div>
        {isAdmin ? (
          <div className="router-form-result">
            <span>La session actuelle n'est pas interrompue lors de cette modification.</span>
            <Button
              icon={Save}
              onClick={() => void saveSessionSettings()}
              variant="primary"
            >
              Enregistrer la session
            </Button>
          </div>
        ) : null}
      </Card>

      <Card
        title="Sauvegardes locales"
        description="Snapshots complets de la base SQLite de cette installation."
      >
        {isPersistent ? (
          <>
            <div className="router-form-grid">
              <label className="form-field">
                Sauvegarde disponible
                <select
                  value={selectedBackup}
                  onChange={(event) => setSelectedBackup(event.target.value)}
                >
                  <option value="">Sélectionner une sauvegarde</option>
                  {backups.map((backup) => (
                    <option key={backup.file_name} value={backup.file_name}>
                      {backup.file_name} ({Math.ceil(backup.size_bytes / 1024)} Ko)
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="data-list">
              <DataListItem
                description={
                  lastBackup?.absolute_path ??
                  selectedBackupRecord?.absolute_path ??
                  "Aucune sauvegarde créée"
                }
                icon={DatabaseBackup}
                meta={isAdmin ? (
                  <Button
                    icon={DatabaseBackup}
                    onClick={() => void backupDatabase()}
                    variant="primary"
                  >
                    Sauvegarder
                  </Button>
                ) : <Badge status="warning">Admin</Badge>}
                title="Créer un backup"
              />
              <DataListItem
                description={
                  selectedBackupRecord
                    ? `${selectedBackupRecord.file_name} · ${Math.ceil(selectedBackupRecord.size_bytes / 1024)} Ko`
                    : "Sélectionnez d'abord une sauvegarde"
                }
                icon={ArchiveRestore}
                meta={isAdmin ? (
                  <Button
                    disabled={!selectedBackupRecord}
                    icon={ArchiveRestore}
                    onClick={() => setRestoreConfirmationOpen(true)}
                  >
                    Restaurer
                  </Button>
                ) : <Badge status="warning">Admin</Badge>}
                title="Restaurer la base"
              />
            </div>
          </>
        ) : (
          <StatusDot
            label="Sauvegardes indisponibles dans le navigateur. Lancez TicketPro Desktop."
            status="warning"
          />
        )}
      </Card>

      <Card
        title="Nettoyage des logs"
        description="Le nettoyage automatique conserve uniquement la durée choisie."
      >
        <div className="router-form-grid">
          <label className="form-field">
            Durée de conservation
            <select
              disabled={!isAdmin || !isPersistent}
              value={retentionDays}
              onChange={(event) => void changeRetentionDays(Number(event.target.value))}
            >
              {allowedLogRetentionDays.map((days) => (
                <option key={days} value={days}>{days} jours</option>
              ))}
            </select>
          </label>
        </div>
        <div className="data-list">
          <DataListItem
            description={
              logsCleanedAt
                ? `Dernier nettoyage : ${logsCleanedAt}`
                : "Aucun nettoyage enregistré"
            }
            icon={Clock3}
            meta={<Badge status={isPersistent ? "success" : "warning"}>
              {isPersistent ? "Automatique actif" : "Desktop requis"}
            </Badge>}
            title={`Conservation : ${retentionDays} jours`}
          />
          <DataListItem
            description={`${eligibleLogCount} log(s) actuellement éligible(s) à la suppression.`}
            icon={Trash2}
            meta={isAdmin ? (
              <Button
                disabled={!isPersistent}
                icon={Trash2}
                onClick={() => setCleanupConfirmationOpen(true)}
                variant="danger"
              >
                Nettoyer maintenant
              </Button>
            ) : <Badge status="warning">Admin</Badge>}
            title="Nettoyage manuel"
          />
        </div>
      </Card>

      <Card title="Application">
        <div className="data-list">
          <DataListItem
            description="Akicorp Solutions"
            icon={ShieldCheck}
            title={appMetadata.name}
          />
          <DataListItem
            description="Lue automatiquement depuis le paquet installé."
            icon={Info}
            meta={<Badge status="success">Automatique</Badge>}
            title={`Version ${appMetadata.version}`}
          />
          <DataListItem
            description={appMetadata.identifier}
            icon={FileText}
            title="Identifiant application"
          />
        </div>
      </Card>

      <div
        className="settings-update-section"
        id="mise-a-jour"
        ref={updateSectionRef}
        tabIndex={-1}
      >
        <Card
          title="Mise à jour de TicketPro"
          description="Contrôle signé, sauvegarde automatique de la base locale, puis installation silencieuse."
        >
          <div className="data-list">
            <DataListItem
              description={
                availableUpdate
                  ? `Version installée ${availableUpdate.currentVersion} · nouvelle version ${availableUpdate.version}`
                  : updateChecked
                    ? `Aucune version plus récente que ${appMetadata.version}.`
                    : "Le contrôle automatique s'effectue au démarrage. Vous pouvez aussi le lancer maintenant."
              }
              icon={RefreshCw}
              meta={(
                <Button
                  disabled={updateBusy !== null || !isAdmin}
                  icon={RefreshCw}
                  onClick={() => void checkUpdates()}
                >
                  {updateBusy === "checking" ? "Vérification…" : "Rechercher"}
                </Button>
              )}
              title={availableUpdate ? "Mise à jour disponible" : "État des mises à jour"}
            />
            {availableUpdate ? (
              <DataListItem
                description={
                  availableUpdate.notes?.trim()
                    || "Cette version contient des améliorations de stabilité et de sécurité."
                }
                icon={Download}
                meta={(
                  <Button
                    disabled={updateBusy !== null || !isAdmin}
                    icon={Download}
                    onClick={() => void installUpdate()}
                    variant="primary"
                  >
                    {updateBusy === "installing" ? "Installation…" : "Sauvegarder et installer"}
                  </Button>
                )}
                title={`Installer TicketPro ${availableUpdate.version}`}
              />
            ) : null}
          </div>
          {updateBusy === "installing" ? (
            <div className="app-update-progress" aria-live="polite">
              <div
                className="app-update-progress__bar"
                style={{ width: `${updateProgress ?? 12}%` }}
              />
              <span>
                {updateProgress === null
                  ? "Téléchargement en cours…"
                  : `${updateProgress} % téléchargés`}
              </span>
            </div>
          ) : null}
          {!isAdmin ? (
            <StatusDot
              label="Seul un administrateur peut installer une mise à jour sur ce poste."
              status="warning"
            />
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        confirmLabel="Restaurer"
        description={`La base actuelle sera remplacée par ${selectedBackupRecord?.file_name ?? "la sauvegarde sélectionnée"}. L'application sera ensuite rechargée.`}
        isOpen={restoreConfirmationOpen}
        onCancel={() => setRestoreConfirmationOpen(false)}
        onConfirm={() => void restoreDatabase()}
        title="Restaurer cette sauvegarde ?"
      />

      <ConfirmDialog
        confirmLabel="Supprimer"
        description={`${eligibleLogCount} log(s) antérieur(s) à ${retentionDays} jours seront définitivement supprimés.`}
        isOpen={cleanupConfirmationOpen}
        onCancel={() => setCleanupConfirmationOpen(false)}
        onConfirm={() => void cleanLogs()}
        title="Nettoyer les anciens logs ?"
      />
    </div>
  );
}
