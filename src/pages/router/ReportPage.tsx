import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  Printer,
  RefreshCw,
  Ticket,
  Trash2,
  UserRound
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  PrintHistoryRepository,
  RouterRepository,
  TicketRepository
} from "../../services/database/repositories";
import { TauriFileService } from "../../services/files";
import { AuditLogService } from "../../services/logging";
import { generateReportPdf } from "../../services/pdf";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../../shared/ui";
import type { IconComponent } from "../../shared/ui";
import {
  buildReportSummary,
  buildReportCsv,
  createDemoReportTickets,
  emptyReportFilters,
  filterReportTickets,
  formatCfa,
  formatReportDate,
  getTicketsForMetric,
  internalProfileLabel,
  profileLabel,
  scopeReportTicketsForSession,
  type ReportFilters,
  type ReportGroupRow,
  type ReportMetric,
  type ReportMetricId,
  type ReportTicket
} from "./reportPageModel";
import { ticketFromRecord, ticketStatusLabel, ticketStatusToBadge } from "./ticketsPageModel";

type SelectedReportTickets = {
  title: string;
  tickets: ReportTicket[];
};

export function ReportPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [tickets, setTickets] = useState<ReportTicket[]>(() => (isPersistent ? [] : createDemoReportTickets()));
  const [filters, setFilters] = useState<ReportFilters>(() =>
    isPersistent ? { ...emptyReportFilters, dateFrom: "", dateTo: "" } : emptyReportFilters
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTickets, setSelectedTickets] = useState<SelectedReportTickets | null>(null);
  const [selectedTicketLimit, setSelectedTicketLimit] = useState(20);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const printHistoryRepository = useMemo(() => new PrintHistoryRepository(database), [database]);
  const generatedFileRepository = useMemo(() => new GeneratedFileRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const fileService = useMemo(() => new TauriFileService(), []);

  const loadReport = async () => {
    if (!isPersistent || !isInitialized || !session) {
      return;
    }

    setIsLoading(true);
    setMessage(null);
    setMessageIsError(false);

    try {
      const profileScope = session.permissions.includes("router.report.read")
        ? undefined
        : session.internal_profile_id;
      const [router, records, plans, printHistory] = await Promise.all([
        routerRepository.findById(routerId),
        ticketRepository.listForReportByAccount(session.account_id, profileScope),
        planRepository.listByRouter(routerId),
        printHistoryRepository.listByAccount(session.account_id)
      ]);

      if (!router || router.account_id !== session.account_id) {
        throw new Error("Routeur introuvable pour ce compte.");
      }

      const plansById = new Map(plans.map((plan) => [plan.id, plan]));
      const printDatesByBatch = new Map<string, string[]>();
      printHistory
        .filter(
          (entry) =>
            entry.router_id === routerId &&
            entry.batch_id &&
            entry.status === "printed" &&
            entry.mode !== "test"
        )
        .forEach((entry) => {
          const dates = printDatesByBatch.get(entry.batch_id!) ?? [];
          dates.push(entry.created_at);
          printDatesByBatch.set(entry.batch_id!, dates);
        });
      setTickets(
        records
          .filter((record) => record.router_id === routerId)
          .map((record) => {
            const ticket = ticketFromRecord(record, plansById.get(record.plan_id) ?? null, router.name);
            return {
              ...ticket,
              deletedAt: record.deleted_at,
              printedAt:
                printDatesByBatch.get(record.batch_id) ??
                (record.printed_count > 0 ? [record.updated_at] : []),
              priceHint: plansById.get(ticket.planId)?.price_hint ?? null
            };
          })
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de charger le rapport.");
      setMessageIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, [isInitialized, isPersistent, planRepository, printHistoryRepository, routerId, routerRepository, session, ticketRepository]);

  const scopedTickets = useMemo(() => scopeReportTicketsForSession(tickets, session), [session, tickets]);
  const filteredTickets = useMemo(() => filterReportTickets(scopedTickets, filters), [filters, scopedTickets]);
  const summary = useMemo(() => buildReportSummary(scopedTickets, filters), [filters, scopedTickets]);
  const filterOptions = useMemo(() => buildFilterOptions(scopedTickets), [scopedTickets]);

  const updateFilters = (partial: Partial<ReportFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setMessage(null);
    setMessageIsError(false);
    setSelectedTickets(null);
  };

  const openMetric = (metric: ReportMetric) => {
    setSelectedTicketLimit(20);
    setSelectedTickets({
      tickets: getTicketsForMetric(filteredTickets, metric.id, filters),
      title: metric.label
    });
  };

  const openGroup = (group: ReportGroupRow) => {
    setSelectedTicketLimit(20);
    setSelectedTickets({ title: group.label, tickets: group.tickets });
  };

  const resetFilters = () => {
    setFilters(isPersistent ? { ...emptyReportFilters, dateFrom: "", dateTo: "" } : emptyReportFilters);
    setMessage(null);
    setMessageIsError(false);
    setSelectedTickets(null);
    setSelectedTicketLimit(20);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button disabled={isLoading || isExporting || filteredTickets.length === 0} icon={FileText} onClick={() => void exportReport("pdf")}>
              Exporter PDF
            </Button>
            <Button disabled={isLoading || isExporting || filteredTickets.length === 0} icon={Download} onClick={() => void exportReport("csv")}>
              Exporter CSV
            </Button>
            <Button disabled={isLoading} icon={RefreshCw} onClick={() => void loadReport()}>
              Rafraîchir
            </Button>
          </div>
        }
        description="Activité des tickets sur une période. Les montants CFA sont des valeurs théoriques basées sur le prix indicatif des plans."
        eyebrow="Routeur"
        title="Rapport"
      />

      <Card>
        <div className="report-toolbar">
          <div className="tickets-count">
            <strong>Tickets ({filteredTickets.length})</strong>
            <span>
              Créés : {formatCfa(summary.createdTheoreticalCfa)} · Activés : {formatCfa(summary.activatedTheoreticalCfa)}
            </span>
          </div>
          <label className="date-field">
            Depuis
            <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
          </label>
          <label className="date-field">
            À
            <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <ReportFiltersPanel filters={filters} onChange={updateFilters} onReset={resetFilters} options={filterOptions} />
        ) : null}
      </Card>

      {message ? <p className={messageIsError ? "form-error" : "form-error form-error--success"}>{message}</p> : null}

      <div className="page-grid">
        <div className="span-4">
          <StatCard icon={Ticket} label="Créés" value={String(summary.metrics.find((metric) => metric.id === "created")?.value ?? 0)} hint={formatCfa(summary.createdTheoreticalCfa)} />
        </div>
        <div className="span-4">
          <StatCard icon={CheckCircle2} label="Activés" value={String(summary.metrics.find((metric) => metric.id === "activated")?.value ?? 0)} hint={formatCfa(summary.activatedTheoreticalCfa)} />
        </div>
        <div className="span-4">
          <StatCard icon={Trash2} label="Supprimés" value={String(summary.metrics.find((metric) => metric.id === "deleted")?.value ?? 0)} hint="Suppression contrôlée" />
        </div>
      </div>

      <Card title="Résumé">
        <div className="report-summary-list">
          {summary.metrics.map((metric) => (
            <ReportMetricRow key={metric.id} metric={metric} onClick={() => openMetric(metric)} />
          ))}
        </div>
      </Card>

      <div className="page-grid">
        <Card className="span-4" title="Activité par plan">
          <ReportGroupList groups={summary.byPlan} onOpen={openGroup} />
        </Card>
        <Card className="span-4" title="Activité par profil">
          <ReportGroupList groups={summary.byOperator} onOpen={openGroup} />
        </Card>
        <Card className="span-4" title="Activité par jour">
          <ReportGroupList groups={summary.byDay} onOpen={openGroup} />
        </Card>
      </div>

      {selectedTickets ? (
        <Card
          actions={
            <Button onClick={() => setSelectedTickets(null)} variant="ghost">
              Fermer
            </Button>
          }
          title={`${selectedTickets.title} (${selectedTickets.tickets.length})`}
        >
          {selectedTickets.tickets.length > 0 ? (
            <div className="report-ticket-list">
              {selectedTickets.tickets.slice(0, selectedTicketLimit).map((ticket) => (
                <div className="report-ticket-row" key={ticket.id}>
                  <strong>{ticket.code}</strong>
                  <span>{ticket.planName}</span>
                  <span>{internalProfileLabel(ticket.createdByProfileId)}</span>
                  <span>{ticketActivityLabel(ticket)}</span>
                  <Badge status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
                </div>
              ))}
              {selectedTicketLimit < selectedTickets.tickets.length ? (
                <Button
                  onClick={() =>
                    setSelectedTicketLimit((current) =>
                      Math.min(current + 20, selectedTickets.tickets.length)
                    )
                  }
                  variant="secondary"
                >
                  Afficher 20 tickets supplémentaires
                </Button>
              ) : null}
            </div>
          ) : (
            <EmptyState description="Aucun ticket ne correspond à cette ligne de rapport." icon={Ticket} title="Aucun ticket" />
          )}
        </Card>
      ) : null}
    </div>
  );

  async function exportReport(format: "csv" | "pdf") {
    if (filteredTickets.length === 0) {
      setMessage("Aucune donnée à exporter.");
      setMessageIsError(true);
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `rapport-${routerId}-${stamp}.${format}`;
    const relativePath = `files/${fileName}`;
    const bytes =
      format === "csv"
        ? new TextEncoder().encode(buildReportCsv(filteredTickets))
        : generateReportPdf({
            generatedAt: new Date().toLocaleString("fr-FR"),
            rows: filteredTickets.map((ticket) => ({
              code: ticket.code,
              createdAt: formatReportDate(ticket.createdAt),
              operator: internalProfileLabel(ticket.createdByProfileId),
              plan: ticket.planName,
              priceLabel: formatCfa(ticket.priceHint),
              router: ticket.routerName,
              status: ticket.status
            })),
            summary: [
              `Période: ${filters.dateFrom || "début"} au ${filters.dateTo || "aujourd'hui"}`,
              `Tickets visibles: ${filteredTickets.length}`,
              ...summary.metrics.map((metric) => `${metric.label}: ${metric.value}`)
            ],
            title: "Rapport d'activité TicketPro"
          });

    setIsExporting(true);
    let managedPath: string | null = null;
    let historyCreated = false;
    try {
      if (isPersistent && session) {
        const savedFile = await fileService.writeBytes(relativePath, bytes);
        managedPath = savedFile.relative_path;
        await generatedFileRepository.create({
          account_id: session.account_id,
          batch_id: null,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          file_name: fileName,
          file_path: savedFile.relative_path,
          format,
          id: createId("report"),
          router_id: routerId,
          sync_status: "local",
          type: format === "csv" ? "report_csv" : "report_pdf"
        });
        historyCreated = true;
        try {
          const exported = await fileService.exportToDownloads(savedFile.relative_path);
          await auditLogService.write({
            accountId: session.account_id,
            action: `report.export.${format}`,
            category: "rapport",
            internalProfileId: session.internal_profile_id,
            internalProfileRole: session.internal_profile_role,
            message: `${fileName} exporté avec ${filteredTickets.length} ticket(s).`,
            routerId,
            technicalMessage: `file=${fileName};format=${format};tickets=${filteredTickets.length}`
          });
          setMessage(
            `${format.toUpperCase()} archivé dans Fichiers et exporté sous Téléchargements/TicketPro/${exported.file_name}.`
          );
          setMessageIsError(false);
        } catch {
          await auditLogService.write({
            accountId: session.account_id,
            action: `report.export.${format}.partial`,
            category: "rapport",
            internalProfileId: session.internal_profile_id,
            internalProfileRole: session.internal_profile_role,
            level: "warning",
            message: `${fileName} archivé, mais la copie vers Téléchargements a échoué.`,
            routerId,
            technicalMessage: `file=${fileName};format=${format};tickets=${filteredTickets.length}`
          });
          setMessage(
            `${format.toUpperCase()} archivé dans Fichiers, mais la copie vers Téléchargements a échoué.`
          );
          setMessageIsError(true);
        }
      } else {
        downloadBytes(bytes, fileName, format === "csv" ? "text/csv;charset=utf-8" : "application/pdf");
        setMessage(`${format.toUpperCase()} du rapport exporté avec succès.`);
        setMessageIsError(false);
      }
    } catch (error) {
      if (managedPath && !historyCreated) {
        await fileService.remove(managedPath).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "L'export a échoué.");
      setMessageIsError(true);
    } finally {
      setIsExporting(false);
    }
  }
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ticketActivityLabel(ticket: ReportTicket): string {
  return [
    `Créé ${formatReportDate(ticket.createdAt)}`,
    ticket.printedAt[0] ? `Imprimé ${formatReportDate(ticket.printedAt[0])}` : null,
    ticket.activatedAt ? `Activé ${formatReportDate(ticket.activatedAt)}` : null,
    ticket.completedAt ? `Terminé ${formatReportDate(ticket.completedAt)}` : null,
    ticket.deletedAt ? `Supprimé ${formatReportDate(ticket.deletedAt)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

type FilterOptions = {
  internalProfiles: Array<{ id: string; label: string }>;
  operators: string[];
  plans: Array<{ id: string; name: string }>;
  routers: Array<{ id: string; name: string }>;
};

function ReportMetricRow({ metric, onClick }: { metric: ReportMetric; onClick: () => void }) {
  const Icon = metricIcon(metric.id);

  return (
    <button className="report-summary-row" onClick={onClick} type="button">
      <span className="report-summary-row__icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="report-summary-row__label">
        <strong>{metric.label}</strong>
        <small>{metric.hint}</small>
      </span>
      <span className="report-summary-row__value">
        <strong>{metric.value}</strong>
        {metric.totalCfa !== null ? <small>{formatCfa(metric.totalCfa)}</small> : null}
      </span>
    </button>
  );
}

function ReportGroupList({
  groups,
  onOpen
}: {
  groups: ReportGroupRow[];
  onOpen: (group: ReportGroupRow) => void;
}) {
  if (groups.length === 0) {
    return <EmptyState description="Aucune activité sur la période." icon={Ticket} title="Aucune donnée" />;
  }

  return (
    <div className="report-group-list">
      {groups.map((group) => (
        <button className="report-group-row" key={group.id} onClick={() => onOpen(group)} type="button">
          <span>
            <strong>{group.label}</strong>
            <small>{formatCfa(group.theoreticalCfa)}</small>
          </span>
          <span className="report-group-row__numbers">
            <b>{group.created}</b>
            <small>créés</small>
            <b>{group.activated}</b>
            <small>activés</small>
            <b>{group.completed}</b>
            <small>complétés</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function ReportFiltersPanel({
  filters,
  onChange,
  onReset,
  options
}: {
  filters: ReportFilters;
  onChange: (partial: Partial<ReportFilters>) => void;
  onReset: () => void;
  options: FilterOptions;
}) {
  return (
    <div className="report-filter-panel">
      <label className="form-field">
        Plan
        <select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}>
          <option value="">Tous les plans</option>
          {options.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Profil interne
        <select value={filters.internalProfileId} onChange={(event) => onChange({ internalProfileId: event.target.value })}>
          <option value="">Tous les profils internes</option>
          {options.internalProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Rôle
        <select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}>
          <option value="">Tous les rôles</option>
          {options.operators.map((operator) => (
            <option key={operator} value={operator}>
              {profileLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Routeur
        <select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}>
          <option value="">Tous les routeurs</option>
          {options.routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name}
            </option>
          ))}
        </select>
      </label>
      <div className="report-filter-panel__actions">
        <Button onClick={onReset} variant="ghost">
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}

function metricIcon(metricId: ReportMetricId): IconComponent {
  const icons: Record<ReportMetricId, IconComponent> = {
    activated: CheckCircle2,
    available: Ticket,
    completed: CheckCircle2,
    created: Ticket,
    deleted: Trash2,
    expired: Clock,
    printed: Printer
  };

  return icons[metricId];
}

function buildFilterOptions(tickets: ReportTicket[]): FilterOptions {
  return {
    internalProfiles: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.createdByProfileId, label: internalProfileLabel(ticket.createdByProfileId) })),
      (profile) => profile.id
    ),
    operators: unique(tickets.map((ticket) => ticket.operatorProfile)),
    plans: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.planId, name: ticket.planName })),
      (plan) => plan.id
    ),
    routers: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.routerId, name: ticket.routerName })),
      (router) => router.id
    )
  };
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const map = new Map<string, T>();

  values.forEach((value) => {
    map.set(getKey(value), value);
  });

  return Array.from(map.values());
}
