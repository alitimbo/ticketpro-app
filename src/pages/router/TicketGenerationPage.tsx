import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Hash, Printer, RefreshCw, Settings, Ticket, Wifi } from "lucide-react";
import type { HotspotPlan, HotspotServer, RouterSummary } from "../../domain/router";
import type {
  CreateGeneratedFileInput,
  CreateTicketBatchInput,
  CreateTicketInput,
  PrintHistoryRecord,
  SyncStatus
} from "../../domain/database";
import type { UserRole } from "../../domain/auth";
import { dataLimitMbToBytes } from "../../services/tickets/VoucherQuota";
import { useAuth } from "../../app/auth/AuthProvider";
import { AuthorizationError, requireProfilePermission } from "../../services/auth";
import {
  createPersistedRouterService,
  FakeRouterAdapter,
  RouterService,
  type RouterActionLog
} from "../../services/router";
import {
  AccountRepository,
  GeneratedFileRepository,
  HotspotPlanRepository,
  PrintHistoryRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository,
  useAppDatabase
} from "../../services/database";
import { reconcileRouterPlanCatalog } from "../../services/recovery";
import {
  OrganizationOperationsSyncService,
  OrganizationTicketCatalogService,
  buildRouterVoucherCreateOperations,
  RouterVoucherOutboxService
} from "../../services/sync";
import {
  buildGeneratedTicketPdfRecord,
  createTicketPrintArchivePayload,
  formatTicketValidityLabel,
  generateTicketPdf,
  RecoveredVoucherBatchPdfService,
  resolveTicketPdfPassword,
  type TicketPdfFormat,
  type TicketPdfInput
} from "../../services/pdf";
import {
  LocalPrintService,
  printFormatLabel,
  printerStatusLabel,
  type LocalPrinter,
  type PrintHistoryEntry,
  type PrintPaperFormat,
  type PrintSettings
} from "../../services/printing";
import { AsyncStateCard, Badge, Button, Card, FilterButton, PageHeader, StatCard } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import { normalizeInternationalPhone } from "../../shared/phone";
import {
  buildFileName,
  buildTicketBatch,
  buildTicketPdfInputFromOptions,
  buildTicketRecord,
  createBatchId,
  createInitialTicketGenerationState,
  defaultTicketGenerationOptions,
  findConfirmedVoucherBatchUsers,
  formatDataLimit,
  getSelectedQuantity,
  getTicketSummary,
  inspectVoucherBatchIntegrity,
  MAX_TICKET_GENERATION_QUANTITY,
  normalizeCurrency,
  normalizePrefix,
  quickQuantities,
  roleLabel,
  syncStatusLabel,
  ticketStatusLabel,
  ticketStatuses,
  userToTicketRecord,
  validateTicketGeneration,
  type TicketGenerationResult,
  type TicketGenerationState,
  type TicketGenerationStep,
  type TicketStatus
} from "./ticketGenerationModel";
import { planFromRecord } from "./plansPageModel";
import {
  protectTicketPassword,
  resolveTicketPasswordValue,
  buildVoucherBatchOwnershipComment,
  defaultTicketDisplaySettings,
  normalizeTicketDisplaySettings,
  resolveTicketTitle,
  TicketDisplaySettingsService,
  type TicketDisplaySettings,
  TicketCodeGenerator,
  voucherBelongsToBatch
} from "../../services/tickets";
import { TauriFileService } from "../../services/files";
import {
  beginVoucherGenerationPerformance,
  endVoucherGenerationPerformance,
  type VoucherGenerationPerformanceMetrics
} from "../../services/performance/VoucherGenerationPerformance";
import { TicketDisplaySettingsForm } from "./TicketDisplaySettingsForm";

const stepLabels = [
  "Routeur",
  "Plan",
  "Quantité",
  "Options",
  "Confirmation",
  "Résultat"
] as const;

type RouterCatalogStatus = "loading" | "ready" | "error";

type TicketGenerationProgress = {
  completed: number;
  label: string;
  phase: "preparing" | "creating" | "verifying" | "saving" | "publishing" | "pdf";
  total: number;
};

