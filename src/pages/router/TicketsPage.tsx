import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Hash,
  History,
  KeyRound,
  Layers,
  Printer,
  RefreshCw,
  Router,
  Search,
  ShieldCheck,
  Smartphone,
  Ticket,
  Trash2,
  Upload,
  UserRound
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { CreateTicketInput } from "../../domain/database";
import type { UserRole } from "../../domain/auth";
import { resolveTicketPdfPassword } from "../../services/pdf";
import {
  LocalPrintService,
  printFormatLabel,
  type LocalPrinter,
  type PrintHistoryEntry,
  type PrintSettings
} from "../../services/printing";
import { createPersistedRouterService, FakeRouterAdapter, RouterService } from "../../services/router";
import { VoucherActionService } from "../../services/tickets";
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository,
  useAppDatabase
} from "../../services/database";
import {
  RouterTicketSyncService,
  syncStatusLabel,
  type RouterOnlyTicket,
  type RouterTicketSyncStatus,
  type SyncedTicketUpdate,
  type TicketSyncReport,
  type TicketSyncSummary
} from "../../services/sync";
import { ActionMenu, Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  buildTicketLifecycleLogs,
  canDeleteTicket,
  createDemoTickets,
  emptyTicketFilters,
  filterTickets,
  formatBytes,
  formatDataLimit,
  formatDateTime,
  formatDuration,
  getPageCount,
  paginateTickets,
  scopeTicketsForSession,
  ticketFromRecord,
  ticketPageSize,
  ticketStatusLabel,
  ticketStatusToBadge,
  type TicketFilters,
  type TicketListItem,
  type TicketListStatus
} from "./ticketsPageModel";

type TicketLog = {
  createdAt: string;
  message: string;
  ticketCode: string;
  type: "action" | "delete" | "sync";
};

