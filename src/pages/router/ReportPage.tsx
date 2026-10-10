import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Router as RouterIcon,
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
  RouterConnectionRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketStateHistoryRepository,
  TicketRepository
} from "../../services/database/repositories";
import { TauriFileService } from "../../services/files";
import { AuditLogService } from "../../services/logging";
import { generateReportPdf } from "../../services/pdf";
import { createPersistedRouterService } from "../../services/router";
import {
  OrganizationOperationsSyncService,
  OrganizationTicketCatalogService,
  RouterTicketSyncService
} from "../../services/sync";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  buildReportSummary,
  buildReportCsv,
  createDemoReportTickets,
  emptyReportFilters,
  filterReportTickets,
  formatCurrencyTotals,
  formatMoney,
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
import {
  formatBytes,
  formatSeconds,
  ticketFromRecord,
  ticketStatusLabel,
  ticketStatusToBadge
} from "./ticketsPageModel";
import { getSaasRouterRecoveryState, getSaasRouterTicketCatalog, SaasRequestError, type SaasRouterTicketCatalog } from "../../services/saas";
import { routerAccessPolicyCloudId } from "../../services/access/routerAccessPolicyIdentity";
import { hasTicketDataChanges, mergeTicketUpdate, persistTicketSyncReport } from "./ticketSyncPersistence";
import { cloudReportTickets, mergeReportTickets, reportRead } from "./reportRead";

type SelectedReportTickets = {
  title: string;
  tickets: ReportTicket[];
};

type ReportLiveStatus = "connecting" | "degraded" | "live" | "offline";

const reportLiveRefreshIntervalMs = 15_000;