export function TicketGenerationPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [state, setState] = useState<TicketGenerationState>(() => createInitialTicketGenerationState(routerId));
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [plans, setPlans] = useState<HotspotPlan[]>([]);
  const [hotspotServers, setHotspotServers] = useState<HotspotServer[]>([]);
  const [tickets, setTickets] = useState<CreateTicketInput[]>([]);
  const [result, setResult] = useState<TicketGenerationResult | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [generatedFile, setGeneratedFile] = useState<CreateGeneratedFileInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [displaySettings, setDisplaySettings] = useState<TicketDisplaySettings>(defaultTicketDisplaySettings);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showPreviewSettings, setShowPreviewSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<TicketGenerationProgress | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<RouterCatalogStatus>("loading");
  const catalogRequestIdRef = useRef(0);
  const generationLockRef = useRef(false);
  const [printers, setPrinters] = useState<LocalPrinter[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    economical: true,
    format: "thermal80",
    printerId: "pdf-export"
  });
  const [printHistory, setPrintHistory] = useState<PrintHistoryEntry[]>([]);
  const accountRepository = useMemo(() => new AccountRepository(database), [database]);
  const batchRepository = useMemo(() => new TicketBatchRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);

  const service = useMemo(
    () =>
      new RouterService({
        adapter: new FakeRouterAdapter({ latencyMs: 0 }),
        logger: {
          write: (log) => setLogs((current) => [...current, log])
        },
        authSession: session
      }),
    [session]
  );
  const [persistedRouterService, setPersistedRouterService] = useState<RouterService | null>(null);
  const persistedRouterServiceIdRef = useRef<string | null>(null);
  const routerServicePreparationRef = useRef<{ promise: Promise<RouterService>; routerId: string } | null>(null);
  const fileService = useMemo(() => new TauriFileService(), []);
  const printService = useMemo(
    () => new LocalPrintService(isPersistent ? fileService : undefined),
    [fileService, isPersistent]
  );
  const codeGenerator = useMemo(() => new TicketCodeGenerator(), []);
  const generatedFiles = useMemo(() => new GeneratedFileRepository(database), [database]);
  const printHistoryRepository = useMemo(() => new PrintHistoryRepository(database), [database]);
  const displaySettingsService = useMemo(() => new TicketDisplaySettingsService(database), [database]);
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
  const recoveredBatchPdfs = useMemo(
    () => session
      ? new RecoveredVoucherBatchPdfService(database, fileService, {
          cloudPublisher: organizationOperations ?? undefined
        })
      : null,
    [database, fileService, organizationOperations, session]
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
        throw new Error("Le routeur sélectionné est introuvable pour ce compte.");
      }
      return createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(routerId),
        database,
        logger: { write: (log) => setLogs((current) => [...current, log]) },
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
    if (!isPersistent) return service;
    const serviceForRouter = await loadPersistedRouterService();
    persistedRouterServiceIdRef.current = routerId;
    setPersistedRouterService(serviceForRouter);
    return serviceForRouter;
  };

  const settingsRouterId = state.selectedRouterId || routerId;

  useEffect(() => {
    if (!isInitialized || !session) return undefined;
    let mounted = true;
    void displaySettingsService.get(session.account_id, settingsRouterId).then((settings) => {
      if (mounted) setDisplaySettings(settings);
    });
    return () => { mounted = false; };
  }, [displaySettingsService, isInitialized, session, settingsRouterId]);

  useEffect(() => {
    if (!isInitialized || !session) {
      return undefined;
    }

    let mounted = true;
    void accountRepository.findById(session.account_id).then((account) => {
      if (mounted) {
        setOwnerPhone(account?.phone?.trim() || null);
        setCompanyName(account?.company_name?.trim() || null);
      }
    }).catch(() => {
      if (mounted) {
        setOwnerPhone(null);
        setCompanyName(null);
      }
    });

    return () => {
      mounted = false;
    };
  }, [accountRepository, isInitialized, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) {
      persistedRouterServiceIdRef.current = null;
      routerServicePreparationRef.current = null;
      setPersistedRouterService(null);
      return undefined;
    }

    let mounted = true;
    async function prepareRouterService() {
      const serviceForRouter = await loadPersistedRouterService();

      if (mounted) {
        persistedRouterServiceIdRef.current = routerId;
        setPersistedRouterService(serviceForRouter);
      }
    }

    void prepareRouterService().catch((preparationError) => {
      if (mounted) {
        setPersistedRouterService(null);
        setCatalogStatus("error");
        setError(preparationError instanceof Error ? preparationError.message : "Connexion au routeur indisponible.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [connectionRepository, isInitialized, isPersistent, routerId, routerRepository, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session || !persistedRouterService) return undefined;
    let disposed = false;
    let running = false;
    const resumeVoucherCommands = async () => {
      if (running || disposed || generationLockRef.current) return;
      running = true;
      try {
        const report = await new RouterVoucherOutboxService(
          database,
          session.account_id,
          persistedRouterService
        ).resume(routerId);
        const pdfRecovery = await recoveredBatchPdfs?.recoverMissingForRouter(
          session.account_id,
          routerId
        );
        const recoveredPdfCount = pdfRecovery?.results.filter(
          (recovery) => recovery.status === "created"
        ).length ?? 0;
        const recoveredPdfCloudPending = pdfRecovery?.results.some(
          (recovery) => recovery.cloudSyncPending
        ) ?? false;
        if (!disposed && (pdfRecovery?.failedBatchCount ?? 0) > 0) {
          setError("Lot confirmé, mais un PDF reste à reprendre depuis la page Fichiers.");
        }
        if (!disposed && (report.processed > 0 || recoveredPdfCount > 0)) {
          setMessage(
            `${report.succeeded} commande(s) voucher reprise(s)`
            + (report.retried > 0 ? `, ${report.retried} encore en attente.` : ".")
            + (recoveredPdfCount > 0 ? ` ${recoveredPdfCount} PDF récupéré(s).` : "")
            + (recoveredPdfCloudPending ? " Sauvegarde multi-PC du PDF en attente." : "")
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
  }, [
    database,
    isInitialized,
    isPersistent,
    organizationTicketCatalog,
    persistedRouterService,
    recoveredBatchPdfs,
    routerId,
    session
  ]);

  const refreshRouterCatalog = async () => {
    const requestId = ++catalogRequestIdRef.current;
    setCatalogStatus("loading");
    setError(null);
    setMessage(null);
    let catalogService: RouterService;
    try {
      catalogService = await getRouterServiceForAction();
    } catch (connectionError) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogStatus("error");
      setError(connectionError instanceof Error ? connectionError.message : "Connexion au routeur indisponible.");
      return;
    }
    try {
      const [routerServers, routerPlans] = await Promise.all([
        catalogService.getHotspotServers(),
        catalogService.getHotspotPlans()
      ]);
      const enabledServers = routerServers.filter((server) => server.isEnabled);
      let livePlans = routerPlans;
      if (isPersistent) {
        const reconciliation = await reconcileRouterPlanCatalog({
          plans: routerPlans,
          repository: planRepository,
          routerId
        });
        const recordsByProfile = new Map(reconciliation.liveRecords.map(
          (record) => [record.mikrotik_profile_name ?? record.name, record]
        ));
        livePlans = routerPlans.map((remotePlan) => {
          const local = recordsByProfile.get(remotePlan.profileName);
          return local
            ? {
                ...remotePlan,
                currency: local.currency,
                id: local.id,
                mikrotikId: local.mikrotik_id,
                name: local.name,
                priceHint: local.price_hint,
                validityMinutes: local.validity_minutes ?? remotePlan.validityMinutes
              }
            : remotePlan;
        });
      }
      if (requestId !== catalogRequestIdRef.current) return;
      setHotspotServers(routerServers);
      setPlans(livePlans);
      setState((current) => {
        const serverStillExists = current.selectedServerName === "all"
          || enabledServers.some((server) => server.name === current.selectedServerName);
        return {
          ...current,
          selectedPlanId: livePlans.some((plan) => plan.id === current.selectedPlanId && plan.status === "active")
            ? current.selectedPlanId
            : livePlans.find((plan) => plan.status === "active")?.id ?? "",
          selectedServerName: enabledServers.length === 1
            ? enabledServers[0].name
            : serverStillExists ? current.selectedServerName : ""
        };
      });
      setCatalogStatus("ready");
      setMessage(`${enabledServers.length} serveur(s) et ${livePlans.length} profil(s) relus depuis RouterOS.`);
    } catch (catalogError) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogStatus("error");
      setError(catalogError instanceof Error
        ? `Impossible d'actualiser le catalogue RouterOS : ${catalogError.message}`
        : "Impossible d'actualiser le catalogue RouterOS.");
    }
  };

  useEffect(() => {
    if ((isPersistent && !persistedRouterService) || (!isPersistent && !service)) return;
    void refreshRouterCatalog();
    // The catalog must be refreshed when the concrete router service changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersistent, persistedRouterService, routerId]);

  useEffect(() => {
    if (state.step !== 2) return;
    void refreshRouterCatalog();
    // Entering the plan step always performs a fresh RouterOS read. This is
    // intentionally independent from the catalog loaded on the router step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  useEffect(() => {
    if (isPersistent && (!isInitialized || !session)) {
      return undefined;
    }

    let mounted = true;

    async function loadData() {
      const [routerList, planList, printerList] = isPersistent
        ? await Promise.all([
            routerRepository.findById(routerId),
            planRepository.listByRouter(routerId),
            printService.detectPrinters()
          ]).then(([routerRecord, planRecords, printerList]) => [
            routerRecord && routerRecord.account_id === session?.account_id
              ? [{
                  connectionMode: routerRecord.connection_mode,
                  host: routerRecord.local_ip,
                  hotspotAddress: routerRecord.hotspot_address,
                  id: routerRecord.id,
                  isReachable: routerRecord.status === "active",
                  name: routerRecord.name
                } satisfies RouterSummary]
              : [],
            planRecords.map((record) => planFromRecord(record)),
            printerList
          ] as [RouterSummary[], HotspotPlan[], LocalPrinter[]])
        : await Promise.all([service.listRouters(), service.getHotspotPlans(), printService.detectPrinters()]);

      if (!mounted) {
        return;
      }

      const defaultPrinter = printService.getDefaultPrinter(printerList);
      setRouters(routerList);
      setPlans(planList);
      setPrinters(printerList);
      setPrintSettings((current) => ({ ...current, printerId: defaultPrinter?.id ?? current.printerId }));
      setState((current) => ({
        ...current,
        selectedPlanId: current.selectedPlanId || planList.find((plan) => plan.status === "active")?.id || "",
        selectedRouterId: routerList.some((router) => router.id === current.selectedRouterId)
          ? current.selectedRouterId
          : routerList[0]?.id ?? current.selectedRouterId
      }));
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, [isInitialized, isPersistent, planRepository, printService, routerId, routerRepository, service, session]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session || !result?.batch.id) {
      return undefined;
    }

    let mounted = true;

    void printHistoryRepository
      .listByAccount(session.account_id, result.batch.id)
      .then((records) => {
        if (mounted) {
          setPrintHistory(records.map(printHistoryFromRecord));
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [isInitialized, isPersistent, printHistoryRepository, result?.batch.id, session]);

  const selectedRouter = routers.find((router) => router.id === state.selectedRouterId) ?? routers[0] ?? null;
  const selectedPlan = plans.find((plan) => plan.id === state.selectedPlanId) ?? null;
  const selectedPlanCurrency = normalizeCurrency(selectedPlan?.currency);
  const effectiveDisplaySettings = useMemo<TicketDisplaySettings>(() => ({
    ...displaySettings,
    currency: selectedPlanCurrency,
    // Une limite de données est une condition commerciale du voucher : elle
    // doit figurer sur l'aperçu comme sur le document remis au client.
    showDataLimit: displaySettings.showDataLimit || selectedPlan?.dataLimitMb !== null
  }), [displaySettings, selectedPlan?.dataLimitMb, selectedPlanCurrency]);
  const selectedHotspotServer = hotspotServers.find((server) => server.name === state.selectedServerName) ?? null;
  const ticketHotspotAddress = state.selectedServerName === "all"
    ? selectedRouter?.hotspotAddress?.trim() || ""
    : selectedHotspotServer?.dnsName?.trim() || selectedRouter?.hotspotAddress?.trim() || "";
  const quantity = getSelectedQuantity(state);
  const summary =
    session && selectedRouter && selectedPlan && Number.isFinite(quantity)
      ? getTicketSummary({
          operatorRole: session.internal_profile_role,
          plan: selectedPlan,
          quantity,
          router: selectedRouter,
          syncStatus: result?.syncStatus ?? "pending"
        })
      : null;
  const ticketTitle = selectedRouter
    ? resolveTicketTitle(displaySettings, selectedRouter.name, companyName)
    : "Accès WiFi";
  const ticketContact = displaySettings.showContact
    ? displaySettings.contactNumber.trim() || ownerPhone?.trim() || ""
    : "";

  useEffect(() => {
    if (!selectedPlan?.currency) return;
    const planCurrency = normalizeCurrency(selectedPlan.currency);
    setDisplaySettings((current) => current.currency === planCurrency
      ? current
      : { ...current, currency: planCurrency });
  }, [selectedPlan?.currency, selectedPlan?.id]);
  const previewPdfInput = useMemo(() => (
    session && selectedRouter && selectedPlan
      ? buildCreationPreviewPdfInput({
          accountId: session.account_id,
          displaySettings: effectiveDisplaySettings,
          hotspotAddress: ticketHotspotAddress,
          options: state.options,
          plan: selectedPlan,
          router: selectedRouter,
          titleLabel: ticketTitle,
          ownerPhone: ticketContact
        })
      : null
  ), [
    effectiveDisplaySettings,
    selectedPlan,
    selectedRouter,
    session,
    state.options,
    ticketContact,
    ticketHotspotAddress,
    ticketTitle
  ]);

  const updateState = (partial: Partial<TicketGenerationState>) => {
    setError(null);
    setMessage(null);
    setState((current) => ({ ...current, ...partial }));
  };

  const updateDisplaySettings = (next: TicketDisplaySettings) => {
    const normalized = {
      ...normalizeTicketDisplaySettings(next),
      currency: selectedPlanCurrency
    };
    setDisplaySettings(normalized);
    setState((current) => ({
      ...current,
      options: {
        ...current.options,
        generateQrCode: normalized.showQrCode,
        pdfFormat: "a4",
        pdfTemplate: normalized.showQrCode ? "qr" : "economy"
      }
    }));
    if (session && settingsRouterId) {
      void displaySettingsService.save(session.account_id, settingsRouterId, normalized).catch(() => {
        setError("Les paramètres du ticket n'ont pas pu être mémorisés localement.");
      });
    }
  };

  const openCreationPreview = () => {
    const validationError = validateTicketGeneration(state, routers, plans, hotspotServers);
    if (validationError || !selectedPlan || !selectedRouter || !session) {
      setError(validationError ?? "La prévisualisation n'est pas prête.");
      return;
    }
    if (!ticketHotspotAddress) {
      setError("Le profil Hotspot sélectionné ne fournit aucun DNS. Configurez son DNS captif avant de continuer.");
      return;
    }
    if (displaySettings.titleMode === "custom" && !displaySettings.customTitle.trim()) {
      setError("Renseignez le titre personnalisé du voucher.");
      return;
    }
    if (displaySettings.showContact) {
      const contact = normalizeInternationalPhone(
        displaySettings.contactNumber.trim() || ownerPhone,
        { required: true }
      );
      if (!contact.ok) {
        setError(`Numéro de contact du ticket : ${contact.message}`);
        setShowPreviewSettings(true);
        return;
      }
    }
    setShowPreviewSettings(false);
    setIsPreviewOpen(true);
    setError(null);
  };

  const goNext = () => {
    if (state.step === 5) {
      openCreationPreview();
      return;
    }

    if ((state.step === 1 || state.step === 2) && catalogStatus !== "ready") {
      setError(catalogStatus === "loading"
        ? "TicketPro lit encore les serveurs et profils Hotspot sur RouterOS."
        : "Le catalogue RouterOS doit être rechargé avant de continuer.");
      return;
    }

    if (state.step === 2 && hotspotServers.length === 0) {
      setError("Aucun serveur Hotspot n'a pu être lu sur le MikroTik. Actualisez RouterOS avant de continuer.");
      return;
    }
    const stepError = validateStep(state.step, state, routers, plans, hotspotServers);

    if (stepError) {
      setError(stepError);
      return;
    }

    if (state.step === 1) setCatalogStatus("loading");
    updateState({ step: (state.step + 1) as TicketGenerationStep });
  };

  const goBack = () => {
    if (state.step <= 1 || isGenerating) {
      return;
    }

    if (state.step === 3) setCatalogStatus("loading");
    updateState({ step: (state.step - 1) as TicketGenerationStep });
  };

  const generateTickets = async () => {
    if (generationLockRef.current) {
      return;
    }

    try {
      requireProfilePermission(session, "router.tickets.generate");
    } catch (permissionError) {
      setError(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission de générer des tickets.");
      return;
    }

    const validationError = validateTicketGeneration(state, routers, plans, hotspotServers);

    if (validationError || !selectedPlan || !selectedRouter || !session) {
      setError(validationError ?? "La génération n'est pas prête.");
      return;
    }

    if (isPersistent && !ticketHotspotAddress) {
      setError("Renseignez et enregistrez l'adresse Hotspot dans Paramètres routeur avant de créer les tickets.");
      return;
    }
    generationLockRef.current = true;
    setIsGenerating(true);
    setError(null);
    setMessage(null);

    const batchId = createBatchId();
    const requestedQuantity = getSelectedQuantity(state);
    const performanceMetrics = beginVoucherGenerationPerformance(requestedQuantity);
    setGenerationProgress({
      completed: 0,
      label: "Préparation et contrôle du routeur…",
      phase: "preparing",
      total: requestedQuantity
    });
    let succeededTickets: CreateTicketInput[] = [];
    let failedTickets: CreateTicketInput[] = [];
    let firstCreationError: string | null = null;

    try {
      const generationService = await getRouterServiceForAction();
      await performanceMetrics.measure("LIFECYCLE_PREFLIGHT", () =>
        generationService.ensureVoucherLifecycleEngine({
          managedProfileNames: [selectedPlan.profileName],
          planDataLimitMbByProfile: { [selectedPlan.profileName]: selectedPlan.dataLimitMb ?? null }
        })
      );
      const [existingUsers, existingLocalTickets, remotePlans, remoteServers] = await Promise.all([
        generationService.listHotspotUsernames(),
        isPersistent
          ? ticketRepository.listExistingUsernamesByRouter(state.selectedRouterId)
          : Promise.resolve([]),
        generationService.getHotspotPlans(),
        generationService.getHotspotServers()
      ]);
      const liveSelectedPlan = remotePlans.find((plan) => plan.profileName === selectedPlan.profileName);
      if (isPersistent && !liveSelectedPlan) {
        throw new Error(
          `Le plan ${selectedPlan.name} n'existe pas encore sur RouterOS. Synchronisez d'abord ce plan.`
        );
      }
      if (liveSelectedPlan && (
        liveSelectedPlan.durationMinutes !== selectedPlan.durationMinutes
        || liveSelectedPlan.dataLimitMb !== selectedPlan.dataLimitMb
        || liveSelectedPlan.downloadLimit !== selectedPlan.downloadLimit
        || liveSelectedPlan.uploadLimit !== selectedPlan.uploadLimit
        || liveSelectedPlan.sharedUsers !== selectedPlan.sharedUsers
        || liveSelectedPlan.status !== selectedPlan.status
      )) {
        setPlans((current) => current.map((plan) => plan.id === selectedPlan.id
          ? {
              ...liveSelectedPlan,
              currency: selectedPlan.currency,
              id: plan.id,
              mikrotikId: selectedPlan.mikrotikId,
              name: plan.name,
              priceHint: plan.priceHint
            }
          : plan));
        throw new Error(`Le profil ${selectedPlan.profileName} a été modifié sur RouterOS. La liste vient d'être actualisée ; vérifiez-le avant de relancer la création.`);
      }
      const selectedRemoteServer = state.selectedServerName === "all"
        ? "all"
        : remoteServers.find((server) => server.isEnabled && server.name === state.selectedServerName)?.name;
      if (!selectedRemoteServer) {
        setHotspotServers(remoteServers);
        throw new Error("Le serveur Hotspot sélectionné n'existe plus ou est désactivé. La liste a été actualisée.");
      }
      const generatedCredentials = await performanceMetrics.measure("GENERATE_IDENTIFIERS", async () => {
        const generatedUsernames = codeGenerator.generate({
          alphabet: "numeric",
          codeLength: state.options.codeLength,
          excludeAmbiguous: state.options.excludeAmbiguous,
          existingTickets: [...existingUsers, ...existingLocalTickets],
          prefix: state.options.prefix,
          quantity: requestedQuantity,
          routerId: state.selectedRouterId,
          usernameEqualsPassword: true
        }).codes;
        return mapWithConcurrency(
          generatedUsernames,
          8,
          async (credential) => {
            if (state.options.usernameEqualsPassword) {
              return credential;
            }

            const password = codeGenerator.generate({
              alphabet: "numeric",
              codeLength: state.options.codeLength,
              excludeAmbiguous: state.options.excludeAmbiguous,
              existingTickets: [credential.username],
              quantity: 1,
              routerId: state.selectedRouterId,
              usernameEqualsPassword: true
            }).codes[0].username;

            return {
              ...credential,
              passwordSecretRef: await protectTicketPassword(password)
            };
          }
        );
      });
      const pendingTickets = generatedCredentials.map((credential) =>
        buildTicketRecord({
          accountId: session.account_id,
          batchId,
          createdByProfileId: session.internal_profile_id,
          createdByProfile: session.internal_profile_role,
          mikrotikId: null,
          passwordSecretRef: credential.passwordSecretRef,
          planId: state.selectedPlanId,
          planSnapshot: selectedPlan,
          profileName: selectedPlan.profileName,
          routerId: state.selectedRouterId,
          serverName: selectedRemoteServer,
          status: "disponible",
          syncStatus: "pending",
          username: credential.username
        })
      );
      const pendingBatch = buildTicketBatch({
        accountId: session.account_id,
        currency: selectedPlanCurrency,
        id: batchId,
        operatorProfileId: session.internal_profile_id,
        operatorRole: session.internal_profile_role,
        options: state.options,
        planId: state.selectedPlanId,
        priceSnapshot: selectedPlan.priceHint,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        serverName: selectedRemoteServer,
        syncStatus: "pending"
      });

      const voucherOutbox = isPersistent
        ? new RouterVoucherOutboxService(database, session.account_id, generationService)
        : null;
      const voucherOperationInputs = voucherOutbox
        ? buildRouterVoucherCreateOperations(session.account_id, pendingTickets)
        : [];

      // Persist the complete intent and its retry operations atomically before
      // touching RouterOS. A power loss can therefore never leave vouchers
      // without the durable instructions required to resume them.
      if (isPersistent) {
        await performanceMetrics.measure("SQLITE_TRANSACTION", () =>
          batchRepository.createWithTickets(
            pendingBatch,
            pendingTickets,
            voucherOperationInputs
          )
        );
      }

      const voucherOperations = voucherOutbox
        ? await performanceMetrics.measure("OUTBOX_WRITE", () =>
            voucherOutbox.enqueueTickets(pendingTickets)
          )
        : new Map();

      setGenerationProgress({
        completed: 0,
        label: `Création des ${requestedQuantity} vouchers sur RouterOS…`,
        phase: "creating",
        total: requestedQuantity
      });
      const operationEntries = pendingTickets
        .map((ticket) => {
          const operation = voucherOperations.get(ticket.id);
          return operation ? { operation, ticket } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (voucherOutbox) {
        const claimed = await performanceMetrics.measure(
          "OUTBOX_WRITE",
          () => voucherOutbox.beginMany(
            operationEntries.map(({ operation }) => operation.id)
          )
        );
        if (claimed.size !== pendingTickets.length) {
          await voucherOutbox.deferMany(
            [...claimed.keys()],
            new Error("Le verrouillage groupé de la file durable est incomplet.")
          );
          throw new Error(
            `La file durable n'a verrouillé que ${claimed.size}/${pendingTickets.length} vouchers. Aucun envoi incomplet n'a été lancé.`
          );
        }
      }

      const voucherDrafts = generatedCredentials.map((credential) => ({
        comment: buildVoucherBatchOwnershipComment(batchId),
        limitBytesTotal: dataLimitMbToBytes(selectedPlan.dataLimitMb),
        limitUptime: minutesToRouterOsDuration(selectedPlan.durationMinutes),
        passwordSecretRef: credential.passwordSecretRef,
        planId: state.selectedPlanId,
        serverName: selectedRemoteServer,
        username: credential.username,
        validityMinutes: selectedPlan.validityMinutes ?? selectedPlan.durationMinutes
      }));
      let creationResults: Awaited<ReturnType<typeof generationService.createHotspotUsersExactBatch>>;
      let routerVerificationStarted = false;
      performanceMetrics.setRouterCreateOutcome({
        failed: 0,
        requested: requestedQuantity,
        succeeded: 0,
        uncertain: requestedQuantity
      });
      performanceMetrics.startPhase("ROUTER_CREATE");
      try {
        creationResults = await generationService.createHotspotUsersExactBatch(
          voucherDrafts,
          (progress) => {
            if (progress.phase === "verifying" && !routerVerificationStarted) {
              performanceMetrics.endPhase("ROUTER_CREATE");
              performanceMetrics.startPhase("ROUTER_VERIFY");
              routerVerificationStarted = true;
            }
            setGenerationProgress({
              completed: progress.completed,
              label: progress.phase === "verifying"
              ? `Vérification exacte : ${progress.completed}/${requestedQuantity} vouchers confirmés`
              : `Création groupée : ${progress.completed}/${requestedQuantity} vouchers confirmés`,
              phase: progress.phase,
              total: requestedQuantity
            });
          }
        );
      } catch (creationError) {
        if (voucherOutbox) {
          await voucherOutbox.deferMany(
            operationEntries.map(({ operation }) => operation.id),
            creationError
          );
        }
        throw creationError;
      } finally {
        performanceMetrics.endPhase("ROUTER_CREATE");
        performanceMetrics.endPhase("ROUTER_VERIFY");
      }

      const initiallyConfirmed = creationResults.filter((result) => result.status === "confirmed").length;
      performanceMetrics.setRouterCreateOutcome({
        failed: creationResults.length - initiallyConfirmed,
        requested: requestedQuantity,
        succeeded: initiallyConfirmed,
        uncertain: 0
      });

      const resultByUsername = new Map(
        creationResults.map((result) => [result.username, result] as const)
      );
      setGenerationProgress({
        completed: requestedQuantity,
        label: "Vérification finale du lot complet sur RouterOS…",
        phase: "verifying",
        total: requestedQuantity
      });
      const finalRouterUsers = await performanceMetrics.measure(
        "ROUTER_VERIFY",
        () => generationService.listHotspotUsersForVerification()
      );
      const confirmedRouterByUsername = new Map(
        findConfirmedVoucherBatchUsers({
          batchId,
          pendingTickets,
          profileName: selectedPlan.profileName,
          routerUsers: finalRouterUsers
        }).map((user) => [user.username, user] as const)
      );
      const confirmedByUsername = new Map<string, CreateTicketInput>();
      const completionEntries: Array<{ operationId: string; ticket: CreateTicketInput }> = [];
      const failureEntries: Array<{ message: string; operationId?: string; ticket: CreateTicketInput }> = [];

      pendingTickets.forEach((pendingTicket) => {
        const result = resultByUsername.get(pendingTicket.username);
        const confirmedUser = confirmedRouterByUsername.get(pendingTicket.username);
        const operation = voucherOperations.get(pendingTicket.id);
        if (
          result?.status === "confirmed"
          && confirmedUser
          && confirmedUser.profileName === selectedPlan.profileName
          && voucherBelongsToBatch(confirmedUser.comment, batchId)
        ) {
          const confirmedTicket = userToTicketRecord({
            accountId: session.account_id,
            batchId,
            createdByProfileId: session.internal_profile_id,
            createdByProfile: session.internal_profile_role,
            passwordSecretRef: pendingTicket.password_encrypted,
            planId: state.selectedPlanId,
            planSnapshot: selectedPlan,
            routerId: state.selectedRouterId,
            user: confirmedUser
          });
          confirmedByUsername.set(confirmedUser.username, confirmedTicket);
          if (operation) completionEntries.push({ operationId: operation.id, ticket: confirmedTicket });
          return;
        }

        const message = result?.message
          ?? (confirmedUser
            ? `Le voucher existe mais n'appartient pas exactement au lot ${batchId}.`
            : "RouterOS n'a pas confirmé ce voucher.");
        firstCreationError ??= message;
        failureEntries.push({ message, operationId: operation?.id, ticket: pendingTicket });
      });

      performanceMetrics.setRouterCreateOutcome({
        failed: failureEntries.length,
        requested: requestedQuantity,
        succeeded: confirmedByUsername.size,
        uncertain: 0
      });

      if (isPersistent) {
        await performanceMetrics.measure("SQLITE_CONFIRM", async () => {
          if (voucherOutbox) {
            await voucherOutbox.completeMany(completionEntries);
            await mapWithConcurrency(
              failureEntries.filter((entry) => Boolean(entry.operationId)),
              8,
              (entry) => voucherOutbox.defer(entry.operationId!, new Error(entry.message))
            );
          } else {
            await ticketRepository.confirmRouterBatch([...confirmedByUsername.values()]);
          }
        });
      }

      const routerIntegrity = inspectVoucherBatchIntegrity({
        batchId,
        expectedTickets: pendingTickets,
        profileName: selectedPlan.profileName,
        routerUsers: finalRouterUsers
      });
      if (!routerIntegrity.isExact) {
        throw new Error(
          `Intégrité du lot refusée : ${routerIntegrity.managedQuantity}/${routerIntegrity.expectedQuantity} vouchers `
          + "correspondent au lot sur RouterOS. Aucun PDF n'a été produit ; utilisez Réparer/Synchroniser avant de réessayer."
        );
      }

      succeededTickets = pendingTickets
        .map((ticket) => confirmedByUsername.get(ticket.username))
        .filter((ticket): ticket is CreateTicketInput => Boolean(ticket));
      failedTickets = pendingTickets.filter((ticket) => !confirmedByUsername.has(ticket.username));

      if (failureEntries.length > 0) {
        setLogs((current) => [
          ...current,
          {
            action: "createHotspotUsersExactBatch",
            level: "error",
            userMessage: `${failureEntries.length} voucher(s) non confirmé(s). Premier détail : ${failureEntries[0].message}`
          }
        ]);
      }

      if (isPersistent) {
        setGenerationProgress({
          completed: requestedQuantity,
          label: "Contrôle des enregistrements TicketPro…",
          phase: "saving",
          total: requestedQuantity
        });
        await performanceMetrics.measure("SQLITE_CONFIRM", async () => {
          const localBatchTickets = await ticketRepository.listByBatch(batchId);
          assertExactLocalTicketBatch(pendingTickets, localBatchTickets);
        });
      }

      const syncStatus: SyncStatus = failedTickets.length > 0 ? "pending" : "synced";
      const batch = buildTicketBatch({
        accountId: session.account_id,
        currency: selectedPlanCurrency,
        id: batchId,
        operatorProfileId: session.internal_profile_id,
        operatorRole: session.internal_profile_role,
        options: state.options,
        planId: state.selectedPlanId,
        priceSnapshot: selectedPlan.priceHint,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        serverName: selectedRemoteServer,
        syncStatus
      });
      const fileName = buildFileName({
        batchId,
        currency: batch.currency,
        planName: selectedPlan.name,
        price: selectedPlan.priceHint,
        quantity: requestedQuantity,
        routerName: selectedRouter.name
      });

      if (isPersistent) {
        await performanceMetrics.measure("SQLITE_CONFIRM", () =>
          batchRepository.updateState(batch.id, batch.account_id, batch.status, syncStatus)
        );
      }

      let organizationSyncError: string | null = null;
      if (isPersistent && organizationTicketCatalog) {
        setGenerationProgress({
          completed: requestedQuantity,
          label: "Partage du lot avec l'organisation…",
          phase: "publishing",
          total: requestedQuantity
        });
        try {
          await performanceMetrics.measure("VPS_SYNC", () =>
            organizationTicketCatalog.publishBatch(state.selectedRouterId, batch.id)
          );
        } catch (cloudError) {
          organizationSyncError = readGenerationError(
            cloudError,
            "Les vouchers sont sur le MikroTik, mais leur partage avec l’organisation doit être relancé."
          );
        }
      }

      setTickets([...succeededTickets, ...failedTickets]);
      let createdPdf: CreateGeneratedFileInput | null = null;
      let pdfError: string | null = null;
      if (fileName) {
        try {
          if (succeededTickets.length === requestedQuantity) {
            setGenerationProgress({
              completed: requestedQuantity,
              label: `Création du PDF avec ${requestedQuantity} tickets…`,
              phase: "pdf",
              total: requestedQuantity
            });
            performanceMetrics.startPhase("PDF_GENERATION");
            try {
              createdPdf = await createAndStorePdf(
                batch,
                succeededTickets,
                fileName,
                undefined,
                performanceMetrics
              );
            } finally {
              performanceMetrics.endPhase("PDF_GENERATION");
            }
          }
        } catch (fileError) {
          pdfError = fileError instanceof Error ? fileError.message : "Le PDF n'a pas pu être généré.";
        }
      }
      setGeneratedFile(createdPdf);
      setResult({
        batch,
        failedTickets,
        fileName,
        statusLabel: syncStatusLabel(syncStatus),
        succeededTickets,
        syncStatus,
        totalValue: selectedPlan.priceHint === null ? null : selectedPlan.priceHint * requestedQuantity
      });
      setState((current) => ({ ...current, step: 6 }));
      setIsPreviewOpen(false);
      if (failedTickets.length > 0) {
        setError(`${failedTickets.length} voucher(s) n'ont pas été confirmés sur RouterOS. Ils restent en erreur de synchronisation.`);
      }
      setMessage(
        failedTickets.length > 0
          ? `${succeededTickets.length} ticket(s) réellement confirmés sur RouterOS. ${firstCreationError ?? ""}`
          : organizationSyncError
          ? `${succeededTickets.length} ticket(s) créés sur RouterOS. Synchronisation organisationnelle en attente : ${organizationSyncError}`
          : pdfError
          ? `${succeededTickets.length} ticket(s) créé(s). PDF à reprendre : ${pdfError}`
          : `${succeededTickets.length} ticket(s) créés avec succès${createdPdf ? " et PDF enregistré." : "."}`
      );
    } catch (generationError) {
      performanceMetrics.markFailed();
      setError(readGenerationError(generationError, "La génération des tickets a échoué."));
    } finally {
      endVoucherGenerationPerformance(performanceMetrics);
      generationLockRef.current = false;
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const primaryActionLabel = state.step === 5 ? "Prévisualiser et continuer" : "Continuer";

  const createAndStorePdf = async (
    batch: CreateTicketBatchInput,
    pdfTickets: CreateTicketInput[],
    fileName: string,
    output?: { format: TicketPdfFormat; recordId: string },
    performanceMetrics?: VoucherGenerationPerformanceMetrics
  ): Promise<CreateGeneratedFileInput> => {
    if (!selectedPlan || !selectedRouter) {
      throw new Error("Le plan ou le routeur du PDF est introuvable.");
    }
    if (isPersistent && !ticketHotspotAddress) {
      throw new Error(
        "Configurez d'abord l'adresse Hotspot dans Paramètres routeur afin qu'elle figure sur chaque ticket."
      );
    }
    assertCompleteTicketBatch(batch, pdfTickets);
    const generatedAt = new Date().toISOString();
    const basePdfInput = buildTicketPdfInputFromOptions({
      batch,
      fileName,
      generatedAt,
      options: state.options,
      ownerPhone: ticketContact,
      plan: selectedPlan,
      router: { ...selectedRouter, hotspotAddress: ticketHotspotAddress },
      tickets: pdfTickets
    });
    const pdfInput: TicketPdfInput = {
      ...basePdfInput,
      currency: batch.currency ?? "CFA",
      fileName,
      format: output?.format ?? "a4",
      displaySettings: effectiveDisplaySettings,
      ownerPhone: ticketContact,
      priceLabel: selectedPlan.priceHint === null || !displaySettings.showPrice
        ? null
        : `${selectedPlan.priceHint.toLocaleString("fr-FR")} ${batch.currency ?? "CFA"}`,
      qrCodeEnabled: displaySettings.showQrCode,
      template: displaySettings.showQrCode ? "qr" : "economy",
      titleLabel: ticketTitle,
      tickets: await mapWithConcurrency(
        pdfTickets,
        8,
        async (ticket) => ({
          password: await resolveTicketPasswordValue({
            passwordSecretRef: ticket.password_encrypted,
            username: ticket.username
          }),
          passwordSecretRef: ticket.password_encrypted,
          username: ticket.username
        })
      )
    };
    const pdfBytes = generateTicketPdf(pdfInput);
    let fileRecord = buildGeneratedTicketPdfRecord(pdfInput);
    if (output) fileRecord = { ...fileRecord, id: output.recordId };

    if (isPersistent) {
      const savedFile = await fileService.writeBytes(fileRecord.file_path, pdfBytes);
      fileRecord = { ...fileRecord, file_path: savedFile.relative_path };
    } else {
      downloadPdf(pdfInput.fileName, pdfBytes);
    }

    await generatedFiles.upsert(fileRecord);
    performanceMetrics?.endPhase("PDF_GENERATION");
    if (organizationOperations) {
      try {
        const publishFiles = async () => {
          await organizationOperations.publishFile(routerId, fileRecord.id);
          await organizationOperations.publishTicketPrintArchive(
            routerId,
            fileRecord.id,
            createTicketPrintArchivePayload(pdfInput)
          );
        };
        if (performanceMetrics) {
          await performanceMetrics.measure("VPS_FILE_SYNC", publishFiles);
        } else {
          await publishFiles();
        }
      } catch (archiveError) {
        const detail = archiveError instanceof Error ? archiveError.message : "service indisponible";
        setError(
          `Le PDF local est prêt, mais sa sauvegarde sécurisée multi-PC reste à reprendre : ${detail}`
        );
      }
    }
    if (isPersistent) {
      const markExported = () => ticketRepository.markExportedMany(
        pdfTickets.map((ticket) => ticket.id),
        session!.account_id,
        generatedAt
      );
      if (performanceMetrics) {
        await performanceMetrics.measure("SQLITE_CONFIRM", markExported);
      } else {
        await markExported();
      }
      pdfTickets.forEach((ticket) => { ticket.exported_at = generatedAt; });
      setTickets((current) => current.map((ticket) =>
        pdfTickets.some((exported) => exported.id === ticket.id)
          ? { ...ticket, exported_at: generatedAt }
          : ticket
      ));
    }
    return fileRecord;
  };

  const generatePdf = async (): Promise<CreateGeneratedFileInput | null> => {
    if (!result || !result.fileName) {
      setMessage("Aucun PDF à générer pour ce lot.");
      return null;
    }

    const printableTickets = tickets.filter((ticket) => ticket.sync_status === "synced");
    try {
      assertCompleteTicketBatch(result.batch, printableTickets);
    } catch (quantityError) {
      setError(readGenerationError(quantityError, "Le lot n'est pas complet."));
      return null;
    }

    if (generatedFile) {
      if (isPersistent) {
        await fileService.open(generatedFile.file_path);
      }
      setMessage(`${generatedFile.file_name} ouvert.`);
      return generatedFile;
    }

    const fileRecord = await createAndStorePdf(result.batch, printableTickets, result.fileName);
    setGeneratedFile(fileRecord);
    setMessage(`${fileRecord.file_name} généré et enregistré dans les fichiers.`);
    return fileRecord;
  };

  const printBatch = async () => {
    if (!result || !selectedPlan || !selectedRouter) {
      setMessage("Aucun lot à imprimer.");
      return;
    }

    const printableTickets = tickets.filter((ticket) => ticket.sync_status === "synced");
    try {
      assertCompleteTicketBatch(result.batch, printableTickets);
    } catch (quantityError) {
      setError(readGenerationError(quantityError, "Le lot n'est pas complet."));
      return;
    }
    const printFileName = `tickets-${result.batch.id}-${printSettings.format}.pdf`;
    let fileToPrint = generatedFile;
    try {
      if (isPersistent) {
        fileToPrint = await createAndStorePdf(result.batch, printableTickets, printFileName, {
          format: printSettings.format,
          recordId: `${result.batch.id}-pdf-${printSettings.format}`
        });
      }
    } catch (printFileError) {
      setError(readGenerationError(printFileError, "Le PDF d'impression n'a pas pu être préparé."));
      return;
    }

    if (isPersistent && !fileToPrint) {
      setMessage("Le PDF doit être généré avant l'impression.");
      return;
    }

    const printTickets = await mapWithConcurrency(
      tickets.filter((ticket) => ticket.sync_status === "synced"),
      8,
      async (ticket) =>
        buildPrintTicketFromGeneratedTicket(
          ticket,
          selectedPlan,
          selectedRouter.name,
          result.batch.id,
          await resolveTicketPasswordValue({
            passwordSecretRef: ticket.password_encrypted,
            username: ticket.username
          })
        )
    );
    const printResult = await printService.printBatch({
      filePath: fileToPrint?.file_path,
      printers,
      settings: printSettings,
      tickets: printTickets
    });

    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    if (isPersistent && session) {
      void printHistoryRepository
        .create({
          account_id: session.account_id,
          batch_id: result.batch.id,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          format: printResult.historyEntry.format,
          id: printResult.historyEntry.id,
          mode: printResult.historyEntry.mode,
          printer_id: printSettings.printerId,
          printer_name: printResult.historyEntry.printerName,
          router_id: result.batch.router_id,
          status: printResult.historyEntry.status,
          ticket_count: printResult.historyEntry.ticketCount,
          user_message: printResult.historyEntry.userMessage
        })
        .catch(() => setMessage("Impression effectuée, mais son historique n'a pas pu être enregistré."));
    }
    setMessage(printResult.userMessage);

    if (!printResult.ok) {
      return;
    }

    const printedIds = new Set(printResult.printedTicketIds);
    setTickets((current) =>
      current.map((ticket) =>
        printedIds.has(ticket.id)
          ? { ...ticket, printed_count: ticket.printed_count + 1, status: "imprimé" }
          : ticket
      )
    );
  };

  const testPrinter = async () => {
    const printResult = await printService.testPrinter({ printers, settings: printSettings });
    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    if (isPersistent && session && result) {
      void printHistoryRepository
        .create({
          account_id: session.account_id,
          batch_id: result.batch.id,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          format: printResult.historyEntry.format,
          id: printResult.historyEntry.id,
          mode: printResult.historyEntry.mode,
          printer_id: printSettings.printerId,
          printer_name: printResult.historyEntry.printerName,
          router_id: result.batch.router_id,
          status: printResult.historyEntry.status,
          ticket_count: printResult.historyEntry.ticketCount,
          user_message: printResult.historyEntry.userMessage
        })
        .catch(() => setMessage("Le test est terminé, mais son historique n'a pas pu être enregistré."));
    }
    setMessage(printResult.userMessage);
  };

  return (
    <div className="page-stack">
      <PageHeader
        description="Assistant rapide pour créer un lot de tickets numériques à partir d'un plan."
        eyebrow="Routeur"
        title="Créer des tickets"
      />

      <WizardSteps currentStep={state.step} />

      {message ? <p className="form-error form-error--success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {(state.step === 1 || state.step === 2) && catalogStatus !== "ready" ? (
        <AsyncStateCard
          description="TicketPro vérifie directement les serveurs et profils Hotspot disponibles sur le MikroTik."
          errorDescription="Vérifiez la connexion au routeur, puis relancez la lecture."
          errorTitle="Catalogue RouterOS indisponible"
          loadingDescription="Récupération des serveurs Hotspot et des profils. Le formulaire apparaîtra dès que les données seront confirmées."
          loadingTitle="Lecture de RouterOS en cours…"
          status={catalogStatus}
          onRetry={() => void refreshRouterCatalog()}
          title="Préparation de la génération"
        />
      ) : null}

      {state.step === 1 && catalogStatus === "ready" ? (
        <StepRouter routers={routers} selectedRouterId={state.selectedRouterId} onSelect={(selectedRouterId) => updateState({ selectedRouterId })} />
      ) : null}
      {state.step === 2 && catalogStatus === "ready" ? (
        <StepPlan
          currency={selectedPlanCurrency}
          onRefresh={() => void refreshRouterCatalog()}
          onSelect={(selectedPlanId) => updateState({ selectedPlanId })}
          onServerSelect={(selectedServerName) => updateState({ selectedServerName })}
          plans={plans}
          selectedPlanId={state.selectedPlanId}
          selectedServerName={state.selectedServerName}
          servers={hotspotServers}
        />
      ) : null}
      {state.step === 3 ? (
        <StepQuantity state={state} onChange={updateState} />
      ) : null}
      {state.step === 4 ? (
        <StepOptions state={state} onChange={updateState} />
      ) : null}
      {state.step === 5 && selectedPlan && selectedRouter && summary ? (
        <StepConfirmation
          currency={selectedPlanCurrency}
          logsCount={logs.length}
          options={state.options}
          plan={selectedPlan}
          quantity={quantity}
          router={selectedRouter}
          serverName={state.selectedServerName}
          summary={summary}
        />
      ) : null}
      {state.step === 6 && result && selectedPlan && selectedRouter ? (
        <StepResult
          generatedFile={generatedFile}
          onPdf={() => void generatePdf()}
          onPrint={() => void printBatch()}
          onTestPrinter={() => void testPrinter()}
          onUpdatePrintSettings={(partial) => setPrintSettings((current) => ({ ...current, ...partial }))}
          plan={selectedPlan}
          printHistory={printHistory}
          printers={printers}
          printSettings={printSettings}
          result={result}
          router={selectedRouter}
          tickets={tickets}
        />
      ) : null}

      <div className="wizard-actions">
        <Button disabled={state.step === 1 || isGenerating} icon={ChevronLeft} onClick={goBack} variant="ghost">
          Retour
        </Button>
        {state.step < 6 ? (
          <Button
            disabled={isGenerating || ((state.step === 1 || state.step === 2) && catalogStatus !== "ready")}
            icon={state.step === 5 ? Ticket : ChevronRight}
            onClick={goNext}
            variant="primary"
          >
            {isGenerating
              ? "Création en cours..."
              : catalogStatus === "loading" && (state.step === 1 || state.step === 2)
                ? "Lecture RouterOS…"
                : primaryActionLabel}
          </Button>
        ) : (
          <Button
            icon={Ticket}
            onClick={() => {
              setResult(null);
              setTickets([]);
              setCatalogStatus("loading");
              updateState({ step: 2, quantity: 20, customQuantity: "20", options: defaultTicketGenerationOptions });
              setGeneratedFile(null);
            }}
            variant="primary"
          >
            Nouveau lot
          </Button>
        )}
      </div>

      <TicketCreationPreviewDialog
        companyName={companyName}
        displaySettings={effectiveDisplaySettings}
        generationProgress={generationProgress}
        isGenerating={isGenerating}
        onBack={() => {
          if (!isGenerating) setIsPreviewOpen(false);
        }}
        onConfirm={() => void generateTickets()}
        onSettings={() => setShowPreviewSettings((current) => !current)}
        onSettingsChange={updateDisplaySettings}
        open={isPreviewOpen}
        plan={selectedPlan}
        previewInput={previewPdfInput}
        quantity={quantity}
        router={selectedRouter}
        serverName={state.selectedServerName}
        showSettings={showPreviewSettings}
      />
    </div>
  );
}

function WizardSteps({ currentStep }: { currentStep: TicketGenerationStep }) {
  return (
    <Card>
      <ol className="wizard-steps">
        {stepLabels.map((label, index) => {
          const step = (index + 1) as TicketGenerationStep;
          const stateClass = step === currentStep ? "active" : step < currentStep ? "done" : "idle";

          return (
            <li className={`wizard-step wizard-step--${stateClass}`} key={label}>
              <span>{step < currentStep ? <CheckCircle2 aria-hidden="true" /> : step}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StepRouter({
  onSelect,
  routers,
  selectedRouterId
}: {
  onSelect: (routerId: string) => void;
  routers: RouterSummary[];
  selectedRouterId: string;
}) {
  return (
    <Card title="Choisir le routeur actif" description="Le lot sera créé sur le routeur sélectionné.">
      <div className="choice-grid">
        {routers.map((router) => {
          const isSelected = router.id === selectedRouterId;
          return (
            <button
              aria-pressed={isSelected}
              className={`choice-card ticket-selection-card ${isSelected ? "choice-card--selected" : ""}`}
              key={router.id}
              onClick={() => onSelect(router.id)}
              type="button"
            >
              {isSelected ? (
                <span className="ticket-selection-card__check" title="Routeur sélectionné">
                  <CheckCircle2 aria-hidden="true" />
                </span>
              ) : null}
              <strong>{router.name}</strong>
              <span>{router.host}</span>
              <Badge status={router.isReachable ? "success" : "offline"}>
                {router.isReachable ? "Connecté" : "Hors ligne"}
              </Badge>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function StepPlan({
  currency,
  onRefresh,
  onSelect,
  onServerSelect,
  plans,
  selectedPlanId,
  selectedServerName,
  servers
}: {
  currency: string;
  onRefresh: () => void;
  onSelect: (planId: string) => void;
  onServerSelect: (serverName: string) => void;
  plans: HotspotPlan[];
  selectedPlanId: string;
  selectedServerName: string;
  servers: HotspotServer[];
}) {
  const enabledServers = servers.filter((server) => server.isEnabled);
  const serverCountUsesPlural = enabledServers.length !== 1;
  return (
    <Card
      actions={<Button icon={RefreshCw} onClick={onRefresh}>Actualiser RouterOS</Button>}
      title="Choisir le serveur et le profil"
      description="La liste provient directement du MikroTik. TicketPro la revérifiera avant la création."
    >
      <div className="router-form-grid ticket-server-selection">
        <label className="form-field">
          Serveur Hotspot
          <select value={selectedServerName} onChange={(event) => onServerSelect(event.target.value)}>
            {enabledServers.length > 1 ? <option value="">Choisir un serveur…</option> : null}
            {enabledServers.map((server) => (
              <option key={server.id} value={server.name}>{server.name} · {server.interfaceName}</option>
            ))}
            {enabledServers.length > 0 ? <option value="all">All — tous les serveurs compatibles</option> : null}
          </select>
          <small>
            {enabledServers.length === 1
              ? `${enabledServers[0].name} a été sélectionné automatiquement.`
              : `${enabledServers.length} serveurs actifs détectés : un choix est obligatoire.`}
          </small>
        </label>
        <div className="ticket-server-selection__status-column">
          <span className="ticket-server-selection__status-label">État RouterOS</span>
          <div className="ticket-server-selection__status">
            <Wifi aria-hidden="true" />
            <span>
              {enabledServers.length} serveur{serverCountUsesPlural ? "s" : ""} Hotspot actif{serverCountUsesPlural ? "s" : ""} lu{serverCountUsesPlural ? "s" : ""} sur RouterOS.
            </span>
          </div>
        </div>
      </div>
      <div className="choice-grid">
        {plans.map((plan) => {
          const isSelected = plan.id === selectedPlanId;
          return (
            <button
              aria-pressed={isSelected}
              className={`choice-card ticket-selection-card ${isSelected ? "choice-card--selected" : ""}`}
              disabled={plan.status !== "active"}
              key={plan.id}
              onClick={() => onSelect(plan.id)}
              type="button"
            >
              {isSelected ? (
                <span className="ticket-selection-card__check" title="Plan sélectionné">
                  <CheckCircle2 aria-hidden="true" />
                </span>
              ) : null}
              <strong>{plan.name}</strong>
              <span>Profil : {plan.profileName}</span>
              <span>{formatPlanDurationLabel(plan.durationMinutes)} · validité {formatPlanDurationLabel(plan.validityMinutes ?? plan.durationMinutes)}</span>
              <span>Débit {plan.downloadLimit ?? "∞"} / {plan.uploadLimit ?? "∞"} · {plan.dataLimitMb ? `${plan.dataLimitMb} MB` : "Volume illimité"}</span>
              <span>{plan.sharedUsers} appareil(s) autorisé(s)</span>
              <span>{plan.priceHint
                ? `${plan.priceHint} ${currency}`
                : "Prix non défini"}</span>
              <Badge status={plan.status === "active" ? "success" : "offline"}>
                {plan.status === "active" ? "Actif" : "Inactif"}
              </Badge>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function StepQuantity({
  onChange,
  state
}: {
  onChange: (partial: Partial<TicketGenerationState>) => void;
  state: TicketGenerationState;
}) {
  return (
    <Card title="Choisir la quantité" description="Les quantités rapides permettent de créer un lot en quelques secondes.">
      <div className="ticket-quantity-grid">
        {quickQuantities.map((quantity) => (
          <FilterButton
            active={state.quantity === quantity}
            aria-pressed={state.quantity === quantity}
            className="ticket-quantity-option"
            key={quantity}
            onClick={() => onChange({ quantity, customQuantity: String(quantity) })}
          >
            <strong>{quantity}</strong>
            <span>tickets</span>
          </FilterButton>
        ))}
        <FilterButton
          active={state.quantity === "custom"}
          aria-pressed={state.quantity === "custom"}
          className="ticket-quantity-option"
          onClick={() => onChange({ quantity: "custom" })}
        >
          <strong>Autre</strong>
          <span>quantité</span>
        </FilterButton>
      </div>
      <label className={`form-field ticket-custom-quantity ${state.quantity === "custom" ? "ticket-custom-quantity--active" : ""}`}>
        <span>Quantité personnalisée</span>
        <input
          disabled={state.quantity !== "custom"}
          inputMode="numeric"
          min="1"
          max={MAX_TICKET_GENERATION_QUANTITY}
          value={state.customQuantity}
          onChange={(event) => onChange({ customQuantity: event.target.value, quantity: "custom" })}
        />
        <small>Entre 1 et {MAX_TICKET_GENERATION_QUANTITY} tickets par lot.</small>
      </label>
    </Card>
  );
}

function StepOptions({
  onChange,
  state
}: {
  onChange: (partial: Partial<TicketGenerationState>) => void;
  state: TicketGenerationState;
}) {
  const updateOptions = (partial: Partial<TicketGenerationState["options"]>) =>
    onChange({ options: { ...state.options, ...partial } });

  return (
    <Card title="Options de génération" description="Les réglages par défaut conviennent pour un lot simple.">
      <div className="router-form-grid">
        <label className="form-field">
          Longueur du code
          <input
            inputMode="numeric"
            value={state.options.codeLength}
            onChange={(event) => updateOptions({ codeLength: Number(event.target.value) })}
          />
        </label>
        <label className="form-field">
          Préfixe optionnel
          <input
            placeholder="Ex. VIP"
            value={state.options.prefix}
            onChange={(event) => updateOptions({ prefix: normalizePrefix(event.target.value) })}
          />
        </label>
      </div>
      <div className="option-list">
        <ToggleOption
          checked={state.options.usernameEqualsPassword}
          icon={Hash}
          label="Identifiant = mot de passe"
          onChange={(checked) => updateOptions({ usernameEqualsPassword: checked })}
        />
        <ToggleOption
          checked={state.options.excludeAmbiguous}
          icon={Hash}
          label="Exclure les chiffres ambigus"
          onChange={(checked) => updateOptions({ excludeAmbiguous: checked })}
        />
        {/* QR code volontairement masqué : la fonctionnalité reste conservée dans
            le modèle pour une réactivation future après validation du parcours captif. */}
        {/* Le PDF est obligatoire et automatiquement archivé dans Fichiers. */}
      </div>
      <div className="ticket-generation-format-note">
        <FileText aria-hidden="true" />
        <div>
          <strong>PDF A4 obligatoire - 40 tickets par page</strong>
          <span>Le choix avec ou sans QR se fait dans « Paramètres du ticket » avant la confirmation.</span>
        </div>
      </div>
    </Card>
  );
}

function ToggleOption({
  checked,
  icon: Icon,
  label,
  onChange
}: {
  checked: boolean;
  icon: IconComponent;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-option">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function StepConfirmation({
  currency,
  logsCount,
  options,
  plan,
  quantity,
  router,
  serverName,
  summary
}: {
  currency: string;
  logsCount: number;
  options: TicketGenerationState["options"];
  plan: HotspotPlan;
  quantity: number;
  router: RouterSummary;
  serverName: string;
  summary: ReturnType<typeof getTicketSummary>;
}) {
  return (
    <div className="page-grid">
      <div className="span-4">
        <StatCard icon={Ticket} label="Quantité" value={String(quantity)} hint="Tickets numériques" />
      </div>
      <div className="span-4">
        <StatCard icon={FileText} label="Valeur totale" value={summary.totalValue === null ? "Non définie" : `${summary.totalValue} ${currency}`} hint={plan.name} />
      </div>
      <div className="span-4">
        <StatCard icon={CheckCircle2} label="Synchronisation" value={summary.sync} hint={`${logsCount} log(s)`} />
      </div>

      <Card className="span-12" title="Confirmer le lot">
        <div className="summary-grid">
          <SummaryItem label="Plan" value={summary.plan} />
          <SummaryItem label="Quantité" value={String(summary.quantity)} />
          <SummaryItem label="Routeur" value={`${summary.router} · ${router.host}`} />
          <SummaryItem label="Serveur Hotspot" value={serverName === "all" ? "All" : serverName} />
          <SummaryItem label="Profil MikroTik" value={plan.profileName} />
          <SummaryItem label="Opérateur" value={summary.operator} />
          <SummaryItem label="Code" value={`${options.prefix ? `${options.prefix} + ` : ""}${options.codeLength} chiffres`} />
          <SummaryItem label="PDF" value="Automatique et archivé" />
        </div>
      </Card>

    </div>
  );
}

function TicketCreationPreviewDialog({
  companyName,
  displaySettings,
  generationProgress,
  isGenerating,
  onBack,
  onConfirm,
  onSettings,
  onSettingsChange,
  open,
  plan,
  previewInput,
  quantity,
  router,
  serverName,
  showSettings
}: {
  companyName: string | null;
  displaySettings: TicketDisplaySettings;
  generationProgress: TicketGenerationProgress | null;
  isGenerating: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onSettings: () => void;
  onSettingsChange: (value: TicketDisplaySettings) => void;
  open: boolean;
  plan: HotspotPlan | null;
  previewInput: TicketPdfInput | null;
  quantity: number;
  router: RouterSummary | null;
  serverName: string;
  showSettings: boolean;
}) {
  if (!open || !plan || !router || !previewInput) return null;

  return (
    <div className="dialog-backdrop ticket-creation-preview-backdrop" role="presentation">
      <section
        aria-busy={isGenerating}
        aria-labelledby="ticket-creation-preview-title"
        aria-modal="true"
        className="router-form-dialog ticket-creation-preview-dialog"
        role="dialog"
      >
        <header className="connection-dialog__header">
          <div className="router-card__icon"><FileText aria-hidden="true" /></div>
          <div>
            <h2 id="ticket-creation-preview-title">Aperçu avant création</h2>
            <p>Aucun utilisateur MikroTik n'est créé tant que vous n'avez pas confirmé.</p>
          </div>
        </header>

        <div className={`ticket-creation-preview-layout ${showSettings ? "ticket-creation-preview-layout--settings" : ""}`}>
          <div className="ticket-creation-preview-main">
            <div className="ticket-creation-preview-summary">
              <SummaryItem label="Routeur" value={router.name} />
              <SummaryItem label="Serveur Hotspot" value={serverName === "all" ? "All" : serverName} />
              <SummaryItem label="Forfait" value={plan.name} />
              <SummaryItem label="Quantité" value={`${quantity} ticket(s)`} />
              <SummaryItem label="Durée d'utilisation" value={formatPlanDurationLabel(plan.durationMinutes)} />
              <SummaryItem label="Durée de validité" value={formatPlanDurationLabel(plan.validityMinutes ?? plan.durationMinutes)} />
              <SummaryItem label="Prix" value={previewInput.priceLabel ?? "Non défini"} />
              <SummaryItem label="Format" value={displaySettings.showQrCode ? "Économique avec QR" : "Économique sans QR"} />
              <SummaryItem label="Mise en page" value="40 par page - 5 colonnes × 8 lignes" />
            </div>
            <TicketPdfPreviewFrame input={previewInput} />
          </div>

          {showSettings ? (
            <aside className="ticket-creation-preview-settings">
              <TicketDisplaySettingsForm
                companyName={companyName}
                dataLimitRequired={plan.dataLimitMb !== null}
                lockedCurrency={normalizeCurrency(plan.currency)}
                onChange={onSettingsChange}
                value={displaySettings}
              />
            </aside>
          ) : null}
        </div>

        {isGenerating && generationProgress ? (
          <div aria-live="polite" className="ticket-generation-progress" role="status">
            <div className="ticket-generation-progress__heading">
              <strong>{generationProgress.label}</strong>
              <span>
                {generationProgress.phase === "creating"
                  ? `${generationProgress.completed}/${generationProgress.total}`
                  : `${Math.round((generationProgress.completed / Math.max(1, generationProgress.total)) * 100)} %`}
              </span>
            </div>
            <progress
              aria-label="Progression de la génération du lot"
              max={generationProgress.total}
              value={generationProgress.completed}
            />
            <small>Le lot sera validé seulement si RouterOS, TicketPro et le PDF contiennent exactement la même quantité.</small>
          </div>
        ) : null}

        <div className="confirm-dialog__actions ticket-creation-preview-actions">
          <Button disabled={isGenerating} icon={ChevronLeft} onClick={onBack} variant="ghost">Retour et modifier</Button>
          <Button disabled={isGenerating} icon={Settings} onClick={onSettings} variant="secondary">
            {showSettings ? "Masquer les paramètres" : "Paramètres du ticket"}
          </Button>
          <Button disabled={isGenerating} icon={Ticket} onClick={onConfirm} variant="primary">
            {isGenerating ? "Création sur RouterOS…" : "Confirmer et créer"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function TicketPdfPreviewFrame({ input }: { input: TicketPdfInput }) {
  const [url, setUrl] = useState<string | null>(null);
  // L'aperçu est un vrai PDF à une seule cellule. Il doit donc porter le même
  // horodatage d'impression que le document final, sans provoquer de rerender
  // continu du modal.
  const printablePreviewInput = useMemo(
    () => ({ ...input, printedAt: new Date().toISOString() }),
    [input]
  );

  useEffect(() => {
    const bytes = generateTicketPdf(printablePreviewInput);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const nextUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [printablePreviewInput]);

  return (
    <div className="ticket-pdf-preview-frame">
      <div className="ticket-pdf-preview-frame__heading">
        <strong>Aperçu fidèle d'un ticket</strong>
        <span>Le PDF final contiendra 40 tickets par page. Le code définitif remplacera XXXXXX et la date affichée sera celle de l'impression.</span>
      </div>
      {url ? <iframe src={`${url}#toolbar=0&navpanes=0&view=Fit`} title="Aperçu d'un voucher" /> : null}
    </div>
  );
}

function StepResult({
  generatedFile,
  onPdf,
  onPrint,
  onTestPrinter,
  onUpdatePrintSettings,
  plan,
  printHistory,
  printers,
  printSettings,
  result,
  router,
  tickets
}: {
  generatedFile: CreateGeneratedFileInput | null;
  onPdf: () => void;
  onPrint: () => void;
  onTestPrinter: () => void;
  onUpdatePrintSettings: (settings: Partial<PrintSettings>) => void;
  plan: HotspotPlan;
  printHistory: PrintHistoryEntry[];
  printers: LocalPrinter[];
  printSettings: PrintSettings;
  result: TicketGenerationResult;
  router: RouterSummary;
  tickets: CreateTicketInput[];
}) {
  return (
    <div className="page-grid">
      <div className="span-4">
        <StatCard icon={Ticket} label="Créés" value={String(result.succeededTickets.length)} hint="Disponibles" />
      </div>
      <div className="span-4">
        <StatCard icon={CheckCircle2} label="Statut" value={result.statusLabel} hint={router.name} />
      </div>
      <div className="span-4">
        <StatCard icon={FileText} label="Valeur" value={result.totalValue === null ? "Non définie" : `${result.totalValue} ${result.batch.currency ?? "CFA"}`} hint={plan.name} />
      </div>

      <Card
        actions={
          <div className="button-row">
            <Button disabled={!result.fileName} icon={FileText} onClick={onPdf} variant="secondary">
              {generatedFile ? "Ouvrir PDF" : "Générer PDF"}
            </Button>
            <Button icon={Printer} onClick={onPrint} variant="secondary">
              Impression
            </Button>
          </div>
        }
        className="span-12"
        title="Résultat"
        description={
          generatedFile
            ? `${generatedFile.file_name} enregistré dans les fichiers.`
            : result.fileName
              ? `${result.fileName} prêt à générer.`
              : "Aucun PDF demandé pour ce lot."
        }
      >
        <div className="summary-grid">
          <SummaryItem label="Plan" value={plan.name} />
          <SummaryItem label="Quantité" value={String(result.batch.quantity)} />
          <SummaryItem label="Routeur" value={router.name} />
          <SummaryItem label="Opérateur" value={roleLabel(result.batch.operator_profile as UserRole)} />
          <SummaryItem label="Statut de synchronisation" value={result.statusLabel} />
          <SummaryItem label="Échecs" value={String(result.failedTickets.length)} />
        </div>
        <div className="ticket-preview-list">
          {tickets.slice(0, 8).map((ticket) => (
            <div className="ticket-preview-item" key={ticket.id}>
              <strong>{ticket.username}</strong>
              <Badge status={statusToBadge(ticket.status)}>
                {ticketStatusLabel(ticket.status as TicketStatus)}
              </Badge>
            </div>
          ))}
        </div>
        <div className="status-legend">
          {ticketStatuses.map((status) => (
            <Badge key={status} status={ticketStatusToBadge(status)}>
              {ticketStatusLabel(status)}
            </Badge>
          ))}
        </div>
      </Card>

      <Card
        actions={
          <div className="button-row">
            <Button icon={Printer} onClick={onTestPrinter}>
              Tester imprimante
            </Button>
            <Button icon={Printer} onClick={onPrint} variant="primary">
              Imprimer le lot
            </Button>
          </div>
        }
        className="span-12"
        title="Préparation impression"
        description="Choisissez le format puis ouvrez le PDF réel pour contrôler exactement le document qui sera imprimé."
      >
        <div className="print-setup-grid">
          <label className="form-field">
            Imprimante
            <select value={printSettings.printerId} onChange={(event) => onUpdatePrintSettings({ printerId: event.target.value })}>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name} - {printerStatusLabel(printer.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Format
            <select
              value={printSettings.format}
              onChange={(event) => onUpdatePrintSettings({ format: event.target.value as PrintPaperFormat })}
            >
              <option value="thermal58">58 mm</option>
              <option value="thermal80">80 mm</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="toggle-option print-economy-toggle">
            <input
              checked={printSettings.economical}
              onChange={(event) => onUpdatePrintSettings({ economical: event.target.checked })}
              type="checkbox"
            />
            <Printer aria-hidden="true" />
            <span>Impression économique</span>
          </label>
        </div>

        <div className="print-history-list">
          <h3>Historique d'impression</h3>
          {printHistory.length > 0 ? (
            printHistory.slice(0, 4).map((entry) => (
              <div className="print-history-row" key={entry.id}>
                <strong>{entry.userMessage}</strong>
                <span>
                  {entry.printerName} · {printFormatLabel(entry.format)} · {entry.ticketCount} ticket(s)
                </span>
              </div>
            ))
          ) : (
            <p>Aucune impression préparée pour ce lot.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function downloadPdf(fileName: string, bytes: Uint8Array) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printHistoryFromRecord(record: PrintHistoryRecord): PrintHistoryEntry {
  return {
    createdAt: record.created_at,
    format: record.format as PrintPaperFormat,
    id: record.id,
    mode: record.mode as PrintHistoryEntry["mode"],
    printerName: record.printer_name,
    status: record.status as PrintHistoryEntry["status"],
    ticketCount: record.ticket_count,
    userMessage: record.user_message
  };
}

function buildPrintTicketFromGeneratedTicket(
  ticket: CreateTicketInput,
  plan: HotspotPlan,
  zoneName: string,
  batchId: string,
  passwordLabel?: string,
  hotspotAddress?: string | null,
  ownerPhone?: string | null,
  displaySettings?: TicketDisplaySettings
) {
  return {
    batchId,
    code: ticket.username,
    contactLabel: displaySettings?.showContact
      ? displaySettings.contactNumber.trim() || ownerPhone?.trim() || undefined
      : undefined,
    dataLimitLabel: formatDataLimit(plan.dataLimitMb),
    durationLabel: plan.durationMinutes >= 60 && plan.durationMinutes % 60 === 0 ? `${plan.durationMinutes / 60} h` : `${plan.durationMinutes} min`,
    hotspotAddress: displaySettings?.showInstructions === false ? undefined : hotspotAddress?.trim() || undefined,
    id: ticket.id,
    passwordLabel: passwordLabel ?? resolveTicketPdfPassword({
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    }),
    planName: plan.name,
    priceLabel: displaySettings?.showPrice === false || plan.priceHint === null
      ? null
      : `${plan.priceHint} ${normalizeCurrency(displaySettings?.currency)}`,
    zoneName
  };
}

function buildCreationPreviewPdfInput(input: {
  accountId: string;
  displaySettings: TicketDisplaySettings;
  hotspotAddress: string;
  options: TicketGenerationState["options"];
  ownerPhone: string;
  plan: HotspotPlan;
  router: RouterSummary;
  titleLabel: string;
}): TicketPdfInput {
  const username = "X".repeat(Math.max(3, Math.min(12, input.options.codeLength)));
  const password = input.options.usernameEqualsPassword ? username : "Y".repeat(username.length);
  const currency = input.displaySettings.currency.trim() || "CFA";
  return {
    accountId: input.accountId,
    batchId: "preview-only",
    createdByProfile: "preview",
    createdByProfileId: "preview",
    currency,
    dataLimitLabel: formatDataLimit(input.plan.dataLimitMb),
    displaySettings: input.displaySettings,
    durationLabel: formatPlanDurationLabel(input.plan.durationMinutes),
    fileName: "apercu-ticketpro.pdf",
    format: "a4",
    generatedAt: new Date().toISOString(),
    hotspotAddress: input.hotspotAddress,
    ownerPhone: input.ownerPhone,
    planName: input.plan.name,
    printedAt: new Date().toISOString(),
    previewMode: "single-ticket",
    priceLabel: input.plan.priceHint === null || !input.displaySettings.showPrice
      ? null
      : `${input.plan.priceHint.toLocaleString("fr-FR")} ${currency}`,
    qrCodeEnabled: input.displaySettings.showQrCode,
    routerId: input.router.id,
    template: input.displaySettings.showQrCode ? "qr" : "economy",
    tickets: [{
      password,
      passwordSecretRef: `preview:///${username}/password`,
      username
    }],
    titleLabel: input.titleLabel,
    validityLabel: formatTicketValidityLabel(input.plan.validityMinutes ?? input.plan.durationMinutes),
    zoneName: input.router.name
  };
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateStep(
  step: TicketGenerationStep,
  state: TicketGenerationState,
  routers: RouterSummary[],
  plans: HotspotPlan[],
  servers: HotspotServer[]
): string | null {
  if (step === 1 && !routers.some((router) => router.id === state.selectedRouterId)) {
    return "Choisissez un routeur.";
  }

  if (step === 2) {
    return validateTicketGeneration(state, routers, plans, servers);
  }

  if (step === 3) {
    const quantity = getSelectedQuantity(state);

    if (
      !Number.isInteger(quantity)
      || quantity < 1
      || quantity > MAX_TICKET_GENERATION_QUANTITY
    ) {
      return `Choisissez une quantité entre 1 et ${MAX_TICKET_GENERATION_QUANTITY}.`;
    }
  }

  if (step === 4) {
    return validateTicketGeneration(state, routers, plans, servers);
  }

  return null;
}

function formatPlanDurationLabel(minutes: number): string {
  if (!minutes) return "Non défini";
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function minutesToRouterOsDuration(minutes: number): string {
  const normalized = Math.max(1, Math.round(minutes));
  const days = Math.floor(normalized / 1440);
  const hours = Math.floor((normalized % 1440) / 60);
  const remainingMinutes = normalized % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", remainingMinutes ? `${remainingMinutes}m` : ""]
    .filter(Boolean)
    .join("") || "1m";
}

function ticketStatusToBadge(status: string): AppStatus {
  if (status === "erreur_sync") {
    return "error";
  }

  if (status === "activé") {
    return "active";
  }

  if (status === "imprimé") {
    return "warning";
  }

  if (status === "disponible" || status === "complété") {
    return "success";
  }

  return "offline";
}

function statusToBadge(status: string): AppStatus {
  return ticketStatusToBadge(status);
}

async function forEachWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, values.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await operation(values[index], index);
    }
  });
  await Promise.all(workers);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  await forEachWithConcurrency(values, concurrency, async (value, index) => {
    results[index] = await operation(value, index);
  });
  return results;
}

function assertCompleteTicketBatch(
  batch: Pick<CreateTicketBatchInput, "id" | "quantity">,
  batchTickets: Pick<CreateTicketInput, "username">[]
): void {
  const uniqueUsernames = new Set(batchTickets.map((ticket) => ticket.username));
  if (batchTickets.length !== batch.quantity || uniqueUsernames.size !== batch.quantity) {
    throw new Error(
      `Lot incomplet : ${uniqueUsernames.size}/${batch.quantity} vouchers uniques sont confirmés sur RouterOS. `
      + "Le PDF et l'impression restent bloqués jusqu'à une synchronisation complète."
    );
  }
}

function assertExactLocalTicketBatch(
  expectedTickets: Pick<CreateTicketInput, "username">[],
  localTickets: Array<{ deleted_at?: string | null; sync_status: SyncStatus; username: string }>
): void {
  const expectedUsernames = new Set(expectedTickets.map((ticket) => ticket.username));
  const activeTickets = localTickets.filter((ticket) => !ticket.deleted_at);
  const localUsernames = new Set(activeTickets.map((ticket) => ticket.username));
  const allExpectedAreSynced = activeTickets.every(
    (ticket) => expectedUsernames.has(ticket.username) && ticket.sync_status === "synced"
  );

  if (
    expectedUsernames.size !== expectedTickets.length
    || activeTickets.length !== expectedTickets.length
    || localUsernames.size !== expectedTickets.length
    || [...expectedUsernames].some((username) => !localUsernames.has(username))
    || !allExpectedAreSynced
  ) {
    throw new Error(
      `Intégrité locale refusée : ${localUsernames.size}/${expectedTickets.length} vouchers uniques sont confirmés dans TicketPro. `
      + "Le PDF reste bloqué jusqu'à une synchronisation complète."
    );
  }
}

function readGenerationError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const candidate = error as { error?: unknown; message?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error.trim();
    }
  }
  return fallback;
}
