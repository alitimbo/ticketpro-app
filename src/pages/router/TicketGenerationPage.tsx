import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Hash, Printer, RefreshCw, Settings, Ticket, Wifi } from "lucide-react";
import type { HotspotPlan, HotspotServer, HotspotUser, RouterSummary } from "../../domain/router";
import type {
  CreateGeneratedFileInput,
  CreateTicketBatchInput,
  CreateTicketInput,
  PrintHistoryRecord,
  SyncStatus
} from "../../domain/database";
import type { UserRole } from "../../domain/auth";
import { useAuth } from "../../app/auth/AuthProvider";
import { AuthorizationError, requireProfilePermission } from "../../services/auth";
import {
  createPersistedRouterService,
  FakeRouterAdapter,
  RouterService,
  RouterServiceError,
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
import {
  buildGeneratedTicketPdfRecord,
  generateTicketPdf,
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
  getSelectedQuantity,
  getTicketSummary,
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
  defaultTicketDisplaySettings,
  normalizeTicketDisplaySettings,
  resolveTicketTitle,
  TicketDisplaySettingsService,
  type TicketDisplaySettings,
  TicketCodeGenerator
} from "../../services/tickets";
import { TauriFileService } from "../../services/files";
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
  const [catalogStatus, setCatalogStatus] = useState<RouterCatalogStatus>("loading");
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

  const refreshRouterCatalog = async () => {
    setCatalogStatus("loading");
    setError(null);
    setMessage(null);
    let catalogService: RouterService;
    try {
      catalogService = await getRouterServiceForAction();
    } catch (connectionError) {
      setCatalogStatus("error");
      setError(connectionError instanceof Error ? connectionError.message : "Connexion au routeur indisponible.");
      return;
    }
    try {
      const [routerServers, routerPlans, localPlanRecords] = await Promise.all([
        catalogService.getHotspotServers(),
        catalogService.getHotspotPlans(),
        isPersistent ? planRepository.listByRouter(routerId) : Promise.resolve([])
      ]);
      const enabledServers = routerServers.filter((server) => server.isEnabled);
      let livePlans = routerPlans;
      if (isPersistent) {
        const recordsByProfile = new Map(
          localPlanRecords.map((record) => [record.mikrotik_profile_name ?? record.name, record])
        );
        for (const remotePlan of routerPlans) {
          if (recordsByProfile.has(remotePlan.profileName)) continue;
          const created = await planRepository.create({
            data_limit_mb: remotePlan.dataLimitMb,
            download_limit: remotePlan.downloadLimit,
            duration_minutes: remotePlan.durationMinutes,
            id: `plan-${routerId}-${catalogSlug(remotePlan.profileName)}`,
            mikrotik_profile_name: remotePlan.profileName,
            name: remotePlan.name,
            price_hint: remotePlan.priceHint,
            router_id: routerId,
            shared_users: remotePlan.sharedUsers,
            status: remotePlan.status,
            sync_status: "synced",
            upload_limit: remotePlan.uploadLimit,
            validity_minutes: remotePlan.validityMinutes
          });
          recordsByProfile.set(remotePlan.profileName, created);
        }
        livePlans = routerPlans.map((remotePlan) => {
          const local = recordsByProfile.get(remotePlan.profileName);
          return local
            ? {
                ...remotePlan,
                id: local.id,
                name: local.name,
                priceHint: local.price_hint,
                validityMinutes: local.validity_minutes ?? remotePlan.validityMinutes
              }
            : remotePlan;
        });
      }
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
  const previewPdfInput = session && selectedRouter && selectedPlan
    ? buildCreationPreviewPdfInput({
        accountId: session.account_id,
        displaySettings,
        hotspotAddress: ticketHotspotAddress,
        options: state.options,
        plan: selectedPlan,
        router: selectedRouter,
        titleLabel: ticketTitle,
        ownerPhone: ticketContact
      })
    : null;

  const updateState = (partial: Partial<TicketGenerationState>) => {
    setError(null);
    setMessage(null);
    setState((current) => ({ ...current, ...partial }));
  };

  const updateDisplaySettings = (next: TicketDisplaySettings) => {
    const normalized = normalizeTicketDisplaySettings(next);
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

    updateState({ step: (state.step + 1) as TicketGenerationStep });
  };

  const goBack = () => {
    if (state.step <= 1 || isGenerating) {
      return;
    }

    updateState({ step: (state.step - 1) as TicketGenerationStep });
  };

  const generateTickets = async () => {
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
    setIsGenerating(true);
    setError(null);
    setMessage(null);

    const batchId = createBatchId();
    const requestedQuantity = getSelectedQuantity(state);
    const succeededTickets: CreateTicketInput[] = [];
    const failedTickets: CreateTicketInput[] = [];
    let firstCreationError: string | null = null;

    try {
      const generationService = await getRouterServiceForAction();
      await generationService.ensureVoucherLifecycleEngine();
      const [existingUsers, existingLocalTickets, remotePlans, remoteServers] = await Promise.all([
        generationService.listHotspotUsers(),
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
          ? { ...liveSelectedPlan, id: plan.id, name: plan.name, priceHint: plan.priceHint }
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
      const generatedCredentials = await mapWithConcurrency(
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
      const pendingTickets = generatedCredentials.map((credential) =>
        buildTicketRecord({
          accountId: session.account_id,
          batchId,
          createdByProfileId: session.internal_profile_id,
          createdByProfile: session.internal_profile_role,
          mikrotikId: null,
          passwordSecretRef: credential.passwordSecretRef,
          planId: state.selectedPlanId,
          profileName: selectedPlan.profileName,
          routerId: state.selectedRouterId,
          serverName: selectedRemoteServer,
          status: "erreur_sync",
          syncStatus: "pending",
          username: credential.username
        })
      );
      const pendingBatch = buildTicketBatch({
        accountId: session.account_id,
        id: batchId,
        operatorProfileId: session.internal_profile_id,
        operatorRole: session.internal_profile_role,
        options: state.options,
        planId: state.selectedPlanId,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        serverName: selectedRemoteServer,
        syncStatus: "pending"
      });

      // Persist the complete intent before touching RouterOS. If the process is
      // interrupted, every unconfirmed voucher remains recoverable from Tickets.
      if (isPersistent) {
        await batchRepository.createWithTickets(pendingBatch, pendingTickets);
      }

      await forEachWithConcurrency(generatedCredentials, 3, async (credential, credentialIndex) => {
        try {
          const createdUser = await generationService.createHotspotUser({
            comment: `Lot ${batchId}`,
            limitBytesTotal: selectedPlan.dataLimitMb === null
              ? null
              : Math.round(selectedPlan.dataLimitMb * 1024 * 1024),
            limitUptime: minutesToRouterOsDuration(selectedPlan.durationMinutes),
            passwordSecretRef: credential.passwordSecretRef,
            planId: state.selectedPlanId,
            serverName: selectedRemoteServer,
            username: credential.username,
            validityMinutes: selectedPlan.validityMinutes ?? selectedPlan.durationMinutes
          });

          const succeededTicket = userToTicketRecord({
            accountId: session.account_id,
            batchId,
            createdByProfileId: session.internal_profile_id,
            createdByProfile: session.internal_profile_role,
            routerId: state.selectedRouterId,
            passwordSecretRef: credential.passwordSecretRef,
            planId: state.selectedPlanId,
            user: createdUser
          });
          succeededTickets.push(succeededTicket);
          if (isPersistent) await ticketRepository.update(succeededTicket);
        } catch (creationError) {
          const creationErrorMessage = readGenerationError(
            creationError,
            "RouterOS a refusé la création du voucher."
          );
          firstCreationError ??= creationErrorMessage;
          let recoveredUser: HotspotUser | null = null;

          if (isPersistent) {
            try {
              recoveredUser = (await generationService.listHotspotUsers()).find(
                (user) => user.username === credential.username
              ) ?? null;
            } catch {
              recoveredUser = null;
            }
          }

          if (recoveredUser && recoveredUser.profileName === selectedPlan.profileName) {
            const succeededTicket = userToTicketRecord({
              accountId: session.account_id,
              batchId,
              createdByProfileId: session.internal_profile_id,
              createdByProfile: session.internal_profile_role,
              passwordSecretRef: credential.passwordSecretRef,
              planId: state.selectedPlanId,
              routerId: state.selectedRouterId,
              user: recoveredUser
            });
            succeededTickets.push(succeededTicket);
            if (isPersistent) await ticketRepository.update(succeededTicket);
            return;
          }

          failedTickets.push(pendingTickets[credentialIndex]);
          setLogs((current) => [
            ...current,
            {
              action: "createHotspotUser",
              level: "error",
              technicalCode: creationError instanceof RouterServiceError ? creationError.code : undefined,
              technicalMessage: creationError instanceof RouterServiceError
                ? creationError.technicalMessage
                : creationErrorMessage,
              userMessage: `Le voucher ${credential.username} reste en attente : ${creationErrorMessage}`
            }
          ]);
        }
      });

      const syncStatus: SyncStatus = failedTickets.length > 0 ? "pending" : "synced";
      const batch = buildTicketBatch({
        accountId: session.account_id,
        id: batchId,
        operatorProfileId: session.internal_profile_id,
        operatorRole: session.internal_profile_role,
        options: state.options,
        planId: state.selectedPlanId,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        serverName: selectedRemoteServer,
        syncStatus
      });
      const fileName = buildFileName({
        batchId,
        planName: selectedPlan.name,
        priceCfa: selectedPlan.priceHint,
        quantity: requestedQuantity,
        routerName: selectedRouter.name
      });

      if (isPersistent) await batchRepository.updateState(batch.id, batch.account_id, batch.status, syncStatus);

      setTickets([...succeededTickets, ...failedTickets]);
      let createdPdf: CreateGeneratedFileInput | null = null;
      let pdfError: string | null = null;
      if (fileName) {
        try {
          if (succeededTickets.length > 0) {
            createdPdf = await createAndStorePdf(batch, succeededTickets, fileName);
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
          : pdfError
          ? `${succeededTickets.length} ticket(s) créé(s). PDF à reprendre : ${pdfError}`
          : `${succeededTickets.length} ticket(s) créés avec succès${createdPdf ? " et PDF enregistré." : "."}`
      );
    } catch (generationError) {
      setError(readGenerationError(generationError, "La génération des tickets a échoué."));
    } finally {
      setIsGenerating(false);
    }
  };

  const primaryActionLabel = state.step === 5 ? "Prévisualiser et continuer" : "Continuer";

  const createAndStorePdf = async (
    batch: CreateTicketBatchInput,
    pdfTickets: CreateTicketInput[],
    fileName: string,
    output?: { format: TicketPdfFormat; recordId: string }
  ): Promise<CreateGeneratedFileInput> => {
    if (!selectedPlan || !selectedRouter) {
      throw new Error("Le plan ou le routeur du PDF est introuvable.");
    }
    if (isPersistent && !ticketHotspotAddress) {
      throw new Error(
        "Configurez d'abord l'adresse Hotspot dans Paramètres routeur afin qu'elle figure sur chaque ticket."
      );
    }
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
      fileName,
      format: output?.format ?? "a4",
      displaySettings,
      ownerPhone: ticketContact,
      priceLabel: selectedPlan.priceHint === null || !displaySettings.showPrice
        ? null
        : `${selectedPlan.priceHint.toLocaleString("fr-FR")} ${displaySettings.currency.trim() || "CFA"}`,
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
    if (isPersistent) {
      await Promise.all(pdfTickets.map(async (ticket) => {
        ticket.exported_at = generatedAt;
        await ticketRepository.update(ticket);
      }));
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

    if (generatedFile) {
      if (isPersistent) {
        await fileService.open(generatedFile.file_path);
      }
      setMessage(`${generatedFile.file_name} ouvert.`);
      return generatedFile;
    }

    const printableTickets = tickets.filter((ticket) => ticket.sync_status === "synced");
    if (printableTickets.length === 0) {
      setMessage("Aucun voucher synchronisé n'est disponible pour le PDF.");
      return null;
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
    if (printableTickets.length === 0) {
      setError("Aucun voucher synchronisé n'est disponible pour l'impression.");
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
        actions={
          <Button disabled={isGenerating || state.step !== 5} icon={FileText} onClick={openCreationPreview} size="large" variant="primary">
            Prévisualiser et continuer
          </Button>
        }
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
          displaySettings={displaySettings}
          generatedFile={generatedFile}
          onPdf={() => void generatePdf()}
          onPrint={() => void printBatch()}
          onTestPrinter={() => void testPrinter()}
          onUpdatePrintSettings={(partial) => setPrintSettings((current) => ({ ...current, ...partial }))}
          ownerPhone={ownerPhone}
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
        displaySettings={displaySettings}
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
  onRefresh,
  onSelect,
  onServerSelect,
  plans,
  selectedPlanId,
  selectedServerName,
  servers
}: {
  onRefresh: () => void;
  onSelect: (planId: string) => void;
  onServerSelect: (serverName: string) => void;
  plans: HotspotPlan[];
  selectedPlanId: string;
  selectedServerName: string;
  servers: HotspotServer[];
}) {
  const enabledServers = servers.filter((server) => server.isEnabled);
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
        <div className="ticket-server-selection__status">
          <Wifi aria-hidden="true" />
          <span>{enabledServers.length} serveur(s) Hotspot actif(s) lu(s) sur RouterOS.</span>
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
              <span>{plan.priceHint ? `${plan.priceHint} CFA` : "Prix non défini"}</span>
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
          max="500"
          value={state.customQuantity}
          onChange={(event) => onChange({ customQuantity: event.target.value, quantity: "custom" })}
        />
        <small>Entre 1 et 500 tickets par lot.</small>
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
  logsCount,
  options,
  plan,
  quantity,
  router,
  serverName,
  summary
}: {
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
        <StatCard icon={FileText} label="Valeur totale" value={summary.totalValue === null ? "Non définie" : `${summary.totalValue} CFA`} hint={plan.name} />
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
                onChange={onSettingsChange}
                value={displaySettings}
              />
            </aside>
          ) : null}
        </div>

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

  useEffect(() => {
    const bytes = generateTicketPdf(input);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const nextUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [input]);

  return (
    <div className="ticket-pdf-preview-frame">
      <div className="ticket-pdf-preview-frame__heading">
        <strong>Aperçu fidèle du PDF A4</strong>
        <span>Les codes définitifs remplaceront XXXXXX après confirmation.</span>
      </div>
      {url ? <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title="Aperçu PDF des vouchers" /> : null}
    </div>
  );
}

function StepResult({
  displaySettings,
  generatedFile,
  onPdf,
  onPrint,
  onTestPrinter,
  onUpdatePrintSettings,
  ownerPhone,
  plan,
  printHistory,
  printers,
  printSettings,
  result,
  router,
  tickets
}: {
  displaySettings: TicketDisplaySettings;
  generatedFile: CreateGeneratedFileInput | null;
  onPdf: () => void;
  onPrint: () => void;
  onTestPrinter: () => void;
  onUpdatePrintSettings: (settings: Partial<PrintSettings>) => void;
  ownerPhone: string | null;
  plan: HotspotPlan;
  printHistory: PrintHistoryEntry[];
  printers: LocalPrinter[];
  printSettings: PrintSettings;
  result: TicketGenerationResult;
  router: RouterSummary;
  tickets: CreateTicketInput[];
}) {
  const printTickets = tickets.map((ticket) =>
    buildPrintTicketFromGeneratedTicket(
      ticket,
      plan,
      router.name,
      result.batch.id,
      undefined,
      router.hotspotAddress,
      ownerPhone,
      displaySettings
    )
  );
  const preview = new LocalPrintService().buildPreview(printTickets, printSettings);

  return (
    <div className="page-grid">
      <div className="span-4">
        <StatCard icon={Ticket} label="Créés" value={String(result.succeededTickets.length)} hint="Disponibles" />
      </div>
      <div className="span-4">
        <StatCard icon={CheckCircle2} label="Statut" value={result.statusLabel} hint={router.name} />
      </div>
      <div className="span-4">
        <StatCard icon={FileText} label="Valeur" value={result.totalValue === null ? "Non définie" : `${result.totalValue} CFA`} hint={plan.name} />
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
        description="Préparez une impression thermique tout en gardant l'export PDF disponible."
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

        <div className="print-preview-layout">
          <div className={`print-preview-ticket print-preview-ticket--${printSettings.format}`}>
            <span>Aperçu fidèle {preview.paperWidthLabel}</span>
            {preview.ticket ? (
              <div className="thermal-ticket-preview">
                <div className="thermal-ticket-preview__zone">{preview.ticket.zoneName}</div>
                {!printSettings.economical ? <div className="thermal-ticket-preview__plan">{preview.ticket.planName}</div> : null}
                <div className="thermal-ticket-preview__credentials">
                  <small>LOGIN</small>
                  <strong>{preview.ticket.code}</strong>
                  {preview.ticket.passwordLabel !== preview.ticket.code ? (
                    <><hr /><small>MOT DE PASSE</small><strong>{preview.ticket.passwordLabel}</strong></>
                  ) : null}
                </div>
                <div className="thermal-ticket-preview__details">
                  <span>{preview.ticket.durationLabel}{preview.ticket.dataLimitLabel ? ` - ${preview.ticket.dataLimitLabel}` : ""}</span>
                  {preview.ticket.priceLabel ? <strong>{preview.ticket.priceLabel}</strong> : null}
                </div>
                <div className="thermal-ticket-preview__footer">
                  {preview.ticket.hotspotAddress ? <strong>Portail : {preview.ticket.hotspotAddress}</strong> : null}
                  {preview.ticket.contactLabel ? <span>Contact : {preview.ticket.contactLabel}</span> : null}
                </div>
              </div>
            ) : <strong>Aucun ticket disponible.</strong>}
            <small>Longueur estimée : {preview.estimatedLengthMm} mm par ticket</small>
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
    dataLimitLabel: plan.dataLimitMb ? `${plan.dataLimitMb} MB` : null,
    durationLabel: plan.durationMinutes >= 60 && plan.durationMinutes % 60 === 0 ? `${plan.durationMinutes / 60} h` : `${plan.durationMinutes} min`,
    hotspotAddress: displaySettings?.showInstructions === false ? undefined : hotspotAddress?.trim() || undefined,
    id: ticket.id,
    passwordLabel: passwordLabel ?? resolveTicketPdfPassword({
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    }),
    planName: plan.name,
    priceLabel: displaySettings?.showPrice === false || plan.priceHint === null ? null : `${plan.priceHint} CFA`,
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
    dataLimitLabel: input.plan.dataLimitMb ? `${input.plan.dataLimitMb} MB` : null,
    displaySettings: input.displaySettings,
    durationLabel: formatPlanDurationLabel(input.plan.durationMinutes),
    fileName: "apercu-ticketpro.pdf",
    format: "a4",
    generatedAt: new Date().toISOString(),
    hotspotAddress: input.hotspotAddress,
    ownerPhone: input.ownerPhone,
    planName: input.plan.name,
    priceLabel: input.plan.priceHint === null || !input.displaySettings.showPrice
      ? null
      : `${input.plan.priceHint.toLocaleString("fr-FR")} ${currency}`,
    qrCodeEnabled: input.displaySettings.showQrCode,
    routerId: input.router.id,
    template: input.displaySettings.showQrCode ? "qr" : "economy",
    tickets: Array.from({ length: 40 }, () => ({
      password,
      passwordSecretRef: `preview:///${username}/password`,
      username
    })),
    titleLabel: input.titleLabel,
    validityLabel: formatPlanDurationLabel(input.plan.validityMinutes ?? input.plan.durationMinutes),
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

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      return "Choisissez une quantité entre 1 et 500.";
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

function catalogSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
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