export function ReportPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session, saasAccount } = useAuth();
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
  const [liveStatus, setLiveStatus] = useState<ReportLiveStatus>(isPersistent ? "connecting" : "offline");
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [routerOnlyCount, setRouterOnlyCount] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const activeRead = useRef<AbortController | null>(null);
  const latestTickets = useRef<ReportTicket[]>([]);
  latestTickets.current = tickets;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const reportScope = JSON.stringify([routerId, session?.account_id, session?.internal_profile_id,
    session?.permissions, saasAccount?.organization.id, saasAccount?.user.id]);

  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const ticketHistoryRepository = useMemo(() => new TicketStateHistoryRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const routerConnectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const ticketBatchRepository = useMemo(() => new TicketBatchRepository(database), [database]);
  const printHistoryRepository = useMemo(() => new PrintHistoryRepository(database), [database]);
  const generatedFileRepository = useMemo(() => new GeneratedFileRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const fileService = useMemo(() => new TauriFileService(), []);
  const organizationOperations = useMemo(
    () => session
      ? new OrganizationOperationsSyncService(
          database,
          session.account_id,
          session.internal_profile_id,
          session.internal_profile_role
        )
      : null,
    [database, session]
  );

  const loadReport = useCallback(async (options: { silent?: boolean } = {}) => {
    const session = sessionRef.current;
    if (!isPersistent || !isInitialized || !session) {
      return;
    }
    if (activeRead.current) return;
    const controller = new AbortController();
    activeRead.current = controller;
    const current = () => activeRead.current === controller && !controller.signal.aborted;
    const read = <T,>(label: string, work: () => Promise<T>) => reportRead(controller.signal, label, work);
    // A report already on screen is replaced only once per cycle, by a
    // complete result (local + shared catalogue + RouterOS). Intermediate
    // stages are shown only when nothing is displayed yet.
    const hasDisplayedReport = latestTickets.current.length > 0;
    let stagedTickets: ReportTicket[] | null = null;
    const publishStage = (next: ReportTicket[]) => {
      stagedTickets = next;
      if (!hasDisplayedReport) setTickets(next);
    };
    if (!options.silent) setIsLoading(true);
    setIsRefreshing(true);
    if (!hasDisplayedReport) {
      setLiveStatus("connecting");
      setLiveError(null);
    }
    if (!options.silent) {
      setMessage(null);
      setMessageIsError(false);
    }

    try {
      let catalogError: string | null = null;
      let sharedCatalog: SaasRouterTicketCatalog | null = null;
      if (!session.permissions.some(permission => permission === "router.report.read" || permission === "router.report.own")) {
        setTickets([]);
        throw new Error("Votre rôle n’autorise pas la consultation des rapports.");
      }
      const profileScope = session.permissions.includes("router.report.read")
        ? undefined
        : session.internal_profile_id;
      const [router, records, plans, batches, printHistory, connections] = await read("Lecture locale", () => Promise.all([
        routerRepository.findById(routerId),
        ticketRepository.listForReportByAccount(session.account_id, profileScope),
        planRepository.listByRouter(routerId),
        ticketBatchRepository.listByRouter(routerId),
        printHistoryRepository.listByAccount(session.account_id),
        routerConnectionRepository.listByRouter(routerId)
      ]));
      if (!current()) return;

      if (!router || router.deleted_at || router.account_id !== session.account_id ||
          (router.organization_id && saasAccount?.organization.id && router.organization_id !== saasAccount.organization.id)) {
        setTickets([]);
        throw new Error("Routeur introuvable pour ce compte.");
      }

      const plansById = new Map(plans.map((plan) => [plan.id, plan]));
      const currencyByBatchId = new Map(batches.map((batch) => [batch.id, batch.currency || "CFA"]));
      const priceByBatchId = new Map(batches.map((batch) => [batch.id, batch.price_snapshot]));
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
      let reportTickets = records
          .filter((record) => record.router_id === routerId)
          .map((record) => {
            const ticket = ticketFromRecord(record, plansById.get(record.plan_id) ?? null, router.name);
            return {
              ...ticket,
              currency: currencyByBatchId.get(record.batch_id) ?? "CFA",
              deletedAt: record.deleted_at,
              printedAt: record.printed_count > 0 ? printDatesByBatch.get(record.batch_id) ?? [] : [],
              priceHint: priceByBatchId.has(record.batch_id)
                ? priceByBatchId.get(record.batch_id) ?? null
                : plansById.get(ticket.planId)?.price_hint ?? null
            };
          });

      // Keep the latest persisted snapshot visible even while RouterOS is being read.
      if (latestTickets.current.length > 0) {
        reportTickets = mergeReportTickets(latestTickets.current, reportTickets);
      }
      publishStage(reportTickets);
      setIsLoading(false);

      const cloudController = new AbortController();
      const abortCloud = () => cloudController.abort();
      controller.signal.addEventListener("abort", abortCloud, { once: true });
      try {
        const [state, catalog] = await read("Lecture du catalogue partagé", () => Promise.all([
          getSaasRouterRecoveryState(cloudController.signal),
          getSaasRouterTicketCatalog(router.cloud_router_id ?? router.id, "report", cloudController.signal)
        ]));
        if (!current()) return;
        const identity = routerAccessPolicyCloudId(router, connections).toLowerCase();
        if ((state.organization_id && state.organization_id !== saasAccount?.organization.id) ||
            catalog.router_id !== (router.cloud_router_id ?? router.id) ||
            state.retired?.some(item => item.router_id === (router.cloud_router_id ?? router.id) ||
              item.stable_identity.toLowerCase() === identity)) {
          setTickets([]);
          throw new SaasRequestError("Ce routeur n’est plus accessible dans cette organisation.", 403);
        }
        const shared = cloudReportTickets(catalog, session, saasAccount?.user.id, routerId, router.name, plans);
        sharedCatalog = catalog;
        reportTickets = mergeReportTickets(reportTickets, shared);
        publishStage(reportTickets);
      } catch (error) {
        if (!current()) return;
        if (error instanceof SaasRequestError && [401, 403, 404].includes(error.status)) {
          setTickets([]);
          setSelectedTickets(null);
          throw error;
        }
        catalogError = error instanceof Error ? error.message : "Catalogue partagé indisponible.";
      } finally {
        cloudController.abort();
        controller.signal.removeEventListener("abort", abortCloud);
      }

      const localByCode = new Map(records.filter(record => record.router_id === routerId).map(record => [record.username, record]));
      reportTickets = reportTickets.map(ticket => {
        const local = localByCode.get(ticket.code);
        return local ? { ...ticket, id: local.id, batchId: local.batch_id, planId: local.plan_id } : ticket;
      });
      const routerService = await read("Connexion MikroTik", () => createPersistedRouterService({
        authSession: session,
        connections,
        database,
        logActions: false,
        router
      }));
      if (!current()) return;
      const syncReport = await read("Lecture MikroTik", () => new RouterTicketSyncService(routerService).compareTickets(
        reportTickets.filter((ticket) => ticket.status !== "supprimé")
      ));
      if (!current()) return;
      const updates = new Map(syncReport.updates.map(update => [update.id, update]));
      const beforeObservation = reportTickets;
      reportTickets = reportTickets.map(ticket => ({ ...ticket, ...mergeTicketUpdate(ticket, updates.get(ticket.id)) }));

      setTickets(reportTickets);
      setRouterOnlyCount(syncReport.localMissing.length);
      setLastLiveSyncAt(new Date().toISOString());
      setLiveStatus(catalogError ? "degraded" : "live");
      setLiveError(catalogError ? `Lecture MikroTik réussie, mais les données entre PC peuvent être incomplètes : ${catalogError}` : null);
      // A read-only collaborator never publishes or mutates the shared catalogue.
      if (session.permissions.includes("router.tickets.sync")) {
        const localIds = new Set(records.map(record => record.id));
        const localTickets = beforeObservation.filter(ticket => localIds.has(ticket.id));
        try {
          await read("Conservation des observations", () => persistTicketSyncReport({
            actorProfileId: session.internal_profile_id,
            batchRepository: ticketBatchRepository,
            report: { ...syncReport, updates: syncReport.updates.filter(update => localIds.has(update.id)) },
            ticketHistoryRepository,
            ticketRepository,
            tickets: localTickets
          }));
          if (!current()) return;
          const changedBatches = new Set(localTickets.filter(ticket =>
            hasTicketDataChanges(ticket, mergeTicketUpdate(ticket, updates.get(ticket.id)))
          ).map(ticket => ticket.batchId));
          const publisher = new OrganizationTicketCatalogService(database, session.account_id,
            session.internal_profile_id, session.internal_profile_role);
          for (const batchId of changedBatches) {
            await read("Partage des observations", () => publisher.publishBatch(routerId, batchId));
            if (!current()) return;
          }
          if (sharedCatalog) {
            const beforeByCode = new Map(beforeObservation.map(ticket => [ticket.code, ticket]));
            const observedByCode = new Map(reportTickets.filter(ticket => !localIds.has(ticket.id)
              && hasTicketDataChanges(beforeByCode.get(ticket.code)!, ticket)).map(ticket => [ticket.code, ticket]));
            const snapshots = sharedCatalog.tickets.flatMap(remote => {
              const observed = observedByCode.get(remote.username);
              if (!observed) return [];
              return [{ ...remote, activated_at: observed.activatedAt, completed_at: observed.completedAt,
                expires_at: observed.expiresAt, archived_at: observed.archivedAt, router_deleted_at: observed.routerDeletedAt,
                downloaded_bytes: observed.downloadedBytes, uploaded_bytes: observed.uploadedBytes,
                uptime_seconds: observed.uptimeSeconds, remaining_seconds: observed.remainingSeconds,
                data_remaining_bytes: observed.dataRemainingBytes, last_router_sync_at: observed.lastRouterSyncAt,
                ip_address: observed.ipAddress, mac_address: observed.macAddress, mikrotik_id: observed.mikrotikId,
                status: observed.status, sync_status: observed.syncStatus === "conflict" ? "conflict" : observed.syncStatus === "error" ? "error" : "synced",
                updated_at: new Date().toISOString() }];
            });
            if (snapshots.length) {
              await read("Partage des observations distantes", () => publisher.publishObservedCatalog(routerId,
                { batches: sharedCatalog!.batches, tickets: snapshots }));
              if (!current()) return;
            }
          }
          if (!changedBatches.size) await read("Reprise du partage", () => publisher.resumePending(routerId));
        } catch (error) {
          if (!current()) return;
          setLiveStatus("degraded");
          setLiveError(`Lecture MikroTik réussie ; conservation ou partage en attente : ${error instanceof Error ? error.message : "erreur de synchronisation"}`);
        }
      }
    } catch (error) {
      if (!current()) return;
      const errorMessage = error instanceof Error ? error.message : "Le routeur ne répond pas.";
      // RouterOS failed: keep the report already displayed. When nothing was
      // displayed, the local/shared snapshot is shown, flagged as degraded.
      if (!hasDisplayedReport && stagedTickets) setTickets(stagedTickets);
      setLiveStatus("degraded");
      setLiveError(errorMessage);
      if (!options.silent) {
        setMessage(errorMessage);
        setMessageIsError(true);
      }
    } finally {
      if (current()) {
        activeRead.current = null;
        setIsLoading(false);
        setIsRefreshing(false);
      }
      controller.abort();
    }
  }, [
    database,
    isInitialized,
    isPersistent,
    planRepository,
    printHistoryRepository,
    routerConnectionRepository,
    routerId,
    routerRepository,
    reportScope,
    saasAccount?.user.id,
    saasAccount?.organization.id,
    ticketBatchRepository,
    ticketHistoryRepository,
    ticketRepository
  ]);

  useEffect(() => {
    setLoadedScope(reportScope);
    latestTickets.current = [];
    setTickets(isPersistent ? [] : createDemoReportTickets());
    setSelectedTickets(null);
    setLastLiveSyncAt(null);
    setRouterOnlyCount(0);
    void loadReport();
    if (!isPersistent) return undefined;
    const synchronize = () => {
      if (document.visibilityState === "hidden") return;
      void loadReport({ silent: true });
    };
    const interval = window.setInterval(synchronize, reportLiveRefreshIntervalMs);
    window.addEventListener("focus", synchronize);
    return () => {
      activeRead.current?.abort();
      activeRead.current = null;
      window.clearInterval(interval);
      window.removeEventListener("focus", synchronize);
    };
  }, [isPersistent, loadReport]);

  const scopedTickets = useMemo(() => scopeReportTicketsForSession(
    !isPersistent || loadedScope === reportScope ? tickets : [], session
  ), [session, tickets, isPersistent, loadedScope, reportScope]);
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
            <Button
              className={isRefreshing ? "button--loading" : ""}
              disabled={isLoading || isRefreshing}
              icon={RefreshCw}
              onClick={() => void loadReport()}
            >
              Synchroniser maintenant
            </Button>
          </div>
        }
        description="Activité des tickets sur une période. Les montants sont des valeurs théoriques conservées dans la devise choisie lors de chaque génération."
        eyebrow="Routeur"
        title="Rapport"
      />

      <Card className={`report-live-card report-live-card--${liveStatus}`}>
        <div className="report-live-status">
          <span className="report-live-status__icon">
            <RouterIcon aria-hidden="true" />
          </span>
          <div className="report-live-status__copy">
            <div className="button-row">
              <strong>Données RouterOS en direct</strong>
              <Badge status={reportLiveBadgeStatus(liveStatus)}>{reportLiveStatusLabel(liveStatus)}</Badge>
            </div>
            <span>
              {reportLiveDescription(liveStatus, lastLiveSyncAt, liveError)}
              {isRefreshing && liveStatus !== "connecting" ? " Actualisation en cours : les chiffres affichés restent ceux de la dernière lecture complète." : ""}
            </span>
          </div>
          <div className="report-live-status__facts">
            <span>Actualisation</span>
            <strong>15 secondes</strong>
            {routerOnlyCount > 0 ? <small>{routerOnlyCount} ticket(s) présent(s) uniquement sur le routeur</small> : null}
            {routerOnlyCount > 0 ? <small>Historique commercial incomplet : ces utilisateurs ne sont pas inclus dans les totaux TicketPro.</small> : null}
            {scopedTickets.some((ticket) => ticket.printedCount > 0 && ticket.printedAt.length === 0) ? (
              <small>Certaines impressions historiques sont sans date connue : elles figurent uniquement dans le total sans période.</small>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className="report-toolbar">
          <div className="tickets-count">
            <strong>Tickets ({filteredTickets.length})</strong>
            <span>
              Créés : {formatCurrencyTotals(summary.createdTheoreticalByCurrency)} · Activés : {formatCurrencyTotals(summary.activatedTheoreticalByCurrency)}
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
          <StatCard icon={Ticket} label="Créés" value={liveStatus !== "live" && scopedTickets.length === 0 ? "—" : String(summary.metrics.find((metric) => metric.id === "created")?.value ?? 0)} hint={formatCurrencyTotals(summary.createdTheoreticalByCurrency)} />
        </div>
        <div className="span-4">
          <StatCard icon={CheckCircle2} label="Activés" value={liveStatus !== "live" && scopedTickets.length === 0 ? "—" : String(summary.metrics.find((metric) => metric.id === "activated")?.value ?? 0)} hint={formatCurrencyTotals(summary.activatedTheoreticalByCurrency)} />
        </div>
        <div className="span-4">
          <StatCard icon={Trash2} label="Supprimés" value={liveStatus !== "live" && scopedTickets.length === 0 ? "—" : String(summary.metrics.find((metric) => metric.id === "deleted")?.value ?? 0)} hint="Manuels ou nettoyés par RouterOS" />
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
        <Card className="span-4 report-activity-card" title="Activité par plan">
          <div className="report-activity-scroll">
            <ReportGroupList groups={summary.byPlan} onOpen={openGroup} />
          </div>
        </Card>
        <Card className="span-4 report-activity-card" title="Activité par profil">
          <div className="report-activity-scroll">
            <ReportGroupList groups={summary.byOperator} onOpen={openGroup} />
          </div>
        </Card>
        <Card className="span-4 report-activity-card" title="Activité par jour">
          <div className="report-activity-scroll">
            <ReportGroupList groups={summary.byDay} onOpen={openGroup} />
          </div>
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
                  <div className="report-ticket-row__main">
                    <strong>{ticket.code}</strong>
                    <span>{ticket.planName}</span>
                    <span>{ticket.serverName} · {ticket.profileName}</span>
                    <span>{internalProfileLabel(ticket.createdByProfileId)}</span>
                    <Badge status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
                  </div>
                  <div className="report-ticket-row__runtime">
                    <span>{ticketActivityLabel(ticket)}</span>
                    <span>Utilisé : {formatSeconds(ticket.uptimeSeconds)}</span>
                    <span>Restant : {ticket.remainingSeconds === null ? "Illimité" : formatSeconds(ticket.remainingSeconds)}</span>
                    <span>Trafic : {formatBytes(ticket.downloadedBytes + ticket.uploadedBytes)}</span>
                    <span>Appareil : {ticket.macAddress || "Non lié"}</span>
                    <span>IP : {ticket.ipAddress || "Non attribuée"}</span>
                    <span>Lecture RouterOS : {ticket.lastRouterSyncAt ? formatReportDate(ticket.lastRouterSyncAt) : "En attente"}</span>
                  </div>
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
    const currencies = Array.from(new Set(filteredTickets.map((ticket) => ticket.currency || "CFA")));
    const currencyLabel = currencies.length === 1 ? currencies[0] : "multi-devises";
    const fileName = `rapport-${routerId}-${sanitizeReportFileSegment(currencyLabel)}-${stamp}.${format}`;
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
              priceLabel: formatMoney(ticket.priceHint, ticket.currency),
              router: ticket.routerName,
              status: ticket.status
            })),
            summary: [
              `Période: ${filters.dateFrom || "début"} au ${filters.dateTo || "aujourd'hui"}`,
              `Tickets visibles: ${filteredTickets.length}`,
              `Valeur créée: ${formatCurrencyTotals(summary.createdTheoreticalByCurrency)}`,
              `Valeur activée: ${formatCurrencyTotals(summary.activatedTheoreticalByCurrency)}`,
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
        const reportFileId = createId("report");
        await generatedFileRepository.create({
          account_id: session.account_id,
          batch_id: null,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          file_name: fileName,
          file_path: savedFile.relative_path,
          format,
          id: reportFileId,
          metadata_json: JSON.stringify({
            currencies,
            generated_at: new Date().toISOString(),
            ticket_count: filteredTickets.length
          }),
          router_id: routerId,
          sync_status: "local",
          type: format === "csv" ? "report_csv" : "report_pdf"
        });
        await organizationOperations?.publishFile(routerId, reportFileId).catch(() => undefined);
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

function reportLiveBadgeStatus(status: ReportLiveStatus): AppStatus {
  if (status === "live") return "success";
  if (status === "degraded") return "warning";
  if (status === "connecting") return "active";
  return "offline";
}

function reportLiveStatusLabel(status: ReportLiveStatus): string {
  if (status === "live") return "En direct";
  if (status === "degraded") return "Mode dégradé";
  if (status === "connecting") return "Synchronisation…";
  return "Données locales";
}

function reportLiveDescription(
  status: ReportLiveStatus,
  synchronizedAt: string | null,
  error: string | null
): string {
  if (status === "connecting") {
    return "Lecture des utilisateurs, sessions, compteurs, appareils et états réels du MikroTik…";
  }
  if (status === "degraded") {
    return `Dernières données disponibles conservées. ${error ?? "Le routeur est momentanément inaccessible."}`;
  }
  if (status === "live") {
    return synchronizedAt
      ? `Dernière lecture RouterOS réussie : ${formatReportDate(synchronizedAt)}.`
      : "Synchronisation RouterOS active.";
  }
  return "Le mode démonstration utilise uniquement les données locales.";
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
        {metric.totalByCurrency !== null ? <small>{formatCurrencyTotals(metric.totalByCurrency)}</small> : null}
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
            <small>{formatCurrencyTotals(group.theoreticalByCurrency)}</small>
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

function sanitizeReportFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 24) || "CFA";
}