export function TicketsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { routerId = "routeur-demo" } = useParams();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [tickets, setTickets] = useState<TicketListItem[]>(() => (isPersistent ? [] : createDemoTickets()));
  const [filters, setFilters] = useState<TicketFilters>(emptyTicketFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<TicketLog[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketListItem | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<TicketListItem | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [printers, setPrinters] = useState<LocalPrinter[]>([]);
  const [printHistory, setPrintHistory] = useState<PrintHistoryEntry[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    economical: true,
    format: "thermal80",
    printerId: "pdf-export"
  });
  const [syncSummary, setSyncSummary] = useState<TicketSyncSummary | null>(null);
  const [remoteOnlyTickets, setRemoteOnlyTickets] = useState<RouterOnlyTicket[]>([]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const batchRepository = useMemo(() => new TicketBatchRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const generatedFileRepository = useMemo(() => new GeneratedFileRepository(database), [database]);
  const printService = useMemo(() => new LocalPrintService(), []);
  const fakeRouterService = useMemo(
    () => new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }), authSession: session }),
    [session]
  );
  const [persistedRouterService, setPersistedRouterService] = useState<RouterService | null>(null);
  const effectiveRouterService = isPersistent ? persistedRouterService : fakeRouterService;
  const syncService = useMemo(
    () => new RouterTicketSyncService(effectiveRouterService ?? fakeRouterService),
    [effectiveRouterService, fakeRouterService]
  );
  const voucherActions = useMemo(
    () => effectiveRouterService ? new VoucherActionService(effectiveRouterService) : null,
    [effectiveRouterService]
  );

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) {
      setPersistedRouterService(null);
      return undefined;
    }

    let mounted = true;
    const accountId = session.account_id;

    async function prepareRouterService() {
      const router = await routerRepository.findById(routerId);
      if (!router || router.account_id !== accountId) throw new Error("Routeur introuvable pour ce compte.");
      const service = await createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(routerId),
        database,
        logger: { write: (log) => writeLog({ message: log.userMessage, ticketCode: "-", type: "sync" }) },
        router
      });
      if (mounted) setPersistedRouterService(service);
    }

    void prepareRouterService().catch((preparationError) => {
      if (mounted) setError(preparationError instanceof Error ? preparationError.message : "Connexion au routeur indisponible.");
    });
    return () => {
      mounted = false;
    };
  }, [connectionRepository, database, isInitialized, isPersistent, routerId, routerRepository, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) return undefined;
    let mounted = true;
    const accountId = session.account_id;

    async function loadTickets() {
      const [records, plans, router, files] = await Promise.all([
        ticketRepository.listByRouter(routerId),
        planRepository.listByRouter(routerId),
        routerRepository.findById(routerId),
        generatedFileRepository.listByAccount(accountId)
      ]);
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const fileByBatch = new Map(files.filter((file) => file.batch_id).map((file) => [file.batch_id as string, file.file_name]));
      const items = records
        .filter((record) => record.account_id === accountId)
        .map((record) => ticketFromRecord(record, planById.get(record.plan_id) ?? null, router?.name ?? routerId, fileByBatch.get(record.batch_id) ?? null));
      if (mounted) setTickets(items);
    }

    void loadTickets().catch((loadError) => {
      if (mounted) setError(loadError instanceof Error ? loadError.message : "Impossible de charger les vouchers.");
    });
    return () => {
      mounted = false;
    };
  }, [generatedFileRepository, isInitialized, isPersistent, planRepository, routerId, routerRepository, session, ticketRepository]);

  useEffect(() => {
    let mounted = true;
    void printService.detectPrinters().then((printerList) => {
      if (!mounted) return;
      const defaultPrinter = printService.getDefaultPrinter(printerList);
      setPrinters(printerList);
      setPrintSettings((current) => ({ ...current, printerId: defaultPrinter?.id ?? current.printerId }));
    }).catch(() => {
      if (mounted) setError("Impossible de détecter les imprimantes locales.");
    });
    return () => {
      mounted = false;
    };
  }, [printService]);

  const scopedTickets = useMemo(() => scopeTicketsForSession(tickets, session), [session, tickets]);
  const filterOptions = useMemo(() => buildFilterOptions(scopedTickets), [scopedTickets]);
  const filteredTickets = useMemo(() => filterTickets(scopedTickets, filters), [filters, scopedTickets]);
  const pageCount = getPageCount(filteredTickets.length, ticketPageSize);
  const currentPage = Math.min(page, pageCount);
  const visibleTickets = paginateTickets(filteredTickets, currentPage, ticketPageSize);
  const canRevealPasswords = Boolean(session?.permissions.includes("router.tickets.revealPassword"));

  const writeLog = (log: Omit<TicketLog, "createdAt">) => {
    setLogs((current) => [{ ...log, createdAt: new Date().toISOString() }, ...current]);
  };

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const updateFilters = (partial: Partial<TicketFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setPage(1);
    clearFeedback();
  };

  const persistTicket = async (ticket: TicketListItem) => {
    const input: CreateTicketInput = {
      account_id: ticket.accountId,
      activated_at: ticket.activatedAt,
      batch_id: ticket.batchId,
      completed_at: ticket.completedAt,
      created_by_profile: ticket.operatorProfile as CreateTicketInput["created_by_profile"],
      created_by_profile_id: ticket.createdByProfileId,
      deleted_at: ticket.status === "supprimé" ? new Date().toISOString() : null,
      downloaded_bytes: ticket.downloadedBytes,
      expires_at: ticket.expiresAt,
      id: ticket.id,
      ip_address: ticket.ipAddress,
      mac_address: ticket.macAddress,
      mikrotik_id: ticket.mikrotikId,
      password_encrypted: ticket.passwordSecretRef,
      plan_id: ticket.planId,
      printed_count: ticket.printedCount,
      router_id: ticket.routerId,
      status: ticket.status,
      sync_status: ticketSyncStatusToDatabase(ticket.syncStatus),
      uploaded_bytes: ticket.uploadedBytes,
      username: ticket.code
    };
    await ticketRepository.update(input);
  };

  const commitTicket = async (ticket: TicketListItem) => {
    if (isPersistent) await persistTicket(ticket);
    setTickets((current) => current.map((item) => (item.id === ticket.id ? ticket : item)));
    setSelectedTicket((current) => (current?.id === ticket.id ? ticket : current));
  };

  const applySyncReport = async (report: TicketSyncReport) => {
    const updates = new Map(report.updates.map((update) => [update.id, update]));
    const nextTickets = tickets.map((ticket) => mergeTicketUpdate(ticket, updates.get(ticket.id)));
    if (isPersistent) {
      await Promise.all(nextTickets.filter((ticket) => updates.has(ticket.id)).map((ticket) => persistTicket(ticket)));
    }
    setTickets(nextTickets);
    setSelectedTicket((current) => current ? mergeTicketUpdate(current, updates.get(current.id)) : null);
    setSyncSummary(report.summary);
    setRemoteOnlyTickets(report.localMissing);
    report.logs.slice(0, 8).forEach((log) => writeLog({ message: log.message, ticketCode: log.ticketCode ?? "-", type: "sync" }));
  };

  const requireRouterReady = (): boolean => {
    if (isPersistent && !persistedRouterService) {
      setError("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return false;
    }
    return true;
  };

  const markPrinted = async (ticket: TicketListItem) => {
    clearFeedback();
    const updated = { ...ticket, printedCount: ticket.printedCount + 1, status: "imprimé" as const };
    try {
      await commitTicket(updated);
      setMessage(`${ticket.code} marqué comme imprimé.`);
      writeLog({ message: "Voucher marqué comme imprimé.", ticketCode: ticket.code, type: "action" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Le statut d'impression n'a pas pu être enregistré.");
    }
  };

  const disableTicket = async (ticket: TicketListItem) => {
    if (ticket.status === "supprimé" || ticket.status === "complété") {
      setError("Action impossible sur ce voucher.");
      return;
    }
    if (!requireRouterReady() || !voucherActions) return;
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const result = await voucherActions.disable(ticket.code);
      const updated: TicketListItem = {
        ...ticket,
        status: "expiré",
        syncStatus: "router_synced"
      };
      await commitTicket(updated);
      setMessage(result.disconnected
        ? `${ticket.code} désactivé et session active déconnectée.`
        : `${ticket.code} désactivé sur RouterOS.`);
      writeLog({ message: "Voucher désactivé sur RouterOS.", ticketCode: ticket.code, type: "action" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Le voucher n'a pas pu être désactivé sur RouterOS.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const executeDeleteTicket = async () => {
    const ticket = ticketToDelete;
    if (!ticket) return;
    if (!canDeleteTicket(ticket)) {
      setTicketToDelete(null);
      setError("Suppression impossible : le voucher est déjà utilisé ou imprimé.");
      return;
    }
    if (!requireRouterReady()) return;
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const report = await syncService.removeTicket(ticket);
      if (report.summary.error > 0) {
        await applySyncReport(report);
        throw new Error(`${ticket.code} n'a pas été supprimé du routeur.`);
      }
      await applySyncReport(report);
      setTicketToDelete(null);
      setMessage(`${ticket.code} supprimé de RouterOS et de la liste active.`);
      writeLog({ message: "Suppression contrôlée du voucher.", ticketCode: ticket.code, type: "delete" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La suppression a échoué.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const syncTicket = async (ticket: TicketListItem) => {
    if (!requireRouterReady()) return;
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const report = await syncService.resyncTicket(ticket);
      await applySyncReport(report);
      setMessage(`${ticket.code} resynchronisé.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La resynchronisation a échoué.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const syncBatch = async (batchId: string) => {
    if (!requireRouterReady()) return;
    clearFeedback();
    try {
      const report = await syncService.resyncBatch(scopedTickets, batchId);
      await applySyncReport(report);
      setMessage(`Lot ${batchId} resynchronisé.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La resynchronisation du lot a échoué.");
    }
  };

  const resolveTicketConflict = async (ticket: TicketListItem) => {
    if (!requireRouterReady()) return;
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const report = await syncService.resolveConflict(ticket);
      await applySyncReport(report);
      setMessage(report.updates.some((update) => update.syncStatus === "router_synced")
        ? `${ticket.code} réaligné sur le plan local.`
        : `${ticket.code} reste en conflit.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Le conflit n'a pas pu être résolu.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const syncAllTickets = async () => {
    if (!requireRouterReady()) return;
    clearFeedback();
    try {
      const report = await syncService.compareTickets(scopedTickets);
      await applySyncReport(report);
      setMessage(`${report.summary.routerSynced} synchronisé(s), ${report.summary.routerMissing} absent(s) du routeur, ${report.summary.localMissing} absent(s) localement.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La synchronisation a échoué.");
    }
  };

  const resyncRouterTickets = async () => {
    if (!requireRouterReady()) return;
    clearFeedback();
    try {
      const report = await syncService.resyncRouter(scopedTickets);
      await applySyncReport(report);
      setMessage(`Réparation terminée : ${report.summary.routerSynced} synchronisé(s), ${report.summary.error} erreur(s).`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La réparation a échoué.");
    }
  };

  const importRemoteOnlyTickets = async () => {
    if (!isPersistent || !session) {
      setError("L'import des vouchers distants nécessite la base locale active.");
      return;
    }
    clearFeedback();
    const [localPlans, router] = await Promise.all([
      planRepository.listByRouter(routerId),
      routerRepository.findById(routerId)
    ]);
    const planByKey = new Map(localPlans.map((plan) => [plan.mikrotik_profile_name ?? plan.id, plan]));
    const imported: TicketListItem[] = [];
    const failed: string[] = [];

    for (const remoteTicket of remoteOnlyTickets) {
      if (tickets.some((ticket) => ticket.code === remoteTicket.code)) continue;
      try {
        const planKey = remoteTicket.profileName || remoteTicket.planId;
        let plan = planByKey.get(planKey) ?? planByKey.get(remoteTicket.planId);
        if (!plan) {
          const planId = `plan-import-${slugify(remoteTicket.profileName || remoteTicket.planId)}`;
          plan = await planRepository.create({
            data_limit_mb: null,
            download_limit: null,
            duration_minutes: 0,
            id: planId,
            mikrotik_profile_name: remoteTicket.profileName || remoteTicket.planId,
            name: remoteTicket.profileName || remoteTicket.planId,
            price_hint: null,
            router_id: routerId,
            shared_users: 1,
            status: "disabled",
            sync_status: "conflict",
            upload_limit: null,
            validity_minutes: null
          });
          planByKey.set(plan.mikrotik_profile_name ?? plan.id, plan);
        }

        const stamp = Date.now();
        const batchId = `batch-import-${slugify(remoteTicket.code)}-${stamp}`;
        const ticketId = `ticket-import-${slugify(remoteTicket.code)}-${stamp}`;
        const batch = {
          account_id: session.account_id,
          code_length: remoteTicket.code.length,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          generated_file_id: null,
          id: batchId,
          operator_profile: session.internal_profile_role,
          plan_id: plan.id,
          prefix: null,
          quantity: 1,
          router_id: routerId,
          status: "imported",
          sync_status: "synced" as const
        };
        await batchRepository.createWithTickets(batch, [{
          account_id: session.account_id,
          activated_at: null,
          batch_id: batchId,
          completed_at: null,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          deleted_at: null,
          downloaded_bytes: 0,
          expires_at: null,
          id: ticketId,
          ip_address: null,
          mac_address: null,
          mikrotik_id: remoteTicket.mikrotikId,
          password_encrypted: remoteTicket.passwordSecretRef,
          plan_id: plan.id,
          printed_count: 0,
          router_id: routerId,
          status: "disponible",
          sync_status: "synced",
          uploaded_bytes: 0,
          username: remoteTicket.code
        }]);
        const created = await ticketRepository.findById(ticketId);
        if (created) imported.push(ticketFromRecord(created, plan, router?.name ?? routerId));
      } catch {
        failed.push(remoteTicket.code);
      }
    }

    setTickets((current) => [...imported, ...current]);
    setRemoteOnlyTickets((current) => current.filter((ticket) => !imported.some((item) => item.code === ticket.code)));
    setSyncSummary((current) => current ? { ...current, localMissing: Math.max(0, current.localMissing - imported.length) } : current);
    setMessage(failed.length > 0
      ? `${imported.length} voucher(s) importé(s), ${failed.length} échec(s).`
      : `${imported.length} voucher(s) importé(s) depuis le routeur.`);
  };

  const testPrinter = async () => {
    clearFeedback();
    try {
      const printResult = await printService.testPrinter({ printers, settings: printSettings });
      setPrintHistory((current) => [printResult.historyEntry, ...current]);
      setMessage(printResult.userMessage);
      writeLog({ message: "Test imprimante demandé.", ticketCode: "-", type: "action" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Le test imprimante a échoué.");
    }
  };

  const reprintTicket = async (ticket: TicketListItem) => {
    clearFeedback();
    setBusyTicketId(ticket.id);
    try {
      const printResult = await printService.printTicket({
        printers,
        settings: printSettings,
        ticket: buildPrintTicketFromTicket(ticket)
      });
      setPrintHistory((current) => [printResult.historyEntry, ...current]);
      if (!printResult.ok) {
        setError(printResult.userMessage);
        return;
      }
      const updated = { ...ticket, printedCount: ticket.printedCount + 1, status: "imprimé" as const };
      await commitTicket(updated);
      setMessage(`${ticket.code} envoyé vers la réimpression.`);
      writeLog({ message: "Réimpression effectuée.", ticketCode: ticket.code, type: "action" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La réimpression a échoué.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const exportTicket = (ticket: TicketListItem) => {
    downloadTicketsCsv([ticket], `voucher-${slugify(ticket.code)}.csv`, canRevealPasswords);
    setMessage(`${ticket.code} exporté.`);
    writeLog({ message: "Export CSV effectué.", ticketCode: ticket.code, type: "action" });
  };

  const exportVisibleTickets = () => {
    if (filteredTickets.length === 0) {
      setError("Aucun voucher à exporter avec les filtres actuels.");
      return;
    }
    downloadTicketsCsv(filteredTickets, `vouchers-${routerId}-${new Date().toISOString().slice(0, 10)}.csv`, canRevealPasswords);
    setMessage(`${filteredTickets.length} voucher(s) exporté(s).`);
  };

  const resetFilters = () => {
    setFilters(emptyTicketFilters);
    setPage(1);
    clearFeedback();
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button icon={Ticket} onClick={() => navigate(`/routeurs/${routerId}/tickets/generation`)} size="large" variant="primary">Créer des tickets</Button>
            <Button icon={Download} onClick={exportVisibleTickets}>Exporter</Button>
            <Button icon={RefreshCw} onClick={() => void syncAllTickets()}>Synchroniser</Button>
            {session?.internal_profile_role === "admin" ? (
              <Button icon={ShieldCheck} onClick={() => void resyncRouterTickets()} variant="secondary">Réparer absents</Button>
            ) : null}
          </div>
        }
        description="Chaque action attend maintenant la confirmation de RouterOS et de SQLite avant d'afficher un succès."
        eyebrow="Routeur"
        title="Tickets"
      />

      <Card>
        <div className="tickets-toolbar">
          <div className="tickets-count">
            <strong>Articles ({filteredTickets.length})</strong>
            <span>{scopedTickets.length} vouchers visibles · Logs : {logs.length}{syncSummary ? ` · Sync : ${syncSummary.routerSynced}/${syncSummary.totalLocal}` : ""}</span>
          </div>
          <label className="date-field">Depuis<input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} /></label>
          <label className="date-field">À<input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} /></label>
          <label className="tickets-search"><Search aria-hidden="true" /><input placeholder="Code ticket" value={filters.code} onChange={(event) => updateFilters({ code: event.target.value })} /></label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>Filtres</Button>
        </div>
        {filtersOpen ? <TicketFiltersPanel filters={filters} options={filterOptions} onChange={updateFilters} onReset={resetFilters} /> : null}
      </Card>

      {remoteOnlyTickets.length > 0 ? (
        <Card title="Tickets présents sur le routeur" description="Ces vouchers n'existent pas encore dans SQLite local.">
          <div className="button-row"><span className="muted-inline">{remoteOnlyTickets.length} voucher(s) à importer</span><Button disabled={!isPersistent} icon={Download} onClick={() => void importRemoteOnlyTickets()} variant="secondary">Importer dans TicketPro</Button></div>
        </Card>
      ) : null}

      {message ? <p className="form-error form-error--success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <Card title="Préparation impression" description="Réglez l'impression thermique sans bloquer l'export CSV.">
        <div className="print-setup-grid">
          <label className="form-field">Imprimante<select value={printSettings.printerId} onChange={(event) => setPrintSettings((current) => ({ ...current, printerId: event.target.value }))}>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}</select></label>
          <label className="form-field">Format<select value={printSettings.format} onChange={(event) => setPrintSettings((current) => ({ ...current, format: event.target.value as PrintSettings["format"] }))}><option value="thermal58">58 mm</option><option value="thermal80">80 mm</option><option value="a4">A4</option></select></label>
          <label className="toggle-option print-economy-toggle"><input checked={printSettings.economical} onChange={(event) => setPrintSettings((current) => ({ ...current, economical: event.target.checked }))} type="checkbox" /><Printer aria-hidden="true" /><span>Impression économique</span></label>
          <Button icon={Printer} onClick={() => void testPrinter()}>Tester imprimante</Button>
        </div>
        {printHistory.length > 0 ? <div className="print-history-inline">{printHistory.slice(0, 3).map((entry) => <span key={entry.id}>{entry.userMessage} · {printFormatLabel(entry.format)}</span>)}</div> : null}
      </Card>

      <Card className="tickets-list-card">
        {visibleTickets.length > 0 ? (
          <div className="ticket-list">
            {visibleTickets.map((ticket) => (
              <TicketRow
                busy={busyTicketId === ticket.id}
                key={ticket.id}
                onDelete={() => setTicketToDelete(ticket)}
                onDisable={() => void disableTicket(ticket)}
                onExport={() => exportTicket(ticket)}
                onMarkPrinted={() => void markPrinted(ticket)}
                onOpen={() => setSelectedTicket(ticket)}
                onReprint={() => void reprintTicket(ticket)}
                onResolveConflict={() => void resolveTicketConflict(ticket)}
                onSync={() => void syncTicket(ticket)}
                onSyncBatch={() => void syncBatch(ticket.batchId)}
                role={session?.internal_profile_role ?? "guest"}
                ticket={ticket}
              />
            ))}
          </div>
        ) : (
          <EmptyState action={<Button icon={Filter} onClick={resetFilters}>Réinitialiser les filtres</Button>} description="Aucun voucher ne correspond aux critères." icon={Search} title="Aucun voucher trouvé" />
        )}
        <div className="pagination-row">
          <Button disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} variant="ghost">Précédent</Button>
          <span>Page {currentPage} / {pageCount}</span>
          <Button disabled={currentPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} variant="ghost">Suivant</Button>
        </div>
      </Card>

      <TicketDetailDialog
        actionLogs={logs}
        busy={Boolean(selectedTicket && busyTicketId === selectedTicket.id)}
        onClose={() => setSelectedTicket(null)}
        onDelete={(ticket) => setTicketToDelete(ticket)}
        onDisable={(ticket) => void disableTicket(ticket)}
        onReprint={(ticket) => void reprintTicket(ticket)}
        onResolveConflict={(ticket) => void resolveTicketConflict(ticket)}
        onSync={(ticket) => void syncTicket(ticket)}
        role={session?.internal_profile_role ?? "guest"}
        ticket={selectedTicket}
      />
      <DeleteTicketDialog
        busy={Boolean(ticketToDelete && busyTicketId === ticketToDelete.id)}
        onCancel={() => setTicketToDelete(null)}
        onConfirm={() => void executeDeleteTicket()}
        ticket={ticketToDelete}
      />
    </div>
  );
}

function mergeTicketUpdate(ticket: TicketListItem, update?: SyncedTicketUpdate): TicketListItem {
  if (!update) return ticket;
  return {
    ...ticket,
    activatedAt: update.activatedAt === undefined ? ticket.activatedAt : update.activatedAt,
    ipAddress: update.ipAddress === undefined ? ticket.ipAddress : update.ipAddress,
    macAddress: update.macAddress === undefined ? ticket.macAddress : update.macAddress,
    mikrotikId: update.mikrotikId === undefined ? ticket.mikrotikId : update.mikrotikId,
    status: (update.status as TicketListStatus | undefined) ?? ticket.status,
    syncStatus: update.syncStatus
  };
}

function ticketSyncStatusToDatabase(status: RouterTicketSyncStatus): "conflict" | "local" | "pending" | "synced" {
  if (status === "router_synced") return "synced";
  if (status === "conflict" || status === "local_missing") return "conflict";
  if (status === "error" || status === "router_missing") return "pending";
  return "local";
}

function TicketRow({
  busy,
  onDelete,
  onDisable,
  onExport,
  onMarkPrinted,
  onOpen,
  onReprint,
  onResolveConflict,
  onSync,
  onSyncBatch,
  role,
  ticket
}: {
  busy: boolean;
  onDelete: () => void;
  onDisable: () => void;
  onExport: () => void;
  onMarkPrinted: () => void;
  onOpen: () => void;
  onReprint: () => void;
  onResolveConflict: () => void;
  onSync: () => void;
  onSyncBatch: () => void;
  role: UserRole;
  ticket: TicketListItem;
}) {
  const permissions = getTicketActionPermissions(role, ticket);
  const menuItems = [{ icon: Eye, label: "Voir détail", onSelect: onOpen }];
  if (permissions.canReprint) {
    menuItems.push({ icon: Printer, label: "Réimprimer", onSelect: onReprint });
    menuItems.push({ icon: CheckCircle2, label: "Marquer imprimé", onSelect: onMarkPrinted });
  }
  if (role !== "guest") menuItems.push({ icon: Download, label: "Exporter", onSelect: onExport });
  if (permissions.canDisable) menuItems.push({ icon: Ban, label: "Désactiver", onSelect: onDisable });
  if (permissions.canSync) {
    menuItems.push({ icon: RefreshCw, label: "Resynchroniser", onSelect: onSync });
    menuItems.push({ icon: Layers, label: "Resynchroniser le lot", onSelect: onSyncBatch });
    if (ticket.syncStatus === "conflict") menuItems.push({ icon: CheckCircle2, label: "Conserver le plan local", onSelect: onResolveConflict });
  }
  if (permissions.canDelete) menuItems.push({ icon: Trash2, label: "Supprimer", onSelect: onDelete });

  return (
    <article
      aria-busy={busy}
      className="ticket-row ticket-row--compact"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="ticket-row__identity">
        <span className="ticket-row__icon"><Ticket aria-hidden="true" /></span>
        <div className="ticket-row__body">
          <div className="ticket-row__top">
            <div className="ticket-row__code"><strong>{ticket.code}</strong>{ticket.hasPdf ? <FileText aria-label="PDF" /> : null}</div>
            <div className="ticket-row__badges">
              <Badge className="ticket-row__badge" status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
              <Badge className="ticket-row__badge" status={syncStatusToBadge(ticket.syncStatus)}>{syncStatusLabel(ticket.syncStatus)}</Badge>
              {busy ? <Badge status="warning">Action en cours</Badge> : null}
            </div>
          </div>
          <div className="ticket-row__facts"><span><FileText aria-hidden="true" />{ticket.planName}</span><span><Calendar aria-hidden="true" />{formatDateTime(ticket.createdAt)}</span>{ticket.macAddress ? <span><Smartphone aria-hidden="true" />{ticket.macAddress}</span> : null}</div>
        </div>
      </div>
      <ActionMenu items={menuItems} />
    </article>
  );
}

function TicketDetailDialog({
  actionLogs,
  busy,
  onClose,
  onDelete,
  onDisable,
  onReprint,
  onResolveConflict,
  onSync,
  role,
  ticket
}: {
  actionLogs: TicketLog[];
  busy: boolean;
  onClose: () => void;
  onDelete: (ticket: TicketListItem) => void;
  onDisable: (ticket: TicketListItem) => void;
  onReprint: (ticket: TicketListItem) => void;
  onResolveConflict: (ticket: TicketListItem) => void;
  onSync: (ticket: TicketListItem) => void;
  role: UserRole;
  ticket: TicketListItem | null;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  useEffect(() => setPasswordVisible(false), [ticket?.id]);
  if (!ticket) return null;
  const permissions = getTicketActionPermissions(role, ticket);
  const logs = [
    ...buildTicketLifecycleLogs(ticket),
    ...actionLogs.filter((log) => log.ticketCode === ticket.code).map((log, index) => ({
      createdAt: log.createdAt,
      id: `${ticket.id}-action-${index}`,
      level: log.type === "delete" ? "warning" as const : "info" as const,
      message: log.message
    }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const password = passwordVisible && permissions.canRevealPassword
    ? resolveTicketPdfPassword({ passwordSecretRef: ticket.passwordSecretRef, username: ticket.code })
    : "••••••";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog ticket-detail-dialog" role="dialog">
        <header className="ticket-detail-header">
          <div className="ticket-detail-header__identity"><div className="router-card__icon"><Ticket aria-hidden="true" /></div><div><p className="ticket-detail-header__eyebrow">Détail voucher</p><h2>{ticket.code}</h2><p>{ticket.planName} · {ticket.routerName}</p></div></div>
          <Badge status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
        </header>
        <div className="ticket-detail-layout">
          <section className="ticket-detail-section">
            <h3>Informations principales</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Ticket} label="Code" value={ticket.code} />
              <PasswordDetailLine canReveal={permissions.canRevealPassword} isVisible={passwordVisible} onToggle={() => setPasswordVisible((current) => !current)} value={password} />
              <DetailLine icon={FileText} label="Plan" value={ticket.planName} />
              <DetailLine icon={Router} label="Routeur" value={ticket.routerName} />
              <DetailLine icon={Layers} label="Lot" value={ticket.batchId} />
              <DetailLine icon={ShieldCheck} label="Statut" value={ticketStatusLabel(ticket.status)} />
              <DetailLine icon={RefreshCw} label="Synchronisation" value={syncStatusLabel(ticket.syncStatus)} />
              <DetailLine icon={UserRound} label="Créé par" value={profileLabel(ticket.operatorProfile)} />
              <DetailLine icon={Hash} label="ID MikroTik" value={ticket.mikrotikId ?? "Non disponible"} />
            </dl>
          </section>
          <section className="ticket-detail-section">
            <h3>Cycle de vie</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Calendar} label="Date création" value={formatDateTime(ticket.createdAt)} />
              <DetailLine icon={CheckCircle2} label="Date activation" value={formatDateTime(ticket.activatedAt)} />
              <DetailLine icon={CheckCircle2} label="Date complétion" value={formatDateTime(ticket.completedAt)} />
              <DetailLine icon={Clock} label="Date expiration" value={formatDateTime(ticket.expiresAt)} />
              <DetailLine icon={Clock} label="Durée" value={formatDuration(ticket.planDurationMinutes)} />
              <DetailLine icon={Clock} label="Validité" value={formatDuration(ticket.planValidityMinutes)} />
              <DetailLine icon={Database} label="Volume prévu" value={formatDataLimit(ticket.dataLimitMb)} />
            </dl>
          </section>
          <section className="ticket-detail-section">
            <h3>Utilisation client</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Smartphone} label="MAC client" value={ticket.macAddress ?? "Non disponible"} />
              <DetailLine icon={Smartphone} label="IP client" value={ticket.ipAddress ?? "Non disponible"} />
              <DetailLine icon={Upload} label="Upload" value={formatBytes(ticket.uploadedBytes)} />
              <DetailLine icon={Download} label="Download" value={formatBytes(ticket.downloadedBytes)} />
              <DetailLine icon={Printer} label="Impressions" value={`${ticket.printedCount}`} />
              <DetailLine icon={FileText} label="Fichier PDF" value={ticket.generatedFileName ?? "Non disponible"} />
            </dl>
          </section>
          <section className="ticket-detail-section ticket-detail-section--logs">
            <h3>Historique</h3>
            <div className="ticket-log-list">{logs.map((log) => <div className={`ticket-log ticket-log--${log.level}`} key={log.id}><History aria-hidden="true" /><div><strong>{formatDateTime(log.createdAt)}</strong><span>{log.message}</span></div></div>)}</div>
          </section>
        </div>
        <div className="ticket-detail-actions">
          {permissions.canReprint ? <Button disabled={busy} icon={Printer} onClick={() => onReprint(ticket)}>Réimprimer</Button> : null}
          {permissions.canDisable ? <Button disabled={busy} icon={Ban} onClick={() => onDisable(ticket)} variant="ghost">Désactiver</Button> : null}
          {permissions.canSync ? <Button disabled={busy} icon={RefreshCw} onClick={() => onSync(ticket)} variant="ghost">Resynchroniser</Button> : null}
          {permissions.canSync && ticket.syncStatus === "conflict" ? <Button disabled={busy} icon={CheckCircle2} onClick={() => onResolveConflict(ticket)} variant="ghost">Conserver le plan local</Button> : null}
          {permissions.canDelete ? <Button disabled={busy} icon={Trash2} onClick={() => onDelete(ticket)} variant="danger">Supprimer</Button> : null}
          <Button onClick={onClose} variant="primary">Fermer</Button>
        </div>
      </section>
    </div>
  );
}

function DeleteTicketDialog({
  busy,
  onCancel,
  onConfirm,
  ticket
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  ticket: TicketListItem | null;
}) {
  if (!ticket) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="connection-dialog" role="dialog">
        <header className="connection-dialog__header"><div className="router-card__icon"><Trash2 aria-hidden="true" /></div><div><h2>Supprimer {ticket.code} ?</h2><p>Le voucher sera supprimé sur RouterOS avant d'être masqué dans TicketPro.</p></div></header>
        <div className="confirm-dialog__actions"><Button disabled={busy} onClick={onCancel} variant="ghost">Annuler</Button><Button disabled={busy} icon={Trash2} onClick={onConfirm} variant="danger">{busy ? "Suppression…" : "Supprimer"}</Button></div>
      </section>
    </div>
  );
}

function DetailLine({ icon: Icon, label, value }: { icon: IconComponent; label: string; value: string }) {
  return <div><dt><Icon aria-hidden="true" /><span>{label}</span></dt><dd>{value}</dd></div>;
}

function PasswordDetailLine({
  canReveal,
  isVisible,
  onToggle,
  value
}: {
  canReveal: boolean;
  isVisible: boolean;
  onToggle: () => void;
  value: string;
}) {
  return (
    <div><dt><KeyRound aria-hidden="true" /><span>Mot de passe</span></dt><dd className="ticket-password-value"><span>{value}</span>{canReveal ? <button aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={onToggle} type="button">{isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button> : <small>Masqué</small>}</dd></div>
  );
}

function getTicketActionPermissions(role: UserRole, ticket: TicketListItem) {
  if (role === "admin") return { canDelete: canDeleteTicket(ticket), canDisable: ticket.status !== "supprimé" && ticket.status !== "complété", canRevealPassword: true, canReprint: true, canSync: true };
  if (role === "operator") return { canDelete: false, canDisable: false, canRevealPassword: false, canReprint: true, canSync: false };
  if (role === "agent") return { canDelete: false, canDisable: false, canRevealPassword: false, canReprint: ticket.operatorProfile === "agent", canSync: false };
  return { canDelete: false, canDisable: false, canRevealPassword: false, canReprint: false, canSync: false };
}

function syncStatusToBadge(status: RouterTicketSyncStatus): AppStatus {
  if (status === "router_synced") return "success";
  if (status === "error") return "error";
  if (status === "conflict" || status === "local_missing" || status === "router_missing") return "warning";
  return "offline";
}

function buildPrintTicketFromTicket(ticket: TicketListItem) {
  return {
    batchId: ticket.batchId,
    code: ticket.code,
    dataLimitLabel: formatDataLimit(ticket.dataLimitMb),
    durationLabel: formatDuration(ticket.planDurationMinutes),
    id: ticket.id,
    passwordLabel: resolveTicketPdfPassword({ passwordSecretRef: ticket.passwordSecretRef, username: ticket.code }),
    planName: ticket.planName,
    zoneName: ticket.routerName
  };
}

function downloadTicketsCsv(tickets: TicketListItem[], fileName: string, includePassword: boolean): void {
  const headers = ["Code", ...(includePassword ? ["Mot de passe"] : []), "Plan", "Statut", "Synchronisation", "Routeur", "Lot", "Créé le", "MAC", "IP", "Téléchargé", "Envoyé"];
  const rows = tickets.map((ticket) => [
    ticket.code,
    ...(includePassword ? [resolveTicketPdfPassword({ passwordSecretRef: ticket.passwordSecretRef, username: ticket.code })] : []),
    ticket.planName,
    ticketStatusLabel(ticket.status),
    syncStatusLabel(ticket.syncStatus),
    ticket.routerName,
    ticket.batchId,
    ticket.createdAt,
    ticket.macAddress ?? "",
    ticket.ipAddress ?? "",
    String(ticket.downloadedBytes),
    String(ticket.uploadedBytes)
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voucher";
}

type FilterOptions = {
  batches: string[];
  operators: string[];
  plans: Array<{ id: string; name: string }>;
  routers: Array<{ id: string; name: string }>;
  statuses: TicketListStatus[];
};

function TicketFiltersPanel({
  filters,
  onChange,
  onReset,
  options
}: {
  filters: TicketFilters;
  onChange: (partial: Partial<TicketFilters>) => void;
  onReset: () => void;
  options: FilterOptions;
}) {
  return (
    <div className="tickets-filter-panel">
      <label className="form-field">Plan<select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}><option value="">Tous les plans</option>{options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
      <label className="form-field">Profil<select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}><option value="">Tous les profils</option>{options.operators.map((operator) => <option key={operator} value={operator}>{profileLabel(operator)}</option>)}</select></label>
      <label className="form-field">Statut<select value={filters.status} onChange={(event) => onChange({ status: event.target.value as TicketFilters["status"] })}><option value="">Tous les statuts</option>{options.statuses.map((status) => <option key={status} value={status}>{ticketStatusLabel(status)}</option>)}</select></label>
      <label className="form-field">Lot<select value={filters.batchId} onChange={(event) => onChange({ batchId: event.target.value })}><option value="">Tous les lots</option>{options.batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}</select></label>
      <label className="form-field">Routeur<select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}><option value="">Tous les routeurs</option>{options.routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select></label>
      <label className="form-field">Recherche MAC<input placeholder="A8:6B..." value={filters.macAddress} onChange={(event) => onChange({ macAddress: event.target.value })} /></label>
      <div className="tickets-filter-panel__actions"><Button onClick={onReset} variant="ghost">Réinitialiser</Button></div>
    </div>
  );
}

function buildFilterOptions(tickets: TicketListItem[]): FilterOptions {
  return {
    batches: unique(tickets.map((ticket) => ticket.batchId)),
    operators: unique(tickets.map((ticket) => ticket.operatorProfile)),
    plans: uniqueBy(tickets.map((ticket) => ({ id: ticket.planId, name: ticket.planName })), (plan) => plan.id),
    routers: uniqueBy(tickets.map((ticket) => ({ id: ticket.routerId, name: ticket.routerName })), (router) => router.id),
    statuses: unique(tickets.map((ticket) => ticket.status))
  };
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const map = new Map<string, T>();
  values.forEach((value) => map.set(getKey(value), value));
  return Array.from(map.values());
}

function profileLabel(profile: string): string {
  return ({ admin: "Admin", agent: "Agent", guest: "Invité", operator: "Opérateur" } as Record<string, string>)[profile] ?? profile;
}
