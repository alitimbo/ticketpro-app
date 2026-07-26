import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Ban,
  Calendar,
  Clock,
  CheckCircle2,
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
  const [logs, setLogs] = useState<TicketLog[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketListItem | null>(null);
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
  const routerService = useMemo(
    () => new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }), authSession: session }),
    [session]
  );
  const [persistedRouterService, setPersistedRouterService] = useState<RouterService | null>(null);
  const syncService = useMemo(
    () => new RouterTicketSyncService(isPersistent ? persistedRouterService ?? routerService : routerService),
    [isPersistent, persistedRouterService, routerService]
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

      if (!router || router.account_id !== accountId) {
        return;
      }

      const serviceForRouter = await createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(routerId),
        database,
        logger: { write: (log) => writeLog({ message: log.userMessage, ticketCode: "-", type: "sync" }) },
        router
      });

      if (mounted) {
        setPersistedRouterService(serviceForRouter);
      }
    }

    void prepareRouterService().catch((error) => {
      if (mounted) {
        setMessage(error instanceof Error ? error.message : "Connexion au routeur indisponible.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [connectionRepository, isInitialized, isPersistent, routerId, routerRepository, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) {
      return undefined;
    }

    let mounted = true;
    const accountId = session.account_id;

    async function loadTickets() {
      const [records, plans, router, files] = await Promise.all([
        ticketRepository.listByRouter(routerId),
        planRepository.listByRouter(routerId),
        routerRepository.findById(routerId),
        generatedFileRepository.listByAccount(accountId)
      ]);
      const accountRecords = records.filter((record) => record.account_id === accountId);
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const fileByBatch = new Map(files.filter((file) => file.batch_id).map((file) => [file.batch_id as string, file.file_name]));

      if (mounted) {
        setTickets(accountRecords.map((record) => ticketFromRecord(record, planById.get(record.plan_id) ?? null, router?.name ?? routerId, fileByBatch.get(record.batch_id) ?? null)));
      }
    }

    void loadTickets();

    return () => {
      mounted = false;
    };
  }, [generatedFileRepository, isInitialized, isPersistent, planRepository, routerId, routerRepository, session, ticketRepository]);

  useEffect(() => {
    let mounted = true;

    async function loadPrinters() {
      const printerList = await printService.detectPrinters();
      const defaultPrinter = printService.getDefaultPrinter(printerList);

      if (!mounted) {
        return;
      }

      setPrinters(printerList);
      setPrintSettings((current) => ({ ...current, printerId: defaultPrinter?.id ?? current.printerId }));
    }

    void loadPrinters();

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

  const updateFilters = (partial: Partial<TicketFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setPage(1);
    setMessage(null);
  };

  const writeLog = (log: Omit<TicketLog, "createdAt">) => {
    setLogs((current) => [{ ...log, createdAt: new Date().toISOString() }, ...current]);
  };

  const updateTicket = (ticketId: string, updater: (ticket: TicketListItem) => TicketListItem) => {
    const currentTicket = tickets.find((item) => item.id === ticketId);
    const updatedTicket = currentTicket ? updater(currentTicket) : null;

    if (!updatedTicket) {
      return;
    }

    setTickets((current) => current.map((item) => (item.id === ticketId ? updatedTicket : item)));
    setSelectedTicket((current) => (current?.id === ticketId ? updatedTicket : current));

    if (isPersistent) {
      void persistTicket(updatedTicket).catch(() => {
        setMessage("Le ticket a été modifié à l'écran mais n'a pas pu être enregistré.");
      });
    }
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
      sync_status: ticket.syncStatus === "router_synced" ? "synced" : ticket.syncStatus === "conflict" ? "conflict" : ticket.syncStatus === "error" ? "pending" : "local",
      uploaded_bytes: ticket.uploadedBytes,
      username: ticket.code
    };

    await ticketRepository.update(input);
  };

  const markPrinted = (ticket: TicketListItem) => {
    updateTicket(ticket.id, (item) => ({ ...item, printedCount: item.printedCount + 1, status: "imprimé" }));
    setMessage(`${ticket.code} marqué comme imprimé.`);
    writeLog({ message: "Ticket marqué comme imprimé.", ticketCode: ticket.code, type: "action" });
  };

  const disableTicket = (ticket: TicketListItem) => {
    if (ticket.status === "supprimé" || ticket.status === "complété") {
      setMessage("Action impossible sur ce ticket.");
      return;
    }

    updateTicket(ticket.id, (item) => ({ ...item, status: "expiré" }));
    setMessage(`${ticket.code} désactivé.`);
    writeLog({ message: "Ticket désactivé.", ticketCode: ticket.code, type: "action" });
  };

  const deleteTicket = async (ticket: TicketListItem) => {
    if (!canDeleteTicket(ticket)) {
      setMessage("Suppression impossible : le ticket est déjà utilisé ou imprimé.");
      return;
    }

    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }

    const report = await syncService.removeTicket(ticket);

    if (report.summary.error > 0) {
      applySyncReport(report);
      setMessage(`${ticket.code} n'a pas été supprimé du routeur.`);
      return;
    }

    applySyncReport(report);
    setMessage(`${ticket.code} supprimé.`);
    writeLog({ message: "Suppression contrôlée du ticket.", ticketCode: ticket.code, type: "delete" });
  };

  const syncTicket = async (ticket: TicketListItem) => {
    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }
    const report = await syncService.resyncTicket(ticket);
    applySyncReport(report);
    setMessage(`${ticket.code} resynchronisé.`);
  };

  const exportTicket = (ticket: TicketListItem) => {
    setMessage(`${ticket.code} prêt pour export.`);
    writeLog({ message: "Export demandé.", ticketCode: ticket.code, type: "action" });
  };

  const resolveTicketConflict = async (ticket: TicketListItem) => {
    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }

    const report = await syncService.resolveConflict(ticket);
    applySyncReport(report);
    setMessage(
      report.updates.some((update) => update.syncStatus === "router_synced")
        ? `${ticket.code} réaligné sur le plan local.`
        : `${ticket.code} reste en conflit.`
    );
  };

  const applySyncReport = (report: TicketSyncReport) => {
    setTickets((current) =>
      current.map((ticket) => {
        const update = report.updates.find((item) => item.id === ticket.id);

        return update
          ? {
              ...ticket,
              activatedAt: update.activatedAt === undefined ? ticket.activatedAt : update.activatedAt,
              ipAddress: update.ipAddress === undefined ? ticket.ipAddress : update.ipAddress,
              macAddress: update.macAddress === undefined ? ticket.macAddress : update.macAddress,
              mikrotikId: update.mikrotikId === undefined ? ticket.mikrotikId : update.mikrotikId,
              status: (update.status as TicketListStatus | undefined) ?? ticket.status,
              syncStatus: update.syncStatus
            }
          : ticket;
      })
    );
    setSelectedTicket((current) => {
      if (!current) {
        return null;
      }

      const update = report.updates.find((item) => item.id === current.id);

      return update
        ? {
            ...current,
            activatedAt: update.activatedAt === undefined ? current.activatedAt : update.activatedAt,
            ipAddress: update.ipAddress === undefined ? current.ipAddress : update.ipAddress,
            macAddress: update.macAddress === undefined ? current.macAddress : update.macAddress,
            mikrotikId: update.mikrotikId === undefined ? current.mikrotikId : update.mikrotikId,
            status: (update.status as TicketListStatus | undefined) ?? current.status,
            syncStatus: update.syncStatus
          }
        : current;
    });
    if (isPersistent) {
      report.updates.forEach((update) => {
        const current = tickets.find((ticket) => ticket.id === update.id);

        if (!current) {
          return;
        }

        void persistTicket({
          ...current,
          activatedAt: update.activatedAt === undefined ? current.activatedAt : update.activatedAt,
          ipAddress: update.ipAddress === undefined ? current.ipAddress : update.ipAddress,
          macAddress: update.macAddress === undefined ? current.macAddress : update.macAddress,
          mikrotikId: update.mikrotikId === undefined ? current.mikrotikId : update.mikrotikId,
          status: (update.status as TicketListStatus | undefined) ?? current.status,
          syncStatus: update.syncStatus
        }).catch(() => undefined);
      });
    }
    setSyncSummary(report.summary);
    setRemoteOnlyTickets(report.localMissing);
    report.logs.slice(0, 8).forEach((log) =>
      writeLog({ message: log.message, ticketCode: log.ticketCode ?? "-", type: "sync" })
    );
  };

  const syncAllTickets = async () => {
    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }
    const report = await syncService.compareTickets(scopedTickets);
    applySyncReport(report);
    setMessage(
      `${report.summary.routerSynced} synchronisé(s), ${report.summary.routerMissing} absent(s) du routeur, ${report.summary.localMissing} absent(s) localement.`
    );
  };

  const syncBatch = async (batchId: string) => {
    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }
    const report = await syncService.resyncBatch(scopedTickets, batchId);
    applySyncReport(report);
    setMessage(`Lot ${batchId} resynchronisé.`);
  };

  const resyncRouterTickets = async () => {
    if (isPersistent && !persistedRouterService) {
      setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
      return;
    }
    const report = await syncService.resyncRouter(scopedTickets);
    applySyncReport(report);
    setMessage(
      `Resynchronisation terminée : ${report.summary.routerSynced} synchronisé(s), ${report.summary.error} erreur(s).`
    );
  };

  const importRemoteOnlyTickets = async () => {
    if (!isPersistent || !session) {
      setMessage("L'import des tickets distants nécessite la base locale active.");
      return;
    }

    const [localPlans, router] = await Promise.all([
      planRepository.listByRouter(routerId),
      routerRepository.findById(routerId)
    ]);
    const planByKey = new Map(localPlans.map((plan) => [plan.mikrotik_profile_name ?? plan.id, plan]));
    const imported: TicketListItem[] = [];
    const failed: string[] = [];

    for (const remoteTicket of remoteOnlyTickets) {
      if (tickets.some((ticket) => ticket.code === remoteTicket.code)) {
        continue;
      }

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

        const batchId = `batch-import-${slugify(remoteTicket.code)}-${Date.now()}`;
        const ticketId = `ticket-import-${slugify(remoteTicket.code)}-${Date.now()}`;
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
        await batchRepository.createWithTickets(batch, [
          {
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
          }
        ]);

        const created = await ticketRepository.findById(ticketId);

        if (created) {
          imported.push(ticketFromRecord(created, plan, router?.name ?? routerId));
        }
      } catch {
        failed.push(remoteTicket.code);
      }
    }

    setTickets((current) => [...imported, ...current]);
    setRemoteOnlyTickets((current) => current.filter((ticket) => !imported.some((item) => item.code === ticket.code)));
    setSyncSummary((current) => current ? { ...current, localMissing: Math.max(0, current.localMissing - imported.length) } : current);
    setMessage(
      failed.length > 0
        ? `${imported.length} ticket(s) importé(s), ${failed.length} échec(s).`
        : `${imported.length} ticket(s) importé(s) depuis le routeur.`
    );
  };

  const resetFilters = () => {
    setFilters(emptyTicketFilters);
    setPage(1);
    setMessage(null);
  };

  const testPrinter = async () => {
    const printResult = await printService.testPrinter({ printers, settings: printSettings });
    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.userMessage);
    writeLog({ message: "Test imprimante demandé.", ticketCode: "-", type: "action" });
  };

  const reprintTicket = async (ticket: TicketListItem) => {
    const printResult = await printService.printTicket({
      printers,
      settings: printSettings,
      ticket: buildPrintTicketFromTicket(ticket)
    });

    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.ok ? `${ticket.code} envoyé vers la réimpression.` : printResult.userMessage);
    writeLog({ message: "Réimpression demandée.", ticketCode: ticket.code, type: "action" });

    if (printResult.ok) {
      updateTicket(ticket.id, (item) => ({ ...item, printedCount: item.printedCount + 1, status: "imprimé" }));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button icon={Ticket} onClick={() => navigate(`/routeurs/${routerId}/tickets/generation`)} size="large" variant="primary">
              Créer des tickets
            </Button>
            <Button icon={Download} onClick={() => setMessage("Export de la liste préparé.")}>
              Exporter
            </Button>
            <Button icon={RefreshCw} onClick={() => void syncAllTickets()}>
              Synchroniser
            </Button>
            {session?.internal_profile_role === "admin" ? (
              <Button icon={ShieldCheck} onClick={() => void resyncRouterTickets()} variant="secondary">
                Réparer absents
              </Button>
            ) : null}
          </div>
        }
        description="Retrouvez rapidement un ticket par code, date, plan, statut ou adresse MAC."
        eyebrow="Routeur"
        title="Tickets"
      />

      <Card>
        <div className="tickets-toolbar">
          <div className="tickets-count">
            <strong>Articles ({filteredTickets.length})</strong>
            <span>
              {scopedTickets.length} tickets visibles · Logs : {logs.length}
              {syncSummary ? ` · Sync : ${syncSummary.routerSynced}/${syncSummary.totalLocal}` : ""}
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
          <label className="tickets-search">
            <Search aria-hidden="true" />
            <input
              placeholder="Code ticket"
              value={filters.code}
              onChange={(event) => updateFilters({ code: event.target.value })}
            />
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <TicketFiltersPanel
            filters={filters}
            options={filterOptions}
            onChange={updateFilters}
            onReset={resetFilters}
          />
        ) : null}
      </Card>

      {remoteOnlyTickets.length > 0 ? (
        <Card title="Tickets présents sur le routeur" description="Ces tickets n'existent pas encore dans SQLite local.">
          <div className="button-row">
            <span className="muted-inline">{remoteOnlyTickets.length} ticket(s) à importer</span>
            <Button disabled={!isPersistent} icon={Download} onClick={() => void importRemoteOnlyTickets()} variant="secondary">
              Importer dans TicketPro
            </Button>
          </div>
        </Card>
      ) : null}

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card title="Préparation impression" description="Réglez l'impression thermique sans bloquer l'export PDF.">
        <div className="print-setup-grid">
          <label className="form-field">
            Imprimante
            <select value={printSettings.printerId} onChange={(event) => setPrintSettings((current) => ({ ...current, printerId: event.target.value }))}>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Format
            <select
              value={printSettings.format}
              onChange={(event) => setPrintSettings((current) => ({ ...current, format: event.target.value as PrintSettings["format"] }))}
            >
              <option value="thermal58">58 mm</option>
              <option value="thermal80">80 mm</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="toggle-option print-economy-toggle">
            <input
              checked={printSettings.economical}
              onChange={(event) => setPrintSettings((current) => ({ ...current, economical: event.target.checked }))}
              type="checkbox"
            />
            <Printer aria-hidden="true" />
            <span>Impression économique</span>
          </label>
          <Button icon={Printer} onClick={() => void testPrinter()}>
            Tester imprimante
          </Button>
        </div>
        {printHistory.length > 0 ? (
          <div className="print-history-inline">
            {printHistory.slice(0, 3).map((entry) => (
              <span key={entry.id}>
                {entry.userMessage} · {printFormatLabel(entry.format)}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="tickets-list-card">
        {visibleTickets.length > 0 ? (
          <div className="ticket-list">
            {visibleTickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                onDelete={() => deleteTicket(ticket)}
                onDisable={() => disableTicket(ticket)}
                onExport={() => exportTicket(ticket)}
                onMarkPrinted={() => markPrinted(ticket)}
                onReprint={() => reprintTicket(ticket)}
                onSyncBatch={() => void syncBatch(ticket.batchId)}
                onSync={() => void syncTicket(ticket)}
                onResolveConflict={() => void resolveTicketConflict(ticket)}
                onView={() => setSelectedTicket(ticket)}
                onOpen={() => setSelectedTicket(ticket)}
                role={session?.internal_profile_role ?? "guest"}
                ticket={ticket}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Button icon={Filter} onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            }
            description="Aucun ticket ne correspond aux critères."
            icon={Search}
            title="Aucun ticket trouvé"
          />
        )}

        <div className="pagination-row">
          <Button disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} variant="ghost">
            Précédent
          </Button>
          <span>
            Page {currentPage} / {pageCount}
          </span>
          <Button disabled={currentPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} variant="ghost">
            Suivant
          </Button>
        </div>
      </Card>

      <TicketDetailDialog
        actionLogs={logs}
        onClose={() => setSelectedTicket(null)}
        onDelete={deleteTicket}
        onDisable={disableTicket}
        onReprint={reprintTicket}
        onSync={(ticket) => void syncTicket(ticket)}
        onResolveConflict={(ticket) => void resolveTicketConflict(ticket)}
        role={session?.internal_profile_role ?? "guest"}
        ticket={selectedTicket}
      />
    </div>
  );
}

type TicketRowProps = {
  onDelete: () => void;
  onDisable: () => void;
  onExport: () => void;
  onMarkPrinted: () => void;
  onOpen: () => void;
  onReprint: () => void;
  onSyncBatch: () => void;
  onSync: () => void;
  onResolveConflict: () => void;
  onView: () => void;
  role: UserRole;
  ticket: TicketListItem;
};

function TicketRow({
  onDelete,
  onDisable,
  onExport,
  onMarkPrinted,
  onOpen,
  onReprint,
  onSyncBatch,
  onSync,
  onResolveConflict,
  onView,
  role,
  ticket
}: TicketRowProps) {
  const permissions = getTicketActionPermissions(role, ticket);
  const menuItems = [{ icon: Eye, label: "Voir détail", onSelect: onView }];

  if (permissions.canReprint) {
    menuItems.push({ icon: Printer, label: "Réimprimer", onSelect: onReprint });
    menuItems.push({ icon: CheckCircle2, label: "Marquer imprimé", onSelect: onMarkPrinted });
  }

  if (role !== "guest") {
    menuItems.push({ icon: Download, label: "Exporter", onSelect: onExport });
  }

  if (permissions.canDisable) {
    menuItems.push({ icon: Ban, label: "Désactiver", onSelect: onDisable });
  }

  if (permissions.canSync) {
    menuItems.push({ icon: RefreshCw, label: "Resynchroniser", onSelect: onSync });
    menuItems.push({ icon: Layers, label: "Resynchroniser le lot", onSelect: onSyncBatch });
    if (ticket.syncStatus === "conflict") {
      menuItems.push({ icon: CheckCircle2, label: "Conserver le plan local", onSelect: onResolveConflict });
    }
  }

  if (permissions.canDelete) {
    menuItems.push({ icon: Trash2, label: "Supprimer", onSelect: onDelete });
  }

  return (
    <article
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
        <span className="ticket-row__icon">
          <Ticket aria-hidden="true" />
        </span>
        <div className="ticket-row__body">
          <div className="ticket-row__top">
            <div className="ticket-row__code">
              <strong>{ticket.code}</strong>
              {ticket.hasPdf ? <FileText aria-label="PDF" /> : null}
            </div>
            <div className="ticket-row__badges">
              <Badge className="ticket-row__badge" status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
              <Badge className="ticket-row__badge" status={syncStatusToBadge(ticket.syncStatus)}>{syncStatusLabel(ticket.syncStatus)}</Badge>
              {ticket.status === "complété" ? <Badge className="ticket-row__badge" status="active">Complété</Badge> : null}
            </div>
          </div>
          <div className="ticket-row__facts">
            <span><FileText aria-hidden="true" />{ticket.planName}</span>
            <span><Calendar aria-hidden="true" />{formatDateTime(ticket.createdAt)}</span>
            {ticket.macAddress ? <span><Smartphone aria-hidden="true" />{ticket.macAddress}</span> : null}
          </div>
        </div>
      </div>

      <ActionMenu items={menuItems} />
    </article>
  );
}

type TicketDetailDialogProps = {
  actionLogs: TicketLog[];
  onClose: () => void;
  onDelete: (ticket: TicketListItem) => void;
  onDisable: (ticket: TicketListItem) => void;
  onReprint: (ticket: TicketListItem) => void;
  onSync: (ticket: TicketListItem) => void;
  onResolveConflict: (ticket: TicketListItem) => void;
  role: UserRole;
  ticket: TicketListItem | null;
};

function TicketDetailDialog({
  actionLogs,
  onClose,
  onDelete,
  onDisable,
  onReprint,
  onSync,
  onResolveConflict,
  role,
  ticket
}: TicketDetailDialogProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    setPasswordVisible(false);
  }, [ticket?.id]);

  if (!ticket) {
    return null;
  }

  const permissions = getTicketActionPermissions(role, ticket);
  const lifecycleLogs = buildTicketLifecycleLogs(ticket);
  const relatedActionLogs = actionLogs
    .filter((log) => log.ticketCode === ticket.code)
    .map((log, index) => ({
      createdAt: log.createdAt,
      id: `${ticket.id}-action-${index}`,
      level: log.type === "delete" ? "warning" : "info",
      message: log.message
    }));
  const logs = [...lifecycleLogs, ...relatedActionLogs].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const passwordValue = passwordVisible && permissions.canRevealPassword ? ticket.code : "••••••";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog ticket-detail-dialog" role="dialog">
        <header className="ticket-detail-header">
          <div className="ticket-detail-header__identity">
            <div className="router-card__icon">
              <Ticket aria-hidden="true" />
            </div>
            <div>
              <p className="ticket-detail-header__eyebrow">Détail ticket</p>
              <h2>{ticket.code}</h2>
              <p>{ticket.planName} · {ticket.routerName}</p>
            </div>
          </div>
          <Badge status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
        </header>

        <div className="ticket-detail-layout">
          <section className="ticket-detail-section">
            <h3>Informations principales</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Ticket} label="Code" value={ticket.code} />
              <PasswordDetailLine
                canReveal={permissions.canRevealPassword}
                isVisible={passwordVisible}
                onToggle={() => setPasswordVisible((current) => !current)}
                value={passwordValue}
              />
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
            <div className="ticket-log-list">
              {logs.map((log) => (
                <div className={`ticket-log ticket-log--${log.level}`} key={log.id}>
                  <History aria-hidden="true" />
                  <div>
                    <strong>{formatDateTime(log.createdAt)}</strong>
                    <span>{log.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="ticket-detail-actions">
          {permissions.canReprint ? <Button icon={Printer} onClick={() => onReprint(ticket)}>Réimprimer</Button> : null}
          {permissions.canDisable ? <Button icon={Ban} onClick={() => onDisable(ticket)} variant="ghost">Désactiver</Button> : null}
          {permissions.canSync ? <Button icon={RefreshCw} onClick={() => onSync(ticket)} variant="ghost">Resynchroniser</Button> : null}
          {permissions.canSync && ticket.syncStatus === "conflict" ? <Button icon={CheckCircle2} onClick={() => onResolveConflict(ticket)} variant="ghost">Conserver le plan local</Button> : null}
          {permissions.canDelete ? <Button icon={Trash2} onClick={() => onDelete(ticket)} variant="danger">Supprimer</Button> : null}
          <Button onClick={onClose} variant="primary">Fermer</Button>
        </div>
      </section>
    </div>
  );
}

function DetailLine({ icon: Icon, label, value }: { icon: IconComponent; label: string; value: string }) {
  return (
    <div>
      <dt>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </dt>
      <dd>{value}</dd>
    </div>
  );
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
    <div>
      <dt>
        <KeyRound aria-hidden="true" />
        <span>Mot de passe</span>
      </dt>
      <dd className="ticket-password-value">
        <span>{value}</span>
        {canReveal ? (
          <button aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={onToggle} type="button">
            {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        ) : (
          <small>Masqué</small>
        )}
      </dd>
    </div>
  );
}

function getTicketActionPermissions(role: UserRole, ticket: TicketListItem) {
  if (role === "admin") {
    return {
      canDelete: canDeleteTicket(ticket),
      canDisable: ticket.status !== "supprimé" && ticket.status !== "complété",
      canRevealPassword: true,
      canReprint: true,
      canSync: true
    };
  }

  if (role === "operator") {
    return {
      canDelete: false,
      canDisable: false,
      canRevealPassword: false,
      canReprint: true,
      canSync: false
    };
  }

  if (role === "agent") {
    return {
      canDelete: false,
      canDisable: false,
      canRevealPassword: false,
      canReprint: ticket.operatorProfile === "agent",
      canSync: false
    };
  }

  return {
    canDelete: false,
    canDisable: false,
    canRevealPassword: false,
    canReprint: false,
    canSync: false
  };
}

function syncStatusToBadge(status: RouterTicketSyncStatus): AppStatus {
  if (status === "router_synced") {
    return "success";
  }

  if (status === "error") {
    return "error";
  }

  if (status === "conflict" || status === "local_missing" || status === "router_missing") {
    return "warning";
  }

  return "offline";
}

function buildPrintTicketFromTicket(ticket: TicketListItem) {
  return {
    batchId: ticket.batchId,
    code: ticket.code,
    dataLimitLabel: formatDataLimit(ticket.dataLimitMb),
    durationLabel: formatDuration(ticket.planDurationMinutes),
    id: ticket.id,
    passwordLabel: resolveTicketPdfPassword({
      passwordSecretRef: ticket.passwordSecretRef,
      username: ticket.code
    }),
    planName: ticket.planName,
    zoneName: ticket.routerName
  };
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
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
        Profil
        <select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}>
          <option value="">Tous les profils</option>
          {options.operators.map((operator) => (
            <option key={operator} value={operator}>
              {profileLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Statut
        <select value={filters.status} onChange={(event) => onChange({ status: event.target.value as TicketFilters["status"] })}>
          <option value="">Tous les statuts</option>
          {options.statuses.map((status) => (
            <option key={status} value={status}>
              {ticketStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Lot
        <select value={filters.batchId} onChange={(event) => onChange({ batchId: event.target.value })}>
          <option value="">Tous les lots</option>
          {options.batches.map((batch) => (
            <option key={batch} value={batch}>
              {batch}
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
      <label className="form-field">
        Recherche MAC
        <input placeholder="A8:6B..." value={filters.macAddress} onChange={(event) => onChange({ macAddress: event.target.value })} />
      </label>
      <div className="tickets-filter-panel__actions">
        <Button onClick={onReset} variant="ghost">
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}

function buildFilterOptions(tickets: TicketListItem[]): FilterOptions {
  return {
    batches: unique(tickets.map((ticket) => ticket.batchId)),
    operators: unique(tickets.map((ticket) => ticket.operatorProfile)),
    plans: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.planId, name: ticket.planName })),
      (plan) => plan.id
    ),
    routers: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.routerId, name: ticket.routerName })),
      (router) => router.id
    ),
    statuses: unique(tickets.map((ticket) => ticket.status))
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

function profileLabel(profile: string): string {
  const labels: Record<string, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[profile] ?? profile;
}
