import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  Filter,
  Info,
  RotateCcw,
  ScrollText,
  Trash2
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
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
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  canCleanLogs,
  categoryLabel,
  createDemoLogs,
  emptyLogFilters,
  exportLogsToCsv,
  filterLogs,
  formatLogDate,
  getLogFilterOptions,
  levelLabel,
  levelStatus,
  logCategories,
  logLevels,
  profileLabel,
  scopeLogsForSession,
  type AppLogEntry,
  type LogFilters
} from "./logsPageModel";

export function LogsPage() {
  const { session } = useAuth();
  const [logs, setLogs] = useState<AppLogEntry[]>(() => createDemoLogs());
  const [filters, setFilters] = useState<LogFilters>(emptyLogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanDialogOpen, setCleanDialogOpen] = useState(false);

  const scopedLogs = useMemo(() => scopeLogsForSession(logs, session), [logs, session]);
  const filteredLogs = useMemo(() => filterLogs(scopedLogs, filters), [scopedLogs, filters]);
  const options = useMemo(() => getLogFilterOptions(scopedLogs), [scopedLogs]);
  const warningCount = scopedLogs.filter((log) => log.level === "warning").length;
  const errorCount = scopedLogs.filter((log) => log.level === "error" || log.level === "critical").length;
  const canClean = canCleanLogs(session?.internal_profile_role);

  const updateFilters = (partial: Partial<LogFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const resetFilters = () => {
    setFilters(emptyLogFilters);
    setMessage(null);
  };

  const exportLogs = async () => {
    const csv = exportLogsToCsv(filteredLogs);

    try {
      await navigator.clipboard.writeText(csv);
      setMessage("Export logs copié au format CSV.");
    } catch {
      setMessage("Export CSV préparé. Copie indisponible sur ce poste.");
    }
  };

  const copyTechnicalDetail = async (log: AppLogEntry) => {
    if (!log.technicalDetail) {
      setMessage("Aucun détail technique à copier.");
      return;
    }

    try {
      await navigator.clipboard.writeText(log.technicalDetail);
      setMessage("Détail technique copié.");
    } catch {
      setMessage("Copie indisponible sur ce poste.");
    }
  };

  const cleanOldLogs = () => {
    const cutoff = new Date("2026-07-09T10:00:00.000Z").getTime();
    const removableIds = new Set(
      scopedLogs.filter((log) => new Date(log.createdAt).getTime() < cutoff).map((log) => log.id)
    );
    const remaining = logs.filter((log) => !removableIds.has(log.id));
    const removedCount = logs.length - remaining.length;

    setLogs(remaining);
    setCleanDialogOpen(false);
    setExpandedId(null);
    setMessage(`${removedCount} ancien(s) log(s) nettoyé(s).`);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button icon={Download} onClick={() => void exportLogs()}>
              Exporter logs
            </Button>
            {canClean ? (
              <Button icon={Trash2} onClick={() => setCleanDialogOpen(true)} variant="danger">
                Nettoyer anciens logs
              </Button>
            ) : null}
          </div>
        }
        description="Trace claire des actions importantes, sans mots de passe ni secrets."
        eyebrow="Routeur"
        title="Logs"
      />

      <div className="stats-grid">
        <StatCard icon={ScrollText} label="Logs" value={String(filteredLogs.length)} hint="Articles affichés" />
        <StatCard icon={Info} label="Infos" value={String(logs.filter((log) => log.level === "info").length)} hint="Actions terminées" />
        <StatCard icon={AlertTriangle} label="Avertissements" value={String(warningCount)} hint="À vérifier" />
        <StatCard icon={Trash2} label="Erreurs" value={String(errorCount)} hint="Erreurs et critiques" />
      </div>

      <Card>
        <div className="logs-toolbar">
          <div className="tickets-count">
            <strong>Articles ({filteredLogs.length})</strong>
            <span>Détails techniques masqués par défaut</span>
          </div>
          <label className="date-field">
            Depuis
            <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
          </label>
          <label className="date-field">
            À
            <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
          </label>
          <label className="date-field">
            Niveau
            <select value={filters.level} onChange={(event) => updateFilters({ level: event.target.value as LogFilters["level"] })}>
              <option value="">Tous</option>
              {logLevels.map((level) => (
                <option key={level} value={level}>
                  {levelLabel(level)}
                </option>
              ))}
            </select>
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <LogsFilterPanel filters={filters} onChange={updateFilters} onReset={resetFilters} options={options} />
        ) : null}
      </Card>

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card className="logs-list-card">
        {filteredLogs.length > 0 ? (
          <div className="logs-list">
            {filteredLogs.map((log) => (
              <LogRow
                isExpanded={expandedId === log.id}
                key={log.id}
                log={log}
                onCopyTechnical={() => void copyTechnicalDetail(log)}
                onToggle={() => setExpandedId((current) => (current === log.id ? null : log.id))}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Button icon={RotateCcw} onClick={resetFilters} variant="primary">
                Réinitialiser filtres
              </Button>
            }
            description="Aucun log ne correspond aux filtres."
            icon={ScrollText}
            title="Aucun log"
          />
        )}
      </Card>

      <ConfirmDialog
        confirmLabel="Nettoyer"
        description="Seuls les anciens logs de démonstration seront retirés de cette vue. Les logs récents restent visibles."
        isOpen={cleanDialogOpen}
        onCancel={() => setCleanDialogOpen(false)}
        onConfirm={cleanOldLogs}
        title="Nettoyer les anciens logs ?"
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
      <label className="date-field">
        Catégorie
        <select value={filters.category} onChange={(event) => onChange({ category: event.target.value as LogFilters["category"] })}>
          <option value="">Toutes</option>
          {logCategories.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </label>
      <label className="date-field">
        Routeur
        <select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}>
          <option value="">Tous</option>
          {options.routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name}
            </option>
          ))}
        </select>
      </label>
      <label className="date-field">
        Profil
        <select value={filters.userProfile} onChange={(event) => onChange({ userProfile: event.target.value as LogFilters["userProfile"] })}>
          <option value="">Tous</option>
          {options.profiles.map((profile) => (
            <option key={profile} value={profile}>
              {profileLabel(profile)}
            </option>
          ))}
        </select>
      </label>
      <div className="files-filter-panel__actions">
        <Button icon={RotateCcw} onClick={onReset} variant="ghost">
          Réinitialiser
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
  const Icon = logIcon(log.level);

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
            {formatLogDate(log.createdAt)} · {categoryLabel(log.category)} · {profileLabel(log.userProfile)}
            {log.routerName ? ` · ${log.routerName}` : ""}
          </p>
        </div>
      </button>

      <ActionMenu
        items={[
          { icon: Eye, label: isExpanded ? "Masquer détail" : "Voir détail", onSelect: onToggle },
          { icon: Clipboard, label: "Copier détail technique", onSelect: onCopyTechnical }
        ]}
      />

      {isExpanded ? (
        <div className="log-row__technical">
          <div>
            <span>Action</span>
            <strong>{log.action ?? "Non précisée"}</strong>
          </div>
          <div>
            <span>Détail technique</span>
            <code>{log.technicalDetail ?? "Aucun détail technique disponible."}</code>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function logIcon(level: AppLogEntry["level"]): IconComponent {
  if (level === "info") {
    return CheckCircle2;
  }

  return AlertTriangle;
}
