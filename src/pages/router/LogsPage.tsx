import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  Eye,
  Filter,
  Info,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Trash2
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import { AppLogRepository, RouterRepository } from "../../services/database/repositories";
import { TauriFileService } from "../../services/files";
import {
  allowedLogRetentionDays,
  defaultLogRetentionDays,
  LogRetentionService
} from "../../services/logging";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  StatCard
} from "../../shared/ui";
import {
  appLogFromRecord,
  categoryLabel,
  createDemoLogs,
  emptyLogFilters,
  exportLogsToCsv,
  filterLogs,
  formatLogDate,
  getLogFilterOptions,
  getLogPageCount,
  levelLabel,
  levelStatus,
  logCategories,
  logLevels,
  paginateLogs,
  profileLabel,
  scopeLogsForSession,
  type AppLogEntry,
  type LogFilters
} from "./logsPageModel";

const logPageSize = 40;

type Notice = {
  status: "error" | "success";
  text: string;
} | null;

export function LogsPage() {
  const { routerId = "routeur" } = useParams();
  const { saasAccount, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [logs, setLogs] = useState<AppLogEntry[]>(() =>
    isPersistent ? [] : createDemoLogs()
  );
  const [filters, setFilters] = useState<LogFilters>(emptyLogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [cleanDialogOpen, setCleanDialogOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [retentionDays, setRetentionDays] = useState(defaultLogRetentionDays);
  const [eligibleForCleanup, setEligibleForCleanup] = useState(0);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);

  const appLogRepository = useMemo(() => new AppLogRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const fileService = useMemo(() => new TauriFileService(), []);
  const logRetentionService = useMemo(
    () => new LogRetentionService(database),
    [database]
  );

  const loadPersistedLogs = async () => {
    if (!isPersistent || !isInitialized || !session) {
      return;
    }

    setIsLoading(true);
    try {
      await logRetentionService.runAutomatic(session.account_id);
      const [records, routers, policy] = await Promise.all([
        appLogRepository.listByAccount(session.account_id),
        saasAccount?.organization.id
          ? routerRepository.listByOrganization(session.account_id, saasAccount.organization.id)
          : routerRepository.listByAccount(session.account_id),
        logRetentionService.getPolicy(session.account_id)
      ]);
      const eligible = await logRetentionService.countEligible(
        session.account_id,
        policy.days
      );
      const routerNames = new Map(routers.map((router) => [router.id, router.name]));
      const routerIds = new Set(routers.map((router) => router.id));
      setLogs(records
        .filter((record) => record.router_id !== null && routerIds.has(record.router_id))
        .map((record) => appLogFromRecord(record, routerNames)));
      setRetentionDays(policy.days);
      setEligibleForCleanup(eligible);
      setLastCleanupAt(policy.lastCleanupAt);
      setLastRefreshedAt(new Date().toISOString());
    } catch {
      setNotice({
        status: "error",
        text: "Impossible de charger les journaux locaux. Réessayez dans un instant."
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPersistedLogs();
  }, [
    appLogRepository,
    database,
    isInitialized,
    isPersistent,
    logRetentionService,
    routerRepository,
    saasAccount?.organization.id,
    session
  ]);

  const scopedLogs = useMemo(() => scopeLogsForSession(logs, session), [logs, session]);
  const filteredLogs = useMemo(
    () => filterLogs(scopedLogs, filters),
    [filters, scopedLogs]
  );
  const options = useMemo(() => getLogFilterOptions(scopedLogs), [scopedLogs]);
  const pageCount = getLogPageCount(filteredLogs.length, logPageSize);
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = useMemo(
    () => paginateLogs(filteredLogs, currentPage, logPageSize),
    [currentPage, filteredLogs]
  );
  const warningCount = scopedLogs.filter((log) => log.level === "warning").length;
  const errorCount = scopedLogs.filter(
    (log) => log.level === "error" || log.level === "critical"
  ).length;
  const infoCount = scopedLogs.filter((log) => log.level === "info").length;
  const canClean = session?.permissions.includes("router.logs.clean") ?? false;
  const activeFilterCount = Object.values(filters).filter((value) => Boolean(value)).length;

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [filters]);

  const updateFilters = (partial: Partial<LogFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setNotice(null);
  };

  const resetFilters = () => {
    setFilters(emptyLogFilters);
    setNotice(null);
  };

  const exportLogs = async () => {
    if (filteredLogs.length === 0) {
      setNotice({
        status: "error",
        text: "Aucun journal à exporter avec les filtres actuels."
      });
      return;
    }

    const csv = exportLogsToCsv(filteredLogs);
    const fileName = `logs-${routerId}-${new Date().toISOString().slice(0, 10)}.csv`;
    setIsExporting(true);
    setNotice(null);

    try {
      if (isPersistent) {
        const relativePath = `exports/logs/${fileName}`;
        await fileService.writeBytes(
          relativePath,
          new TextEncoder().encode(`\uFEFF${csv}`)
        );
        try {
          const exported = await fileService.exportToDownloads(relativePath);
          setNotice({
            status: "success",
            text: `${filteredLogs.length} journal(aux) exporté(s) dans Téléchargements/TicketPro/${exported.file_name}.`
          });
        } finally {
          await fileService.remove(relativePath).catch(() => undefined);
        }
      } else {
        downloadCsv(csv, fileName);
        setNotice({
          status: "success",
          text: `${filteredLogs.length} journal(aux) exporté(s) au format CSV.`
        });
      }
    } catch {
      setNotice({
        status: "error",
        text: "L’export CSV a échoué. Vérifiez l’accès au dossier Téléchargements."
      });
    } finally {
      setIsExporting(false);
    }
  };

  const copyTechnicalDetail = async (log: AppLogEntry) => {
    if (!log.technicalDetail) {
      setNotice({ status: "error", text: "Aucun détail technique à copier." });
      return;
    }

    try {
      await navigator.clipboard.writeText(log.technicalDetail);
      setNotice({ status: "success", text: "Détail technique copié." });
    } catch {
      setNotice({ status: "error", text: "Copie indisponible sur ce poste." });
    }
  };

  const cleanOldLogs = async () => {
    if (!canClean) {
      setNotice({
        status: "error",
        text: "Vous n’avez pas le droit de nettoyer les journaux."
      });
      setCleanDialogOpen(false);
      return;
    }

    setIsCleaning(true);
    setNotice(null);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      let removedCount = 0;

      if (isPersistent && session) {
        const result = await logRetentionService.cleanNow(
          session.account_id,
          retentionDays
        );
        removedCount = result.removedCount;
        setLastCleanupAt(result.runAt);
        setEligibleForCleanup(0);
        await loadPersistedLogs();
      } else {
        const removableIds = new Set(
          scopedLogs
            .filter((log) => new Date(log.createdAt).getTime() < cutoff.getTime())
            .map((log) => log.id)
        );
        setLogs((current) => current.filter((log) => !removableIds.has(log.id)));
        removedCount = removableIds.size;
      }

      setCleanDialogOpen(false);
      setExpandedId(null);
      setNotice({
        status: "success",
        text: `${removedCount} journal(aux) de plus de ${retentionDays} jours supprimé(s).`
      });
    } catch {
      setNotice({
        status: "error",
        text: "Le nettoyage des journaux a échoué. Aucune autre donnée n’a été modifiée."
      });
    } finally {
      setIsCleaning(false);
    }
  };

  const updateRetentionPolicy = async (days: number) => {
    setRetentionDays(days);
    setNotice(null);

    if (!isPersistent || !session) {
      return;
    }

    try {
      const savedDays = await logRetentionService.setRetentionDays(
        session.account_id,
        days
      );
      const eligible = await logRetentionService.countEligible(
        session.account_id,
        savedDays
      );
      setRetentionDays(savedDays);
      setEligibleForCleanup(eligible);
      setNotice({
        status: "success",
        text:
          eligible > 0
            ? `Conservation automatique réglée sur ${savedDays} jours. ${eligible} journal(aux) sont maintenant éligibles au nettoyage.`
            : `Conservation automatique réglée sur ${savedDays} jours. Aucun journal n’est actuellement trop ancien.`
      });
    } catch {
      setNotice({
        status: "error",
        text: "Impossible d’enregistrer la durée de conservation."
      });
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button
              disabled={isExporting || filteredLogs.length === 0}
              icon={Download}
              onClick={() => void exportLogs()}
            >
              {isExporting ? "Export…" : "Exporter CSV"}
            </Button>
            <Button
              disabled={isLoading || !isPersistent}
              icon={RefreshCw}
              onClick={() => void loadPersistedLogs()}
              variant="ghost"
            >
              {isLoading ? "Actualisation…" : "Actualiser"}
            </Button>
            {canClean ? (
              <Button
                disabled={isCleaning}
                icon={Trash2}
                onClick={() => setCleanDialogOpen(true)}
                variant="danger"
              >
                Nettoyer
              </Button>
            ) : null}
          </div>
        }
        description="Trace persistante des actions importantes, sans mots de passe ni secrets."
        eyebrow="Routeur"
        title="Logs"
      />

      <div className="stats-grid">
        <StatCard
          icon={ScrollText}
          label="Logs"
          value={String(filteredLogs.length)}
          hint={`${scopedLogs.length} dans le périmètre`}
        />
        <StatCard icon={Info} label="Infos" value={String(infoCount)} hint="Actions terminées" />
        <StatCard
          icon={AlertTriangle}
          label="Avertissements"
          value={String(warningCount)}
          hint="À vérifier"
        />
        <StatCard
          icon={Trash2}
          label="Erreurs"
          value={String(errorCount)}
          hint="Erreurs et critiques"
        />
      </div>

      <Card>
        <div className="logs-filter-header">
          <div className="tickets-count">
            <strong>{filteredLogs.length} journal(aux)</strong>
            <span>
              {lastRefreshedAt
                ? `Actualisé ${formatLogDate(lastRefreshedAt)}`
                : "Détails techniques masqués par défaut"}
            </span>
          </div>
          <div className="logs-filter-header__actions">
            {activeFilterCount > 0 ? (
              <Badge status="active">{activeFilterCount} filtre(s) actif(s)</Badge>
            ) : null}
            <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
              {filtersOpen ? "Masquer les filtres" : "Filtres avancés"}
            </Button>
          </div>
        </div>

        <div className="logs-filter-primary">
          <label className="logs-filter-field logs-filter-field--search">
            <span>Recherche</span>
            <div className="logs-search-control">
              <Search aria-hidden="true" />
              <input
                placeholder="Action, message, routeur…"
                value={filters.query}
                onChange={(event) => updateFilters({ query: event.target.value })}
              />
            </div>
          </label>

          <div className="logs-date-range">
            <label className="logs-filter-field">
              <span>Depuis</span>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => updateFilters({ dateFrom: event.target.value })}
              />
            </label>
            <label className="logs-filter-field">
              <span>À</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => updateFilters({ dateTo: event.target.value })}
              />
            </label>
          </div>

          <label className="logs-filter-field">
            <span>Niveau</span>
            <div className="logs-select-control">
              <select
                value={filters.level}
                onChange={(event) =>
                  updateFilters({ level: event.target.value as LogFilters["level"] })
                }
              >
                <option value="">Tous les niveaux</option>
                {logLevels.map((level) => (
                  <option key={level} value={level}>
                    {levelLabel(level)}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          </label>
        </div>

        {filtersOpen ? (
          <LogsFilterPanel
            filters={filters}
            onChange={updateFilters}
            onReset={resetFilters}
            options={options}
          />
        ) : null}
      </Card>

      {notice ? (
        <p className={`form-error ${notice.status === "success" ? "form-error--success" : ""}`}>
          {notice.text}
        </p>
      ) : null}

      <Card className="logs-list-card">
        {isLoading && logs.length === 0 ? (
          <EmptyState
            description="Lecture des journaux persistés en cours."
            icon={RefreshCw}
            title="Chargement…"
          />
        ) : visibleLogs.length > 0 ? (
          <div className="logs-list">
            {visibleLogs.map((log) => (
              <LogRow
                isExpanded={expandedId === log.id}
                key={log.id}
                log={log}
                onCopyTechnical={() => void copyTechnicalDetail(log)}
                onToggle={() =>
                  setExpandedId((current) => (current === log.id ? null : log.id))
                }
              />
            ))}
            <div className="pagination-row">
              <Button
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                variant="ghost"
              >
                Précédent
              </Button>
              <span>Page {currentPage} / {pageCount}</span>
              <Button
                disabled={currentPage >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                variant="ghost"
              >
                Suivant
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            action={
              <Button icon={RotateCcw} onClick={resetFilters} variant="primary">
                Réinitialiser filtres
              </Button>
            }
            description="Aucun journal ne correspond aux filtres."
            icon={ScrollText}
            title="Aucun journal"
          />
        )}
      </Card>

      {canClean ? (
        <Card
          description="Cette politique est persistée et vérifiée automatiquement au démarrage de session, au maximum une fois par jour."
          title="Conservation des journaux"
        >
          <div className="logs-retention-toolbar">
            <label className="logs-filter-field">
              <span>Durée de conservation</span>
              <div className="logs-select-control">
                <select
                  value={retentionDays}
                  onChange={(event) =>
                    void updateRetentionPolicy(Number(event.target.value))
                  }
                >
                  {allowedLogRetentionDays.map((days) => (
                    <option key={days} value={days}>
                      {days === 365 ? "1 an" : `${days} jours`}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </label>
            <div className="tickets-count">
              <strong>{eligibleForCleanup} éligible(s)</strong>
              <span>
                {lastCleanupAt
                  ? `Dernier nettoyage ${formatLogDate(lastCleanupAt)}`
                  : "Premier nettoyage automatique en attente"}
              </span>
            </div>
            <Badge status="active">Automatique actif</Badge>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        confirmLabel={isCleaning ? "Nettoyage…" : "Nettoyer"}
        description={`Les journaux de plus de ${retentionDays} jours seront supprimés définitivement pour ce compte. Les journaux récents resteront disponibles.`}
        isOpen={cleanDialogOpen}
        onCancel={() => setCleanDialogOpen(false)}
        onConfirm={cleanOldLogs}
        title="Nettoyer les anciens journaux ?"
      />
    </div>
  );
}

type LogsFilterOptions = ReturnType<typeof getLogFilterOptions>;

function LogsFilterPanel({
  filters,
  onChange,
  onReset,
  options
}: {
  filters: LogFilters;
  onChange: (partial: Partial<LogFilters>) => void;
  onReset: () => void;
  options: LogsFilterOptions;
}) {
  return (
    <div className="logs-filter-panel">
      <div className="logs-filter-panel__heading">
        <div>
          <strong>Filtres avancés</strong>
          <span>Affinez les journaux par origine et par utilisateur.</span>
        </div>
      </div>
      <label className="logs-filter-field">
        <span>Catégorie</span>
        <div className="logs-select-control">
          <select
            value={filters.category}
            onChange={(event) =>
              onChange({ category: event.target.value as LogFilters["category"] })
            }
          >
            <option value="">Toutes les catégories</option>
            {logCategories.map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category)}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <label className="logs-filter-field">
        <span>Routeur</span>
        <div className="logs-select-control">
          <select
            value={filters.routerId}
            onChange={(event) => onChange({ routerId: event.target.value })}
          >
            <option value="">Tous les routeurs</option>
            {options.routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <label className="logs-filter-field">
        <span>Profil</span>
        <div className="logs-select-control">
          <select
            value={filters.userProfile}
            onChange={(event) =>
              onChange({ userProfile: event.target.value as LogFilters["userProfile"] })
            }
          >
            <option value="">Tous les profils</option>
            {options.profiles.map((profile) => (
              <option key={profile} value={profile}>
                {profileLabel(profile)}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <div className="logs-filter-panel__actions">
        <Button icon={RotateCcw} onClick={onReset} variant="ghost">
          Tout réinitialiser
        </Button>
      </div>
    </div>
  );
}

function LogRow({
  isExpanded,
  log,
  onCopyTechnical,
  onToggle
}: {
  isExpanded: boolean;
  log: AppLogEntry;
  onCopyTechnical: () => void;
  onToggle: () => void;
}) {
  const Icon = log.level === "info" ? CheckCircle2 : AlertTriangle;

  return (
    <article className={`log-row log-row--${log.level}`}>
      <button className="log-row__main" onClick={onToggle} type="button">
        <div className="log-row__icon">
          <Icon aria-hidden="true" />
        </div>
        <div className="log-row__content">
          <div className="log-row__title">
            <strong>{log.userMessage}</strong>
            <Badge status={levelStatus(log.level)}>{levelLabel(log.level)}</Badge>
          </div>
          <p>
            {formatLogDate(log.createdAt)} · {categoryLabel(log.category)} ·{" "}
            {profileLabel(log.userProfile)}
            {log.routerName ? ` · ${log.routerName}` : ""}
          </p>
        </div>
      </button>

      <ActionMenu
        items={[
          {
            icon: Eye,
            label: isExpanded ? "Masquer détail" : "Voir détail",
            onSelect: onToggle
          },
          {
            icon: Clipboard,
            label: "Copier détail technique",
            onSelect: onCopyTechnical
          }
        ]}
      />

      {isExpanded ? (
        <div className="log-row__technical">
          <div>
            <span>Action</span>
            <strong>{log.action ?? "Non précisée"}</strong>
          </div>
          <div>
            <span>Détail technique sécurisé</span>
            <code>{log.technicalDetail ?? "Aucun détail technique disponible."}</code>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
