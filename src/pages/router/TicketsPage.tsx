import { useEffect, useMemo, useRef, useState } from "react";
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
  Settings,
  ShieldCheck,
  Smartphone,
  Ticket,
  Trash2,
  Upload,
  UserRound,
  Wifi
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { TicketStateHistoryRecord } from "../../domain/database";
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
  defaultTicketDisplaySettings,
  resolveTicketPasswordValue,
  TicketDisplaySettingsService,
  VoucherActionService,
  type TicketDisplaySettings
} from "../../services/tickets";
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository,
  TicketStateHistoryRepository,
  useAppDatabase
} from "../../services/database";
import {
  OrganizationTicketCatalogService,
  RouterVoucherOutboxService,
  RouterTicketSyncService,
  syncStatusLabel,
  type RouterOnlyTicket,
  type RouterTicketSyncStatus,
  type TicketSyncReport,
  type TicketSyncSummary
} from "../../services/sync";
import { ActionMenu, Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import { formatInternationalPhone, normalizeInternationalPhone } from "../../shared/phone";
import { TicketDisplaySettingsForm } from "./TicketDisplaySettingsForm";
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
  formatSeconds,
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
import {
  mergeTicketUpdate,
  persistTicketSyncReport,
  ticketToCreateInput
} from "./ticketSyncPersistence";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displaySettings, setDisplaySettings] = useState<TicketDisplaySettings>(defaultTicketDisplaySettings);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<TicketLog[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketListItem | null>(null);
  const [selectedTicketHistory, setSelectedTicketHistory] = useState<TicketStateHistoryRecord[]>([]);
  const [ticketToDelete, setTicketToDelete] = useState<TicketListItem | null>(null);
  const [batchToDeleteId, setBatchToDeleteId] = useState<string | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
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
  const ticketHistoryRepository = useMemo(() => new TicketStateHistoryRepository(database), [database]);
  const displaySettingsService = useMemo(() => new TicketDisplaySettingsService(database), [database]);
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
  const persistedRouterServiceIdRef = useRef<string | null>(null);
  const routerServicePreparationRef = useRef<{ promise: Promise<RouterService>; routerId: string } | null>(null);
  const effectiveRouterService = isPersistent ? persistedRouterService : fakeRouterService;
  const syncService = useMemo(
    () => new RouterTicketSyncService(effectiveRouterService ?? fakeRouterService),
    [effectiveRouterService, fakeRouterService]
  );
  const organizationTicketCatalog = useMemo(
    () => session
      ? new OrganizationTicketCatalogService(
          database,
          session.account_id,
          session.internal_profile_id,
          session.internal_profile_role
        )
      : null,
    [database, session]
  );

  const loadPersistedRouterService = async (): Promise<RouterService> => {
    if (persistedRouterService && persistedRouterServiceIdRef.current === routerId) {
      return persistedRouterService;
    }
    if (routerServicePreparationRef.current?.routerId === routerId) {
      return routerServicePreparationRef.current.promise;
    }
    if (!isInitialized || !session) {
      throw new Error("La base locale ou la session n'est pas encore prête.");
    }

    const preparation = (async () => {
      const router = await routerRepository.findById(routerId);
      if (!router || router.account_id !== session.account_id) {
        throw new Error("Routeur introuvable pour ce compte.");
      }
      return createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(routerId),
        database,
        logger: {
          write: (log) => setLogs((current) => [{
            createdAt: new Date().toISOString(),
            message: log.userMessage,
            ticketCode: "-",
            type: "sync"
          }, ...current])
        },
        router
      });
    })();

    routerServicePreparationRef.current = { promise: preparation, routerId };
    try {
      return await preparation;
    } finally {
      if (routerServicePreparationRef.current?.promise === preparation) {
        routerServicePreparationRef.current = null;
      }
    }
  };

  const getRouterServiceForAction = async (): Promise<RouterService> => {
    if (!isPersistent) return fakeRouterService;
    const service = await loadPersistedRouterService();
    persistedRouterServiceIdRef.current = routerId;
    setPersistedRouterService(service);
    return service;
  };

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) {
      persistedRouterServiceIdRef.current = null;
      routerServicePreparationRef.current = null;
      setPersistedRouterService(null);
      return undefined;
    }

    let mounted = true;

    async function prepareRouterService() {
      const service = await loadPersistedRouterService();
      if (mounted) {
        persistedRouterServiceIdRef.current = routerId;
        setPersistedRouterService(service);
      }
    }

    void prepareRouterService().catch((preparationError) => {
      if (mounted) setError(preparationError instanceof Error ? preparationError.message : "Connexion au routeur indisponible.");
    });
    return () => {
      mounted = false;
    };
  }, [connectionRepository, database, isInitialized, isPersistent, routerId, routerRepository, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session || !persistedRouterService) return undefined;
    let disposed = false;
    let running = false;
    const resumeVoucherCommands = async () => {
      if (running || disposed) return;
      running = true;
      try {
        const report = await new RouterVoucherOutboxService(
          database,
          session.account_id,
          persistedRouterService
        ).resume(routerId);
        if (!disposed && report.processed > 0) {
          setMessage(
            `${report.succeeded} commande(s) voucher reprise(s)`
            + (report.retried > 0 ? `, ${report.retried} encore en attente.` : ".")
          );
          await organizationTicketCatalog?.publishRouter(routerId).catch(() => undefined);
        }
      } catch (resumeError) {
        if (!disposed) {
          setError(resumeError instanceof Error
            ? resumeError.message
            : "La reprise des commandes vouchers a échoué.");
        }
      } finally {
        running = false;
      }
    };
    const onFocus = () => void resumeVoucherCommands();
    void resumeVoucherCommands();
    const interval = window.setInterval(() => void resumeVoucherCommands(), 15_000);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [database, isInitialized, isPersistent, organizationTicketCatalog, persistedRouterService, routerId, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) return undefined;
    let mounted = true;
    const accountId = session.account_id;

    async function loadTickets() {
      try {
        await organizationTicketCatalog?.publishRouter(routerId);
      } catch {
        // Les profils en lecture seule ne publient rien vers le catalogue.
      }
      try {
        await organizationTicketCatalog?.pullRouter(routerId);
      } catch {
        // La base locale reste disponible hors ligne. Une prochaine ouverture,
        // reprise de focus ou synchronisation récupérera le catalogue partagé.
      }
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
  }, [generatedFileRepository, isInitialized, isPersistent, organizationTicketCatalog, planRepository, routerId, routerRepository, session, ticketRepository]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session || !organizationTicketCatalog) return undefined;
    let disposed = false;
    const refreshSharedCatalog = async () => {
      try {
        const result = await organizationTicketCatalog.pullRouter(routerId);
        if (disposed || (result.importedBatches === 0 && result.importedTickets === 0)) return;
        const [records, plans, router, files] = await Promise.all([
          ticketRepository.listByRouter(routerId),
          planRepository.listByRouter(routerId),
          routerRepository.findById(routerId),
          generatedFileRepository.listByAccount(session.account_id)
        ]);
        const planById = new Map(plans.map((plan) => [plan.id, plan]));
        const fileByBatch = new Map(files.filter((file) => file.batch_id).map((file) => [file.batch_id as string, file.file_name]));
        if (!disposed) {
          setTickets(records
            .filter((record) => record.account_id === session.account_id)
            .map((record) => ticketFromRecord(record, planById.get(record.plan_id) ?? null, router?.name ?? routerId, fileByBatch.get(record.batch_id) ?? null))
          );
        }
      } catch {
        // Synchronisation silencieuse : les actions manuelles restent explicites.
      }
    };
    const onFocus = () => void refreshSharedCatalog();
    const interval = window.setInterval(() => void refreshSharedCatalog(), 15_000);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [generatedFileRepository, isInitialized, isPersistent, organizationTicketCatalog, planRepository, routerId, routerRepository, session, ticketRepository]);

  useEffect(() => {
    if (!isInitialized || !session) return undefined;
    let mounted = true;
    void displaySettingsService.get(session.account_id, routerId).then((value) => {
      if (mounted) setDisplaySettings(value);
    });
    return () => { mounted = false; };
  }, [displaySettingsService, isInitialized, routerId, session]);

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
  const ticketsRef = useRef<TicketListItem[]>(tickets);
  const automaticSyncRunning = useRef(false);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    if (!isPersistent || !selectedTicket) {
      setSelectedTicketHistory([]);
      return undefined;
    }
    let mounted = true;
    void ticketHistoryRepository.listByTicket(selectedTicket.id).then((history) => {
      if (mounted) setSelectedTicketHistory(history);
    }).catch(() => {
      if (mounted) setSelectedTicketHistory([]);
    });
    return () => { mounted = false; };
  }, [isPersistent, selectedTicket?.id, ticketHistoryRepository]);

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
    await ticketRepository.update(ticketToCreateInput(ticket));
  };

  const publishTicketToOrganization = async (ticketId: string) => {
    if (!organizationTicketCatalog) return;
    try {
      await organizationTicketCatalog.publishTicket(routerId, ticketId);
    } catch {
      writeLog({
        message: "Mise à jour enregistrée localement ; partage avec l’organisation en attente.",
        ticketCode: ticketsRef.current.find((ticket) => ticket.id === ticketId)?.code ?? "-",
        type: "sync"
      });
    }
  };

  const commitTicket = async (ticket: TicketListItem) => {
    const previous = ticketsRef.current.find((item) => item.id === ticket.id);
    if (isPersistent) {
      await persistTicket(ticket);
      await publishTicketToOrganization(ticket.id);
      if (session && previous && previous.status !== ticket.status) {
        const history = await ticketHistoryRepository.record({
          account_id: ticket.accountId,
          created_by_profile_id: session.internal_profile_id,
          message: `${ticketStatusLabel(previous.status)} → ${ticketStatusLabel(ticket.status)}.`,
          next_status: ticket.status,
          previous_status: previous.status,
          router_id: ticket.routerId,
          source: "user_action",
          ticket_id: ticket.id
        });
        if (selectedTicket?.id === ticket.id) {
          setSelectedTicketHistory((current) => [...current, history]);
        }
      }
    }
    setTickets((current) => current.map((item) => (item.id === ticket.id ? ticket : item)));
    setSelectedTicket((current) => (current?.id === ticket.id ? ticket : current));
  };

  const applySyncReport = async (report: TicketSyncReport) => {
    const currentTickets = ticketsRef.current;
    const updates = new Map(report.updates.map((update) => [update.id, update]));
    let nextTickets = currentTickets.map((ticket) => mergeTicketUpdate(ticket, updates.get(ticket.id)));
    if (isPersistent) {
      if (session) {
        nextTickets = await persistTicketSyncReport({
          actorProfileId: session.internal_profile_id,
          batchRepository,
          report,
          ticketHistoryRepository,
          ticketRepository,
          tickets: currentTickets
        });
        await Promise.allSettled(
          report.updates.map((update) => publishTicketToOrganization(update.id))
        );
      }
    }
    setTickets(nextTickets);
    setSelectedTicket((current) => current ? mergeTicketUpdate(current, updates.get(current.id)) : null);
    setSyncSummary(report.summary);
    setRemoteOnlyTickets(report.localMissing);
    report.logs.slice(0, 8).forEach((log) => writeLog({ message: log.message, ticketCode: log.ticketCode ?? "-", type: "sync" }));
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
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const voucherActions = new VoucherActionService(await getRouterServiceForAction());
      const result = await voucherActions.disable(ticket.code);
      const updated: TicketListItem = {
        ...ticket,
        status: "désactivé",
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

  const enableTicket = async (ticket: TicketListItem) => {
    if (ticket.status !== "désactivé") {
      setError("Seul un voucher désactivé manuellement peut être réactivé.");
      return;
    }
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const voucherActions = new VoucherActionService(await getRouterServiceForAction());
      await voucherActions.enable(ticket.code);
      const updated: TicketListItem = {
        ...ticket,
        status: "disponible",
        syncStatus: "router_synced"
      };
      await commitTicket(updated);
      setMessage(`${ticket.code} réactivé sur RouterOS.`);
      writeLog({ message: "Voucher réactivé sur RouterOS.", ticketCode: ticket.code, type: "action" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Le voucher n'a pas pu être réactivé.");
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
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.removeTicket(ticket);
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
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.resyncTicket(ticket);
      await applySyncReport(report);
      setMessage(`${ticket.code} resynchronisé.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La resynchronisation a échoué.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const syncBatch = async (batchId: string) => {
    setIsBulkBusy(true);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.resyncBatch(scopedTickets, batchId);
      await applySyncReport(report);
      setMessage(`Lot ${batchId} resynchronisé.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La resynchronisation du lot a échoué.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  const resolveTicketConflict = async (ticket: TicketListItem) => {
    setBusyTicketId(ticket.id);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.resolveConflict(ticket);
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
    setIsBulkBusy(true);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.compareTickets(scopedTickets.filter((ticket) => ticket.status !== "supprimé"));
      await applySyncReport(report);
      setMessage(`${report.summary.routerSynced} synchronisé(s), ${report.summary.routerMissing} absent(s) du routeur, ${report.summary.localMissing} absent(s) localement.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La synchronisation a échoué.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  const resyncRouterTickets = async () => {
    setIsBulkBusy(true);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.resyncRouter(scopedTickets);
      await applySyncReport(report);
      setMessage(`Réparation terminée : ${report.summary.routerSynced} synchronisé(s), ${report.summary.error} erreur(s).`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La réparation a échoué.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  const importRemoteOnlyTickets = async () => {
    if (!isPersistent || !session) {
      setError("L'import des vouchers distants nécessite la base locale active.");
      return;
    }
    setIsBulkBusy(true);
    clearFeedback();
    try {
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
            created_by_profile_id: session.internal_profile_id,
            currency: "CFA",
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
          }, {
            action: "restored",
            actorProfileId: session.internal_profile_id,
            source: "routeros-ticket-import"
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
          data_limit_mb_snapshot: plan.data_limit_mb,
          deleted_at: null,
          downloaded_bytes: 0,
          download_limit_snapshot: plan.download_limit,
          duration_minutes_snapshot: plan.duration_minutes,
          expires_at: null,
          id: ticketId,
          ip_address: null,
          mac_address: null,
          mikrotik_id: remoteTicket.mikrotikId,
          hotspot_server_name: remoteTicket.serverName,
          mikrotik_profile_name: remoteTicket.profileName,
          password_encrypted: remoteTicket.passwordSecretRef,
          plan_id: plan.id,
          printed_count: 0,
          router_id: routerId,
          status: "disponible",
          shared_users_snapshot: plan.shared_users,
          sync_status: "synced",
          uploaded_bytes: 0,
          upload_limit_snapshot: plan.upload_limit,
          validity_minutes_snapshot: plan.validity_minutes ?? plan.duration_minutes,
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
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "L'import des vouchers a échoué.");
    } finally {
      setIsBulkBusy(false);
    }
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
        ticket: buildPrintTicketFromTicket(
          ticket,
          await resolveTicketPasswordValue({
            passwordSecretRef: ticket.passwordSecretRef,
            username: ticket.code
          })
        )
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

  const exportTicket = async (ticket: TicketListItem) => {
    try {
      await downloadTicketsCsv([ticket], `voucher-${slugify(ticket.code)}.csv`, canRevealPasswords);
      const exported = { ...ticket, exportedAt: new Date().toISOString() };
      await commitTicket(exported);
      setMessage(`${ticket.code} exporté.`);
      writeLog({ message: "Export CSV effectué.", ticketCode: ticket.code, type: "action" });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "L'export du voucher a échoué.");
    }
  };

  const exportVisibleTickets = async () => {
    if (filteredTickets.length === 0) {
      setError("Aucun voucher à exporter avec les filtres actuels.");
      return;
    }
    try {
      await downloadTicketsCsv(filteredTickets, `vouchers-${routerId}-${new Date().toISOString().slice(0, 10)}.csv`, canRevealPasswords);
      const exportedAt = new Date().toISOString();
      const exportedIds = new Set(filteredTickets.map((ticket) => ticket.id));
      const updated = ticketsRef.current.map((ticket) => exportedIds.has(ticket.id) ? { ...ticket, exportedAt } : ticket);
      if (isPersistent) {
        await Promise.all(updated.filter((ticket) => exportedIds.has(ticket.id)).map((ticket) => persistTicket(ticket)));
      }
      setTickets(updated);
      setMessage(`${filteredTickets.length} voucher(s) exporté(s).`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "L'export des vouchers a échoué.");
    }
  };

  const resetFilters = () => {
    setFilters(emptyTicketFilters);
    setPage(1);
    clearFeedback();
  };

  const executeDeleteBatch = async () => {
    if (!batchToDeleteId || !session?.permissions.includes("router.tickets.delete")) return;
    const batchTickets = scopedTickets.filter((ticket) => ticket.batchId === batchToDeleteId);
    if (batchTickets.length === 0) {
      setBatchToDeleteId(null);
      setError("Ce lot ne contient aucun voucher local.");
      return;
    }
    setIsBulkBusy(true);
    clearFeedback();
    try {
      const actionSyncService = new RouterTicketSyncService(await getRouterServiceForAction());
      const report = await actionSyncService.removeBatch(scopedTickets, batchToDeleteId);
      await applySyncReport(report);
      const hasErrors = report.summary.error > 0;
      await batchRepository.updateState(
        batchToDeleteId,
        session.account_id,
        hasErrors ? "suppression_partielle" : "supprimé",
        hasErrors ? "pending" : "synced"
      );
      await organizationTicketCatalog?.publishRouter(routerId).catch(() => undefined);
      setBatchToDeleteId(null);
      if (hasErrors) {
        setError(
          `Suppression partielle : ${batchTickets.length - report.summary.error}/${batchTickets.length} voucher(s) confirmés supprimés. `
          + "Les échecs restent visibles et doivent être relancés."
        );
      } else {
        setMessage(
          `${batchTickets.length} voucher(s) supprimés de RouterOS. Le lot, son PDF et son historique restent archivés dans TicketPro.`
        );
      }
      writeLog({
        message: hasErrors ? "Suppression partielle du lot." : "Suppression complète et confirmée du lot.",
        ticketCode: batchToDeleteId,
        type: "delete"
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La suppression du lot a échoué.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  useEffect(() => {
    if (!effectiveRouterService || !isPersistent) return undefined;
    let disposed = false;
    const synchronize = async () => {
      if (disposed || automaticSyncRunning.current || ticketsRef.current.length === 0) return;
      automaticSyncRunning.current = true;
      try {
        const report = await syncService.compareTickets(ticketsRef.current.filter((ticket) => ticket.status !== "supprimé"));
        if (!disposed) await applySyncReport(report);
      } catch {
        // The manual feedback remains available; background polling stays silent.
      } finally {
        automaticSyncRunning.current = false;
      }
    };
    const onFocus = () => void synchronize();
    const interval = window.setInterval(() => void synchronize(), 15_000);
    window.addEventListener("focus", onFocus);
    void synchronize();
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // Router identity/service changes intentionally restart the real-time loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRouterService, isPersistent, routerId]);

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button icon={Ticket} onClick={() => navigate(`/routeurs/${routerId}/tickets/generation`)} size="large" variant="primary">Créer des tickets</Button>
            <Button icon={Download} onClick={() => void exportVisibleTickets()}>Exporter</Button>
            <Button icon={Settings} onClick={() => setSettingsOpen(true)}>Paramètres</Button>
            <Button disabled={isBulkBusy || busyTicketId !== null} icon={RefreshCw} onClick={() => void syncAllTickets()}>Synchroniser</Button>
            {session?.internal_profile_role === "admin" ? (
              <Button disabled={isBulkBusy || busyTicketId !== null} icon={ShieldCheck} onClick={() => void resyncRouterTickets()} variant="secondary">Réparer absents</Button>
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
          <div className="button-row"><span className="muted-inline">{remoteOnlyTickets.length} voucher(s) à importer</span><Button disabled={!isPersistent || isBulkBusy || busyTicketId !== null} icon={Download} onClick={() => void importRemoteOnlyTickets()} variant="secondary">Importer dans TicketPro</Button></div>
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
                busy={isBulkBusy || busyTicketId !== null}
                key={ticket.id}
                onDelete={() => setTicketToDelete(ticket)}
                onDeleteBatch={() => setBatchToDeleteId(ticket.batchId)}
                onDisable={() => void disableTicket(ticket)}
                onEnable={() => void enableTicket(ticket)}
                onExport={() => void exportTicket(ticket)}
                onMarkPrinted={() => void markPrinted(ticket)}
                onOpen={() => setSelectedTicket(ticket)}
                onReprint={() => void reprintTicket(ticket)}
                onResolveConflict={() => void resolveTicketConflict(ticket)}
                onSync={() => void syncTicket(ticket)}
                onSyncBatch={() => void syncBatch(ticket.batchId)}
                role={session?.internal_profile_role ?? "guest"}
                canDeleteBatch={Boolean(session?.permissions.includes("router.tickets.delete"))}
                displaySettings={displaySettings}
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
        persistedHistory={selectedTicketHistory}
        displaySettings={displaySettings}
        busy={isBulkBusy || busyTicketId !== null}
        onClose={() => setSelectedTicket(null)}
        onDelete={(ticket) => setTicketToDelete(ticket)}
        onDisable={(ticket) => void disableTicket(ticket)}
        onEnable={(ticket) => void enableTicket(ticket)}
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
      <DeleteBatchDialog
        batchId={batchToDeleteId}
        busy={isBulkBusy}
        count={batchToDeleteId
          ? scopedTickets.filter((ticket) => ticket.batchId === batchToDeleteId).length
          : 0}
        onCancel={() => setBatchToDeleteId(null)}
        onConfirm={() => void executeDeleteBatch()}
      />
      <TicketDisplaySettingsDialog
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => {
          setDisplaySettings(next);
          if (session) {
            void displaySettingsService.save(session.account_id, routerId, next)
              .then(() => setMessage("Paramètres d'affichage et d'impression enregistrés."))
              .catch(() => setError("Impossible d'enregistrer les paramètres des tickets."));
          }
          setSettingsOpen(false);
        }}
        open={settingsOpen}
        value={displaySettings}
      />
    </div>
  );
}

function TicketRow({
  busy,
  canDeleteBatch,
  displaySettings,
  onDelete,
  onDeleteBatch,
  onDisable,
  onEnable,
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
  canDeleteBatch: boolean;
  displaySettings: TicketDisplaySettings;
  onDelete: () => void;
  onDeleteBatch: () => void;
  onDisable: () => void;
  onEnable: () => void;
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
  if (permissions.canEnable) menuItems.push({ icon: CheckCircle2, label: "Réactiver", onSelect: onEnable });
  if (permissions.canSync) {
    menuItems.push({ icon: RefreshCw, label: "Resynchroniser", onSelect: onSync });
    menuItems.push({ icon: Layers, label: "Resynchroniser le lot", onSelect: onSyncBatch });
    if (ticket.syncStatus === "conflict") menuItems.push({ icon: CheckCircle2, label: "Conserver le plan local", onSelect: onResolveConflict });
  }
  if (permissions.canDelete) menuItems.push({ icon: Trash2, label: "Supprimer", onSelect: onDelete });
  if (canDeleteBatch) menuItems.push({ icon: Layers, label: "Supprimer tout le lot", onSelect: onDeleteBatch });

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
            <div className="ticket-row__code"><strong>{displaySettings.showUsername ? ticket.code : "Ticket"}</strong>{ticket.hasPdf ? <FileText aria-label="PDF" /> : null}</div>
            <div className="ticket-row__badges">
              <Badge className="ticket-row__badge" status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
              <Badge className="ticket-row__badge" status={syncStatusToBadge(ticket.syncStatus)}>{syncStatusLabel(ticket.syncStatus)}</Badge>
              {busy ? <Badge status="warning">Action en cours</Badge> : null}
            </div>
          </div>
          <div className="ticket-row__facts"><span><FileText aria-hidden="true" />{ticket.planName}</span>{displaySettings.showCreatedAt ? <span><Calendar aria-hidden="true" />{formatDateTime(ticket.createdAt)}</span> : null}{ticket.macAddress ? <span><Smartphone aria-hidden="true" />{ticket.macAddress}</span> : null}</div>
        </div>
      </div>
      <ActionMenu items={menuItems} />
    </article>
  );
}

function TicketDetailDialog({
  actionLogs,
  busy,
  displaySettings,
  onClose,
  onDelete,
  onDisable,
  onEnable,
  onReprint,
  onResolveConflict,
  onSync,
  role,
  ticket,
  persistedHistory
}: {
  actionLogs: TicketLog[];
  busy: boolean;
  displaySettings: TicketDisplaySettings;
  onClose: () => void;
  onDelete: (ticket: TicketListItem) => void;
  onDisable: (ticket: TicketListItem) => void;
  onEnable: (ticket: TicketListItem) => void;
  onReprint: (ticket: TicketListItem) => void;
  onResolveConflict: (ticket: TicketListItem) => void;
  onSync: (ticket: TicketListItem) => void;
  role: UserRole;
  ticket: TicketListItem | null;
  persistedHistory: TicketStateHistoryRecord[];
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  useEffect(() => {
    setPasswordVisible(false);
    setRevealedPassword(null);
  }, [ticket?.id]);
  if (!ticket) return null;
  const permissions = getTicketActionPermissions(role, ticket);
  const logs = [
    ...buildTicketLifecycleLogs(ticket),
    ...persistedHistory.map((history) => ({
      createdAt: history.created_at,
      id: history.id,
      level: history.next_status === "erreur_sync" ? "error" as const : "info" as const,
      message: history.message
    })),
    ...actionLogs.filter((log) => log.ticketCode === ticket.code).map((log, index) => ({
      createdAt: log.createdAt,
      id: `${ticket.id}-action-${index}`,
      level: log.type === "delete" ? "warning" as const : "info" as const,
      message: log.message
    }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const password = passwordVisible && permissions.canRevealPassword
    ? revealedPassword ?? "Chargement…"
    : "••••••";
  const togglePassword = () => {
    if (passwordVisible) {
      setPasswordVisible(false);
      setRevealedPassword(null);
      return;
    }

    setPasswordVisible(true);
    void resolveTicketPasswordValue({
      passwordSecretRef: ticket.passwordSecretRef,
      username: ticket.code
    }).then(setRevealedPassword).catch(() => setRevealedPassword("Indisponible"));
  };

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
              {displaySettings.showUsername ? <DetailLine icon={Ticket} label="Code" value={ticket.code} /> : null}
              {displaySettings.showPassword ? <PasswordDetailLine canReveal={permissions.canRevealPassword} isVisible={passwordVisible} onToggle={togglePassword} value={password} /> : null}
              <DetailLine icon={FileText} label="Plan" value={ticket.planName} />
              <DetailLine icon={FileText} label="Profil MikroTik" value={ticket.profileName} />
              <DetailLine icon={Wifi} label="Serveur Hotspot" value={ticket.serverName === "all" ? "All" : ticket.serverName} />
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
              {displaySettings.showCreatedAt ? <DetailLine icon={Calendar} label="Date création" value={formatDateTime(ticket.createdAt)} /> : null}
              <DetailLine icon={Download} label="Date export / téléchargement" value={formatDateTime(ticket.exportedAt)} />
              <DetailLine icon={CheckCircle2} label="Date activation" value={formatDateTime(ticket.activatedAt)} />
              <DetailLine icon={CheckCircle2} label="Date complétion" value={formatDateTime(ticket.completedAt)} />
              {displaySettings.showExpiresAt ? <DetailLine icon={Clock} label="Date expiration" value={formatDateTime(ticket.expiresAt)} /> : null}
              {displaySettings.showDuration ? <DetailLine icon={Clock} label="Durée" value={formatDuration(ticket.planDurationMinutes)} /> : null}
              <DetailLine icon={Clock} label="Validité" value={formatDuration(ticket.planValidityMinutes)} />
              <DetailLine icon={Clock} label="Temps utilisé" value={formatSeconds(ticket.uptimeSeconds)} />
              <DetailLine icon={Clock} label="Temps restant" value={ticket.remainingSeconds === null ? "Illimité" : formatSeconds(ticket.remainingSeconds)} />
              {displaySettings.showDataLimit ? <DetailLine icon={Database} label="Volume prévu" value={formatDataLimit(ticket.dataLimitMb)} /> : null}
            </dl>
          </section>
          <section className="ticket-detail-section">
            <h3>Utilisation client</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Smartphone} label="MAC client" value={ticket.macAddress ?? "Non disponible"} />
              <DetailLine icon={Smartphone} label="IP client" value={ticket.ipAddress ?? "Non disponible"} />
              <DetailLine icon={Upload} label="Upload" value={formatBytes(ticket.uploadedBytes)} />
              <DetailLine icon={Download} label="Download" value={formatBytes(ticket.downloadedBytes)} />
              <DetailLine icon={Database} label="Volume consommé" value={formatBytes(ticket.downloadedBytes + ticket.uploadedBytes)} />
              <DetailLine icon={Database} label="Volume restant" value={ticket.dataRemainingBytes === null ? "Illimité" : formatBytes(ticket.dataRemainingBytes)} />
              <DetailLine icon={RefreshCw} label="Dernière lecture RouterOS" value={formatDateTime(ticket.lastRouterSyncAt)} />
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
          {permissions.canEnable ? <Button disabled={busy} icon={CheckCircle2} onClick={() => onEnable(ticket)} variant="ghost">Réactiver</Button> : null}
          {permissions.canSync ? <Button disabled={busy} icon={RefreshCw} onClick={() => onSync(ticket)} variant="ghost">Resynchroniser</Button> : null}
          {permissions.canSync && ticket.syncStatus === "conflict" ? <Button disabled={busy} icon={CheckCircle2} onClick={() => onResolveConflict(ticket)} variant="ghost">Conserver le plan local</Button> : null}
          {permissions.canDelete ? <Button disabled={busy} icon={Trash2} onClick={() => onDelete(ticket)} variant="danger">Supprimer</Button> : null}
          <Button onClick={onClose} variant="primary">Fermer</Button>
        </div>
      </section>
    </div>
  );
}

function TicketDisplaySettingsDialog({
  onClose,
  onSave,
  open,
  value
}: {
  onClose: () => void;
  onSave: (value: TicketDisplaySettings) => void;
  open: boolean;
  value: TicketDisplaySettings;
}) {
  const [draft, setDraft] = useState(value);
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
    setValidationError(null);
  }, [open, value]);
  if (!open) return null;
  const save = () => {
    const phone = normalizeInternationalPhone(draft.contactNumber);
    if (!phone.ok) {
      setValidationError(phone.message);
      return;
    }
    onSave({
      ...draft,
      contactNumber: phone.value ? formatInternationalPhone(phone.value) : ""
    });
  };
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog ticket-display-settings" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon"><Settings aria-hidden="true" /></div>
          <div><h2>Paramètres des tickets</h2><p>Ces choix s’appliquent à l’écran et aux prochains PDF.</p></div>
        </header>
        <TicketDisplaySettingsForm onChange={setDraft} value={draft} />
        {validationError ? <p className="form-error">{validationError}</p> : null}
        <div className="confirm-dialog__actions">
          <Button onClick={onClose} variant="ghost">Annuler</Button>
          <Button icon={Settings} onClick={save} variant="primary">Enregistrer</Button>
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

function DeleteBatchDialog({
  batchId,
  busy,
  count,
  onCancel,
  onConfirm
}: {
  batchId: string | null;
  busy: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!batchId) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="connection-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon"><Layers aria-hidden="true" /></div>
          <div>
            <h2>Supprimer tout le lot ?</h2>
            <p>
              {count} voucher(s) seront révoqués sur RouterOS, avec nettoyage des sessions,
              cookies et autorisations TicketPro associées. L'historique et le PDF seront conservés.
            </p>
          </div>
        </header>
        <p className="muted-inline">Lot : {batchId}</p>
        <div className="confirm-dialog__actions">
          <Button disabled={busy} onClick={onCancel} variant="ghost">Annuler</Button>
          <Button disabled={busy} icon={Trash2} onClick={onConfirm} variant="danger">
            {busy ? "Suppression du lot…" : `Supprimer les ${count} vouchers`}
          </Button>
        </div>
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
  if (role === "admin") return {
    canDelete: canDeleteTicket(ticket),
    canDisable: !["supprimé", "complété", "désactivé"].includes(ticket.status),
    canEnable: ticket.status === "désactivé",
    canRevealPassword: true,
    canReprint: true,
    canSync: true
  };
  if (role === "operator") return { canDelete: false, canDisable: false, canEnable: false, canRevealPassword: false, canReprint: true, canSync: false };
  if (role === "agent") return { canDelete: false, canDisable: false, canEnable: false, canRevealPassword: false, canReprint: ticket.operatorProfile === "agent", canSync: false };
  return { canDelete: false, canDisable: false, canEnable: false, canRevealPassword: false, canReprint: false, canSync: false };
}

function syncStatusToBadge(status: RouterTicketSyncStatus): AppStatus {
  if (status === "router_synced") return "success";
  if (status === "error") return "error";
  if (status === "conflict" || status === "local_missing" || status === "router_missing") return "warning";
  return "offline";
}

function buildPrintTicketFromTicket(ticket: TicketListItem, passwordLabel?: string) {
  return {
    batchId: ticket.batchId,
    code: ticket.code,
    dataLimitLabel: formatDataLimit(ticket.dataLimitMb),
    durationLabel: formatDuration(ticket.planDurationMinutes),
    id: ticket.id,
    passwordLabel: passwordLabel ?? resolveTicketPdfPassword({ passwordSecretRef: ticket.passwordSecretRef, username: ticket.code }),
    planName: ticket.planName,
    zoneName: ticket.routerName
  };
}

async function downloadTicketsCsv(tickets: TicketListItem[], fileName: string, includePassword: boolean): Promise<void> {
  const headers = ["Code", ...(includePassword ? ["Mot de passe"] : []), "Plan", "Statut", "Synchronisation", "Routeur", "Lot", "Créé le", "MAC", "IP", "Téléchargé", "Envoyé"];
  const rows = await Promise.all(tickets.map(async (ticket) => [
    ticket.code,
    ...(includePassword ? [await resolveTicketPasswordValue({
      passwordSecretRef: ticket.passwordSecretRef,
      username: ticket.code
    })] : []),
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
  ]));
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
      <label className="form-field">Profil Hotspot<select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}><option value="">Tous les profils</option>{options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
      <label className="form-field">Utilisateur créateur<select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}><option value="">Tous les utilisateurs</option>{options.operators.map((operator) => <option key={operator} value={operator}>{profileLabel(operator)}</option>)}</select></label>
      <label className="form-field">Statut<select value={filters.status} onChange={(event) => onChange({ status: event.target.value as TicketFilters["status"] })}><option value="">Tous les statuts</option>{options.statuses.map((status) => <option key={status} value={status}>{ticketStatusLabel(status)}</option>)}</select></label>
      <label className="form-field">Lot<select value={filters.batchId} onChange={(event) => onChange({ batchId: event.target.value })}><option value="">Tous les lots</option>{options.batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}</select></label>
      <label className="form-field">Routeur<select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}><option value="">Tous les routeurs</option>{options.routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select></label>
      <label className="form-field">Prix minimum<input inputMode="numeric" placeholder="0" value={filters.priceMin} onChange={(event) => onChange({ priceMin: event.target.value })} /></label>
      <label className="form-field">Prix maximum<input inputMode="numeric" placeholder="1000" value={filters.priceMax} onChange={(event) => onChange({ priceMax: event.target.value })} /></label>
      <label className="form-field">Durée (minutes)<input inputMode="numeric" placeholder="60" value={filters.durationMinutes} onChange={(event) => onChange({ durationMinutes: event.target.value })} /></label>
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
