import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { refreshRouterSnapshot } from "./routerRecoveryRefresh";
import {
  AlertTriangle,
  Edit3,
  Eye,
  Filter,
  Laptop,
  LoaderCircle,
  MapPin,
  Plus,
  Router,
  Save,
  Search,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import type { RouterErrorCode, RouterSystemInfo } from "../../domain/router";
import { useAuth } from "../../app/auth/AuthProvider";
import { AuthorizationError, requireProfilePermission } from "../../services/auth";
import { decryptLocalSecret, encryptLocalSecret } from "../../services/security/localSecrets";
import { RouterConnectionRepository, RouterRepository, useAppDatabase } from "../../services/database";
import {
  createPersistedRouterService,
  FakeRouterAdapter,
  RouterService,
  RouterServiceError,
  type RouterActionLog
} from "../../services/router";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterButton,
  PageHeader,
  PasswordField,
  StatusDot
} from "../../shared/ui";
import {
  createRouterFromForm,
  demoRouters,
  describeRouterAvailability,
  emptyRouterFormValues,
  filterRouters,
  formValuesFromRouter,
  getRouterLimitMessage,
  isValidHotspotDnsName,
  isRemoteConnectionMode,
  listRoutersForAccount,
  mapRouterErrorToTestStatus,
  nextRouterHealthCheckDelayMs,
  normalizeHotspotDnsName,
  routerAvailabilityFromTest,
  routerPageScopeKey,
  routerCardFromRecord,
  routerConnectionInputsFromCard,
  routerRecordFromCard,
  remoteVpnPathForRouter,
  routerTestMessage,
  shouldPauseRouterStatusRefresh,
  type RouterAvailabilityDisplay,
  type RouterCardData,
  type RouterConnectionTestStatus,
  type RouterLiveAvailability,
  type RouterFilter,
  type RouterFormValues
} from "./routerPageModel";
import { countRoutersForSubscription, getSubscriptionOverview } from "./subscriptionPageModel";
import { RouterCloudRecoveryService } from "../../services/recovery";
import {
  completeSaasRouterDecommission,
  prepareSaasRouterDecommission,
  reportSaasRouterDecommissionFailure
} from "../../services/saas";

const statusLabels: Record<RouterCardData["status"], string> = {
  active: "Connecté",
  offline: "Hors ligne",
  warning: "À vérifier"
};

type RouterFormState = {
  detectedInfo: RouterSystemInfo | null;
  error: string | null;
  mode: "add" | "edit";
  router: RouterCardData | null;
  testMessage: string | null;
  testStatus: RouterConnectionTestStatus;
  values: RouterFormValues;
};

type RouterFormOperation = "testing" | "saving" | null;

export function RoutersPage() {
  const navigate = useNavigate();
  const { accountSession, saasAccount, session, userCan } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const organizationId = saasAccount?.organization.id ?? null;
  const internalProfileId = session?.internal_profile_id ?? null;
  const canAddRouter = userCan("global.routers.add");
  const canEditRouter = userCan("global.routers.edit");
  const canDeleteRouter = userCan("global.routers.delete");
  const canViewSubscription = userCan("global.subscription");
  const [routers, setRouters] = useState<RouterCardData[]>(() => (isPersistent ? [] : demoRouters));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RouterFilter>("all");
  const [selectedRouter, setSelectedRouter] = useState<RouterCardData | null>(null);
  const [routerToDelete, setRouterToDelete] = useState<RouterCardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [formState, setFormState] = useState<RouterFormState | null>(null);
  const [formOperation, setFormOperation] = useState<RouterFormOperation>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<string | null>(null);
  const [connectingRouterIds, setConnectingRouterIds] = useState<Set<string>>(() => new Set());
  const [availability, setAvailability] = useState<Record<string, RouterLiveAvailability>>({});
  const availabilityRef = useRef<Record<string, RouterLiveAvailability>>({});
  const [availabilityClock, setAvailabilityClock] = useState(() => Date.now());
  const connectionAttemptsRef = useRef<Set<string>>(new Set());
  const routersForHealthCheckRef = useRef<RouterCardData[]>([]);
  const currentScopeKey = routerPageScopeKey(accountId, organizationId);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const recoveryService = useMemo(
    () => accountId && internalProfileId
      ? new RouterCloudRecoveryService(
          database,
          accountId,
          internalProfileId,
          undefined,
          organizationId
        )
      : null,
    [accountId, database, internalProfileId, organizationId]
  );

  useEffect(() => {
    // Uniquement un vrai changement de compte ou d'organisation peut fermer
    // les actions en cours. Le rafraîchissement périodique de la session doit
    // préserver intégralement le formulaire et ses valeurs.
    setRouters([]);
    setSelectedRouter(null);
    setRouterToDelete(null);
    setFormState(null);
    setFormOperation(null);
  }, [currentScopeKey]);

  useEffect(() => {
    if (!isInitialized || !accountId) return undefined;
    let mounted = true;
    const scopedAccountId = accountId;
    const selectedOrganizationId = organizationId;

    let loading = false;
    let initialBackupDone = false;
    async function loadRouters() {
      if (loading) return;
      loading = true;
      try {
        let records = selectedOrganizationId
          ? await routerRepository.listByOrganization(scopedAccountId, selectedOrganizationId)
          : await routerRepository.listByAccount(scopedAccountId);
        // Render the scoped local snapshot before waiting for the network.
        const localCards = await Promise.all(records.map(async (record) =>
          routerCardFromRecord(record, await connectionRepository.listByRouter(record.id))));
        if (mounted) setRouters(localCards.length > 0 || isPersistent ? localCards : demoRouters);
        let recoverySucceeded = !isPersistent;
        if (isPersistent && recoveryService) {
          const refreshed = await refreshRouterSnapshot(
            () => recoveryService.restoreMissingRouters(),
            () => selectedOrganizationId
              ? routerRepository.listByOrganization(scopedAccountId, selectedOrganizationId)
              : routerRepository.listByAccount(scopedAccountId),
            (error) => { if (mounted) setMessage(readUnknownError(error, "Synchronisation indisponible. Les routeurs locaux restent accessibles.")); }
          );
          recoverySucceeded = refreshed.succeeded;
          records = refreshed.records;
          const recovery = refreshed.recovery;
          if (recovery && recovery.restoredRouterIds.length > 0 && mounted) {
            setMessage(
              `${recovery.restoredRouterIds.length} routeur(s) restauré(s) depuis le coffre TicketPro. Vérification réelle en attente.`
            );
          }
        }
        if (isPersistent && recoverySucceeded && records.length > 0 && recoveryService && canEditRouter && !initialBackupDone) {
          initialBackupDone = true;
          void Promise.all(records.map((record) => recoveryService.backupRouter(record.id))).catch(() => {
            // La sauvegarde sera retentée au prochain chargement sans bloquer le travail local.
          });
        }
        const cards = await Promise.all(
          records.map(async (record) =>
            routerCardFromRecord(record, await connectionRepository.listByRouter(record.id))
          )
        );
        if (mounted) setRouters(cards.length > 0 || isPersistent ? cards : demoRouters);
      } catch (error) {
        if (!mounted) return;
        setMessage(readUnknownError(error, "Impossible de charger les routeurs."));
        // Keep the last scoped snapshot; account/organization changes clear it separately.
      } finally {
        loading = false;
      }
    }

    void loadRouters();
    const refresh = () => { if (document.visibilityState !== "hidden") void loadRouters(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      mounted = false;
    };
  }, [
    accountId,
    canEditRouter,
    connectionRepository,
    isInitialized,
    isPersistent,
    recoveryService,
    routerRepository,
    organizationId
  ]);

  const accountRouters = useMemo(() => {
    const scopedRouters = listRoutersForAccount(routers, accountId);
    if (!saasAccount || saasAccount.user.router_access.mode === "all") return scopedRouters;
    const allowed = new Set(saasAccount.user.router_access.router_ids);
    return scopedRouters.filter((router) => allowed.has(router.cloudRouterId ?? router.id));
  }, [accountId, routers, saasAccount]);
  useEffect(() => {
    routersForHealthCheckRef.current = accountRouters;
  }, [accountRouters]);
  const visibleRouters = useMemo(() => filterRouters(accountRouters, query, filter), [accountRouters, filter, query]);
  const routerHealthScopeKey = useMemo(
    () => accountRouters.map((router) => [
      router.id,
      router.preferredMode,
      router.ipAddress,
      router.remoteHost,
      router.remotePort,
      router.username,
      router.encryptedPassword
    ].join(":"))
      .sort()
      .join("|"),
    [accountRouters]
  );
  const pauseRouterStatusRefresh = shouldPauseRouterStatusRefresh({
    connectionDialogOpen: selectedRouter !== null,
    deleteDialogOpen: routerToDelete !== null,
    formDialogOpen: formState !== null
  });
  const subscriptionOverview = useMemo(
    () => getSubscriptionOverview(
      countRoutersForSubscription(accountRouters),
      accountId ?? undefined,
      Date.now(),
      saasAccount?.subscription
    ),
    [accountId, accountRouters, saasAccount?.subscription]
  );
  const quotaMessage = getRouterLimitMessage(subscriptionOverview.canAddRouter);
  const canStartRouterCreation = canAddRouter && subscriptionOverview.canAddRouter;

  const openAddForm = () => {
    try {
      requireProfilePermission(session, "global.routers.add");
    } catch (permissionError) {
      setMessage(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission d'ajouter un routeur.");
      return;
    }
    if (!subscriptionOverview.canAddRouter) {
      setMessage(quotaMessage);
      return;
    }
    setFormOperation(null);
    setFormState({
      detectedInfo: null,
      error: null,
      mode: "add",
      router: null,
      testMessage: null,
      testStatus: "not_tested",
      values: emptyRouterFormValues
    });
  };

  const openEditForm = (router: RouterCardData) => {
    try {
      requireProfilePermission(session, "global.routers.edit");
    } catch (permissionError) {
      setMessage(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission de modifier ce routeur.");
      return;
    }
    setFormOperation(null);
    setFormState({
      detectedInfo: {
        architecture: "",
        boardName: router.boardName,
        identity: router.routerName || router.zoneName,
        model: router.model,
        routerOsVersion: router.routerOsVersion,
        serialNumber: router.serialNumber,
        uptime: ""
      },
      error: null,
      mode: "edit",
      router,
      testMessage: router.lastTestMessage,
      testStatus: router.lastTestStatus,
      values: formValuesFromRouter(router)
    });
  };

  const updateFormValues = (values: RouterFormValues) => {
    if (!formState) return;
    const connectionChanged = connectionFingerprint(formState.values) !== connectionFingerprint(values);
    setFormState({
      ...formState,
      detectedInfo: connectionChanged ? null : formState.detectedInfo,
      error: null,
      testMessage: connectionChanged ? "Connexion modifiée : effectuez un nouveau test." : formState.testMessage,
      testStatus: connectionChanged ? "not_tested" : formState.testStatus,
      values
    });
  };

  const activateRouterMode = async (
    router: RouterCardData,
    mode: RouterFormValues["preferredMode"]
  ) => {
    if (isRemoteConnectionMode(mode) && !router.remoteHost.trim()) {
      setSelectedRouter(null);
      setMessage("Aucune adresse distante n'est configurée. Modifiez le routeur avant d'utiliser cette action.");
      if (canEditRouter) openEditForm(router);
      return;
    }

    const updatedRouter = { ...router, preferredMode: mode };
    try {
      if (isPersistent) {
        if (!accountId || !session) throw new Error("Session du compte introuvable.");
        await routerRepository.update(routerRecordFromCard(updatedRouter));
        await connectionRepository.replaceForRouter(updatedRouter.id, routerConnectionInputsFromCard(updatedRouter));
      }
      setRouters((current) => current.map((item) => (item.id === updatedRouter.id ? updatedRouter : item)));
      setSelectedRouter(null);
      navigate(`/routeurs/${updatedRouter.id}/maison`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le mode de connexion n'a pas pu être sélectionné.");
    }
  };

  const enterSelectedRouter = async (mode: RouterFormValues["preferredMode"]) => {
    if (selectedRouter) await activateRouterMode(selectedRouter, mode);
  };

  const testConnection = async (router: RouterCardData, options: { silent?: boolean } = {}) => {
    if (connectionAttemptsRef.current.has(router.id)) return;
    connectionAttemptsRef.current.add(router.id);
    // Les contrôles de santé périodiques actualisent l'état sans faire clignoter
    // chaque carte. Le retour visuel reste réservé au test déclenché par l'utilisateur.
    if (!options.silent) {
      setConnectingRouterIds((current) => new Set(current).add(router.id));
    }
    if (!options.silent) setMessage("Test de connexion en cours…");

    try {
      const runForMode = (mode: RouterFormValues["preferredMode"]) => runRouterConnectionTest({
          apiPort: router.apiPort,
          encryptedPassword: router.encryptedPassword,
          ipAddress: router.ipAddress,
          mode,
          password: "",
          remoteHost: router.remoteHost,
          remotePort: String(router.remotePort),
          remoteUseSsl: router.remoteUseSsl,
          statusHint: router.status,
          username: router.username
        });
      let testedMode = router.preferredMode;
      let result = await runForMode(testedMode);
      const alternateMode = testedMode === "local" && router.remoteHost.trim()
        ? router.remoteMode
        : testedMode !== "local" ? "local" : null;
      if (result.status !== "connected" && alternateMode) {
        const alternateResult = await runForMode(alternateMode);
        if (alternateResult.status === "connected") {
          result = alternateResult;
          testedMode = alternateMode;
        }
      }

      if (isPersistent && accountId && session) {
        try {
          const cardStatus = routerCardStatusFromTestStatus(result.status);
          if (result.status === "connected" && testedMode !== router.preferredMode) {
            await routerRepository.setPreferredConnectionMode(accountId, router.id, testedMode);
          }
          await routerRepository.recordConnectionTest({
            accountId,
            checkedAt: new Date().toISOString(),
            errorMessage: result.status === "connected" ? null : result.message,
            internalProfileId: session.internal_profile_id,
            mode: testedMode,
            routerId: router.id,
            status: cardStatus === "active" ? "connected" : cardStatus
          });
        } catch {
          if (!options.silent) setMessage("Connexion testée, mais le résultat n'a pas pu être enregistré.");
        }
      }

      const nextAvailability: RouterLiveAvailability = {
        checkedAt: Date.now(),
        state: routerAvailabilityFromTest(result.status, result.readFailed)
      };
      availabilityRef.current = { ...availabilityRef.current, [router.id]: nextAvailability };
      setAvailability(availabilityRef.current);
      setRouters((current) =>
        current.map((item) => (item.id === router.id
          ? applyTestResult(
              { ...item, preferredMode: result.status === "connected" ? testedMode : item.preferredMode },
              result.status,
              result.message,
              result.systemInfo
            )
          : item))
      );
      if (!options.silent) setMessage(result.message);
    } finally {
      connectionAttemptsRef.current.delete(router.id);
      if (!options.silent) {
        setConnectingRouterIds((current) => {
          const next = new Set(current);
          next.delete(router.id);
          return next;
        });
      }
    }
  };

  const submitForm = async () => {
    if (!formState || formOperation) return;
    const validationError = validateRouterForm(formState);
    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }

    if (!session || !accountId) {
      setFormState({ ...formState, error: "Session du compte ou du profil interne introuvable." });
      return;
    }

    setFormOperation("saving");
    let encryptedPassword: string;
    try {
      encryptedPassword = formState.values.password.trim()
        ? await encryptLocalSecret(formState.values.password)
        : formState.router?.encryptedPassword ?? "";
    } catch {
      setFormState({ ...formState, error: "Le mot de passe du routeur n'a pas pu être protégé localement." });
      setFormOperation(null);
      return;
    }

    if (formState.mode === "add") {
      try {
        requireProfilePermission(session, "global.routers.add");
        if (!subscriptionOverview.canAddRouter) throw new Error(quotaMessage ?? "Limite de routeurs atteinte.");
        const hotspotDns = await upsertFormHotspotDns(formState);
        const created = applyTestResult(
          createRouterFromForm(formState.values, encryptedPassword, formState.detectedInfo, undefined, {
            accountId,
            createdByProfileId: session.internal_profile_id,
            organizationId: saasAccount?.organization.id ?? null
          }),
          formState.testStatus,
          formState.testMessage,
          formState.detectedInfo
        );
        if (isPersistent) {
          await routerRepository.createWithConnections(
            routerRecordFromCard(created),
            routerConnectionInputsFromCard(created)
          );
        }
        let cloudSuffix = "";
        if (isPersistent && recoveryService) {
          try {
            await recoveryService.backupRouter(created.id);
          } catch {
            cloudSuffix = " Sauvegarde VPS en attente ; elle sera retentée automatiquement.";
          }
        }
        setRouters((current) => [created, ...current]);
        setMessage(
          `${created.zoneName} ajouté. DNS Hotspot ${hotspotDns.action === "created" ? "créé" : "mis à jour"} : ${hotspotDns.dnsName}.${cloudSuffix}`
        );
        setFormState(null);
      } catch (error) {
        setFormState({ ...formState, error: error instanceof Error ? error.message : "Le routeur n'a pas pu être enregistré." });
      } finally {
        setFormOperation(null);
      }
      return;
    }

    const currentRouter = formState.router;
    if (!currentRouter) return;
    try {
      requireProfilePermission(session, "global.routers.edit");
      const hotspotDns = await upsertFormHotspotDns(formState);
      const updated = applyTestResult(
        {
          ...currentRouter,
          apiPort: Number(formState.values.apiPort),
          apiSslPort: Number(formState.values.apiSslPort),
          boardName: formState.detectedInfo?.boardName ?? currentRouter.boardName,
          encryptedPassword,
          hotspotAddress: normalizeHotspotDnsName(formState.values.hotspotAddress),
          ipAddress: formState.values.ipAddress,
          model: formState.detectedInfo?.model || currentRouter.model,
          notes: formState.values.notes,
          preferredMode: formState.values.preferredMode,
          remoteHost: formState.values.remoteHost,
          remotePort: Number(formState.values.remotePort),
          remoteUseSsl: formState.values.remoteUseSsl,
          routerName: formState.detectedInfo?.identity || currentRouter.routerName || currentRouter.zoneName,
          routerOsVersion: formState.detectedInfo?.routerOsVersion ?? currentRouter.routerOsVersion,
          serialNumber: formState.detectedInfo?.serialNumber ?? currentRouter.serialNumber,
          username: formState.values.username,
          zoneName: formState.values.name
        },
        formState.testStatus,
        formState.testMessage,
        formState.detectedInfo
      );
      if (isPersistent) {
        await routerRepository.update(routerRecordFromCard(updated));
        await connectionRepository.replaceForRouter(updated.id, routerConnectionInputsFromCard(updated));
      }
      let cloudSuffix = "";
      if (isPersistent && recoveryService) {
        try {
          await recoveryService.backupRouter(updated.id);
        } catch {
          cloudSuffix = " Sauvegarde VPS en attente ; elle sera retentée automatiquement.";
        }
      }
      setRouters((current) => current.map((router) => (router.id === updated.id ? updated : router)));
      setMessage(
        `${updated.zoneName} modifié. DNS Hotspot ${hotspotDns.action === "created" ? "créé" : "mis à jour"} : ${hotspotDns.dnsName}.${cloudSuffix}`
      );
      setFormState(null);
    } catch (error) {
      setFormState({ ...formState, error: error instanceof Error ? error.message : "Le routeur n'a pas pu être mis à jour." });
    } finally {
      setFormOperation(null);
    }
  };

  const testFormConnection = async () => {
    if (!formState || formOperation) return;
    const validationError = validateRouterFormForTest(formState.values);
    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }
    setFormOperation("testing");
    setFormState({ ...formState, error: null, testMessage: "Test de connexion en cours…" });
    try {
      const result = await runRouterConnectionTest({
        apiPort: Number(formState.values.apiPort),
        encryptedPassword: formState.router?.encryptedPassword,
        ipAddress: formState.values.ipAddress,
        mode: formState.values.preferredMode,
        password: formState.values.password,
        remoteHost: formState.values.remoteHost,
        remotePort: formState.values.remotePort,
        remoteUseSsl: formState.values.remoteUseSsl,
        statusHint: formState.router?.status,
        username: formState.values.username
      });
      setFormState({
        ...formState,
        detectedInfo: result.systemInfo ?? null,
        error: null,
        testMessage: result.message,
        testStatus: result.status,
        values: formState.values
      });
    } catch {
      setFormState({
        ...formState,
        error: "Le test de connexion a échoué de manière inattendue. Réessayez.",
        testMessage: routerTestMessage("timeout"),
        testStatus: "timeout"
      });
    } finally {
      setFormOperation(null);
    }
  };

  const upsertFormHotspotDns = async (state: RouterFormState) => {
    let resolvedPassword = state.values.password;
    if (!resolvedPassword.trim() && state.router?.encryptedPassword) {
      resolvedPassword = await decryptLocalSecret(state.router.encryptedPassword);
    }
    if (!resolvedPassword.trim()) {
      throw new Error("Le mot de passe MikroTik est requis pour configurer le DNS Hotspot.");
    }

    const service = createFormRouterService(
      state.values,
      resolvedPassword,
      state.router?.status
    );
    await service.ensureVoucherLifecycleEngine();
    const hotspotDns = await service.upsertHotspotDns(
      normalizeHotspotDnsName(state.values.hotspotAddress)
    );
    return hotspotDns;
  };

  const createFormRouterService = (
    values: RouterFormValues,
    password: string,
    statusHint?: RouterCardData["status"]
  ) => {
    const targetHost = isRemoteConnectionMode(values.preferredMode)
      ? values.remoteHost
      : values.ipAddress;
    const logger = { write: (log: RouterActionLog) => setLogs((current) => [...current, log]) };

    return isPersistent
      ? new RouterService({
          authSession: session,
          logger,
          mikrotik: {
            connectionMode: values.preferredMode,
            host: targetHost,
            password,
            port: isRemoteConnectionMode(values.preferredMode)
              ? Number(values.remotePort)
              : Number(values.apiPort),
            timeoutMs: 5000,
            useSsl:
              values.preferredMode === "vpn"
                ? false
                : isRemoteConnectionMode(values.preferredMode)
                  ? values.remoteUseSsl
                  : false,
            username: values.username
          },
          mode: "mikrotik"
        })
      : new RouterService({
          adapter: new FakeRouterAdapter({
            connectionMode: values.preferredMode,
            errorMode: inferConnectionError({
              host: targetHost,
              mode: values.preferredMode,
              password,
              statusHint
            }),
            host: targetHost || values.ipAddress,
            latencyMs: 0
          }),
          authSession: session,
          logger
        });
  };

  const confirmDeleteRouter = async () => {
    const router = routerToDelete;
    if (!router || isDeleting) return;
    const cloudRouterId = router.cloudRouterId ?? router.id;
    let routerCleanupStarted = false;
    let routerCleanupConfirmed = false;
    setIsDeleting(true);
    setDeleteProgress("Préparation du déclassement sécurisé…");
    try {
      requireProfilePermission(session, "global.routers.delete");
      if (isPersistent) {
        if (!accountId) throw new Error("Compte actif introuvable.");
        const preparation = await prepareSaasRouterDecommission(cloudRouterId);
        let cleanupReport: Parameters<typeof completeSaasRouterDecommission>[1];
        if (preparation.requires_router_cleanup) {
          routerCleanupStarted = true;
          const record = await routerRepository.findById(router.id);
          if (!record || record.deleted_at) {
            throw new Error("La configuration locale du routeur est introuvable. Restaurez-la avant de reprendre la suppression.");
          }
          const connections = await connectionRepository.listByRouter(record.id);
          const routerService = await createPersistedRouterService({
            authSession: session,
            connections,
            database,
            router: record
          });
          const report = await routerService.decommissionTicketProVouchers((progress) => {
            if (progress.phase === "inventory") {
              setDeleteProgress("Recherche des vouchers TicketPro sur MikroTik…");
            } else if (progress.phase === "verifying") {
              setDeleteProgress("Vérification finale des accès RouterOS…");
            } else {
              setDeleteProgress(
                progress.total > 0
                  ? `Neutralisation des vouchers : ${progress.completed} / ${progress.total}`
                  : "Aucun voucher TicketPro actif à neutraliser."
              );
            }
          });
          if (
            report.failedCount > 0
            || report.remainingAuthorizationCount > 0
            || report.remainingManagedUserCount > 0
          ) {
            throw new Error(
              "Le routeur a conservé au moins un voucher ou une autorisation réseau. Il reste enregistré et continue d'occuper sa place. Réessayez lorsqu'il est joignable."
            );
          }
          routerCleanupConfirmed = true;
          cleanupReport = {
            cleanup_version: report.cleanupVersion,
            failed_count: report.failedCount,
            remaining_authorization_count: report.remainingAuthorizationCount,
            remaining_managed_user_count: report.remainingManagedUserCount,
            removed_count: report.removedCount,
            requested_count: report.requestedCount,
            verified_at: report.verifiedAt
          };
        }
        setDeleteProgress("Révocation de l'accès distant et libération de la place…");
        const removal = await completeSaasRouterDecommission(cloudRouterId, cleanupReport);
        await routerRepository.remove(accountId, router.id, {
          vpnRevocationConfirmed: removal.vpn_revocation_confirmed
        });
      }
      setRouters((current) => current.filter((item) => item.id !== router.id));
      setSelectedRouter((current) => (current?.id === router.id ? null : current));
      setFormState((current) => (current?.router?.id === router.id ? null : current));
      setRouterToDelete(null);
      setMessage(
        `${router.zoneName} déclassé : vouchers TicketPro neutralisés, accès VPN révoqué et place libérée.`
      );
    } catch (error) {
      if (isPersistent && routerCleanupStarted && !routerCleanupConfirmed) {
        await reportSaasRouterDecommissionFailure(cloudRouterId).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "Le routeur n'a pas pu être supprimé.");
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };

  const runRouterConnectionTest = async ({
    apiPort,
    encryptedPassword,
    ipAddress,
    mode,
    password,
    remoteHost,
    remotePort,
    remoteUseSsl,
    statusHint,
    username
  }: {
    apiPort: number;
    encryptedPassword?: string;
    ipAddress: string;
    mode: RouterFormValues["preferredMode"];
    password: string;
    remoteHost: string;
    remotePort: string;
    remoteUseSsl: boolean;
    statusHint?: RouterCardData["status"];
    username: string;
  }): Promise<{ message: string; readFailed: boolean; status: RouterConnectionTestStatus; systemInfo: RouterSystemInfo | null }> => {
    const targetHost = isRemoteConnectionMode(mode) ? remoteHost : ipAddress;
    let resolvedPassword = password;
    if (!resolvedPassword.trim() && encryptedPassword) {
      try {
        resolvedPassword = await decryptLocalSecret(encryptedPassword);
      } catch {
        return {
          message: "Le mot de passe enregistré ne peut pas être déchiffré. Saisissez-le à nouveau.",
          readFailed: false,
          status: "authentication_failed",
          systemInfo: null
        };
      }
    }

    const logger = { write: (log: RouterActionLog) => setLogs((current) => [...current, log]) };
    const service = isPersistent
      ? new RouterService({
          authSession: session,
          logger,
          mikrotik: {
            connectionMode: mode,
            host: targetHost,
            password: resolvedPassword,
            port: isRemoteConnectionMode(mode) ? Number(remotePort) : apiPort,
            timeoutMs: 5000,
            useSsl: mode === "vpn" ? false : isRemoteConnectionMode(mode) ? remoteUseSsl : false,
            username
          },
          mode: "mikrotik"
        })
      : new RouterService({
          adapter: new FakeRouterAdapter({
            connectionMode: mode,
            errorMode: inferConnectionError({ host: targetHost, mode, password: resolvedPassword, statusHint }),
            host: targetHost || ipAddress,
            latencyMs: 0
          }),
          authSession: session,
          logger
        });

    try {
      await service.testConnection();
    } catch (error) {
      const status = error instanceof RouterServiceError ? mapRouterErrorToTestStatus(error.code) : "timeout";
      return { message: routerTestMessage(status), readFailed: false, status, systemInfo: null };
    }
    // A reachable router whose information cannot be read stays reachable:
    // availability and data freshness are reported separately.
    try {
      const systemInfo = await service.getSystemInfo();
      return { message: routerTestMessage("connected"), readFailed: false, status: "connected", systemInfo };
    } catch {
      return {
        message: "Routeur joignable, mais ses informations n'ont pas pu être lues.",
        readFailed: true,
        status: "connected",
        systemInfo: null
      };
    }
  };

  useEffect(() => {
    if (!isPersistent || !routerHealthScopeKey || pauseRouterStatusRefresh) return undefined;
    let cancelled = false;
    let running = false;
    let timer: number | undefined;

    // One pass at a time (4 routers in parallel at most). Healthy routers are
    // re-checked every minute; offline or unconfirmed ones every 15 s, and
    // immediately when the network or the window comes back.
    const refreshRealStatuses = async () => {
      if (cancelled || running) return;
      window.clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        running = true;
        try {
          const snapshot = [...routersForHealthCheckRef.current];
          for (let index = 0; index < snapshot.length && !cancelled; index += 4) {
            await Promise.all(
              snapshot.slice(index, index + 4).map((router) => testConnection(router, { silent: true }))
            );
          }
        } finally {
          running = false;
        }
      }
      if (cancelled) return;
      setAvailabilityClock(Date.now());
      timer = window.setTimeout(
        () => void refreshRealStatuses(),
        nextRouterHealthCheckDelayMs(routersForHealthCheckRef.current.map((router) => router.id), availabilityRef.current)
      );
    };
    const refreshNow = () => void refreshRealStatuses();

    timer = window.setTimeout(refreshNow, 0);
    window.addEventListener("online", refreshNow);
    window.addEventListener("focus", refreshNow);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", refreshNow);
      window.removeEventListener("focus", refreshNow);
    };
  }, [isPersistent, pauseRouterStatusRefresh, routerHealthScopeKey]);

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          canAddRouter ? (
            <div className="button-row">
              <Button disabled={!canStartRouterCreation} icon={Plus} onClick={openAddForm} variant="primary">
                Ajouter un routeur
              </Button>
              {!subscriptionOverview.canAddRouter && canViewSubscription ? (
                <Button onClick={() => navigate("/abonnement")}>Changer de pack</Button>
              ) : null}
            </div>
          ) : null
        }
        description="Ajoutez un MikroTik, testez sa connexion et choisissez un accès local ou distant réellement enregistré."
        eyebrow="Global"
        title="Routeurs"
      />

      <Card>
        <div className="router-account-summary">
          <div>
            <strong>
              Routeurs : {subscriptionOverview.routersUsed} / {subscriptionOverview.subscription.routerLimitSnapshot} — {subscriptionOverview.plan.name}
            </strong>
            <span>Compte connecté : {accountSession?.email ?? "non renseigné"}</span>
          </div>
          <Badge status={!canAddRouter ? "active" : subscriptionOverview.canAddRouter ? "success" : "warning"}>
            {!canAddRouter
              ? "Accès aux routeurs autorisés"
              : subscriptionOverview.canAddRouter ? "Ajout disponible" : "Limite atteinte"}
          </Badge>
        </div>
        {quotaMessage ? (
          <p className="form-error subscription-warning">
            {quotaMessage} {canViewSubscription ? "Vous pouvez changer de pack depuis Abonnement." : "Contactez l'Admin pour changer de pack."}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="router-toolbar">
          <label className="router-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Recherche routeur"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par nom, IP ou modèle"
              value={query}
            />
          </label>
          <div className="filter-row">
            <FilterButton active={filter === "all"} icon={Filter} onClick={() => setFilter("all")}>Tous</FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Connectés</FilterButton>
            <FilterButton active={filter === "offline"} onClick={() => setFilter("offline")}>Hors ligne</FilterButton>
            <FilterButton active={filter === "warning"} onClick={() => setFilter("warning")}>À vérifier</FilterButton>
          </div>
        </div>
      </Card>

      {message ? <p className="form-error">{message}</p> : null}
      <div className="router-section-heading"><h2>Routeurs ({visibleRouters.length})</h2></div>

      {visibleRouters.length > 0 ? (
        <div className="router-grid">
          {visibleRouters.map((router) => (
            <RouterCard
              canDelete={canDeleteRouter}
              canEdit={canEditRouter}
              key={router.id}
              isConnecting={connectingRouterIds.has(router.id)}
              availability={isPersistent
                ? describeRouterAvailability(availability[router.id], router.lastSeenAt, availabilityClock)
                : null}
              onConfigureRemote={() => navigate(remoteVpnPathForRouter(router.id))}
              onDelete={() => setRouterToDelete(router)}
              onEdit={() => openEditForm(router)}
              onLocal={() => void activateRouterMode(router, "local")}
              onOpen={() => setSelectedRouter(router)}
              onRemote={() => void activateRouterMode(router, router.remoteMode)}
              onTest={() => void testConnection(router)}
              router={router}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            action={canAddRouter ? <Button disabled={!canStartRouterCreation} icon={Plus} onClick={openAddForm} variant="primary">Ajouter routeur</Button> : null}
            description="Aucun routeur ne correspond à votre recherche."
            icon={Router}
            title="Aucun routeur"
          />
        </Card>
      )}

      <ConnectionChoiceDialog
        onCancel={() => setSelectedRouter(null)}
        onLocal={() => void enterSelectedRouter("local")}
        onRemote={() => void enterSelectedRouter(selectedRouter?.remoteMode ?? "distant_ip")}
        router={selectedRouter}
      />
      <RouterFormDialog
        formState={formState}
        logsCount={logs.length}
        onCancel={() => {
          if (!formOperation) setFormState(null);
        }}
        onChange={updateFormValues}
        onSubmit={() => void submitForm()}
        onTest={() => void testFormConnection()}
        operation={formOperation}
      />
      <DeleteRouterDialog
        deleteProgress={deleteProgress}
        isDeleting={isDeleting}
        onCancel={() => setRouterToDelete(null)}
        onConfirm={() => void confirmDeleteRouter()}
        router={routerToDelete}
      />
    </div>
  );
}

function readUnknownError(error: unknown, fallback: string): string {
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

type RouterCardProps = {
  canDelete: boolean;
  canEdit: boolean;
  availability: RouterAvailabilityDisplay | null;
  isConnecting: boolean;
  onConfigureRemote: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onLocal: () => void;
  onOpen: () => void;
  onRemote: () => void;
  onTest: () => void;
  router: RouterCardData;
};

export function RouterCard({ availability, canDelete, canEdit, isConnecting, onConfigureRemote, onDelete, onEdit, onLocal, onOpen, onRemote, onTest, router }: RouterCardProps) {
  const routerName = router.routerName?.trim() || router.zoneName;
  const zoneName = router.zoneName.trim() || "Site non renseigné";
  const lastSeenLabel = formatRouterLastSeen(router.lastSeenAt);
  const menuItems = [
    { icon: Laptop, label: "Connexion locale", onSelect: onLocal },
    ...(router.remoteHost.trim()
      ? [{
          icon: Wifi,
          label: router.remoteMode === "vpn" ? "Connexion à distance (VPN)" : "Connexion à distance",
          onSelect: onRemote
        }]
      : canEdit
        ? [{ icon: Wifi, label: "Configurer l'accès distant", onSelect: onConfigureRemote }]
        : []),
    { icon: Search, label: "Tester la connexion", onSelect: onTest },
    ...(canEdit ? [{ icon: Edit3, label: "Modifier", onSelect: onEdit }] : []),
    ...(canDelete ? [{ icon: Trash2, label: "Supprimer", onSelect: onDelete }] : []),
    { icon: Eye, label: "Voir détails", onSelect: onOpen }
  ];

  return (
    <article
      className="router-card"
      onClick={onOpen}
    >
      <header className="router-card__header">
        <div aria-live="polite" className="router-card__status" title={availability?.title ?? statusLabels[router.status]}>
          {isConnecting || availability?.dot === "checking" ? (
            <span className="router-connection-indicator router-connection-indicator--connecting">
              <LoaderCircle aria-hidden="true" /> {availability?.label ?? "Connexion…"}
            </span>
          ) : availability ? (
            <StatusDot label={availability.label} status={availability.dot} />
          ) : router.status === "active" ? (
            <StatusDot label={statusLabels[router.status]} status="active" />
          ) : (
            <StatusDot
              label={statusLabels[router.status]}
              status={router.status === "offline" ? "offline" : "warning"}
            />
          )}
        </div>
        <div className="router-card__icon"><Router aria-hidden="true" /></div>
        <div className="router-card__identity">
          <span className="router-card__zone-pill" title={router.hotspotAddress || zoneName}>{zoneName}</span>
          <h3 title={routerName}>{routerName}</h3>
          <p title={`${router.model} · ${router.boardName}`}>{router.model} · {router.boardName}</p>
        </div>
        <ActionMenu items={menuItems} />
      </header>

      <dl className="router-card__details router-card__details--compact">
        <div><dt>Identifiant</dt><dd title={router.serialNumber}>{router.serialNumber || router.boardName}</dd></div>
        <div><dt>Adresse</dt><dd title={router.ipAddress}><MapPin aria-hidden="true" />{router.ipAddress}</dd></div>
        <div><dt>RouterOS</dt><dd>{router.routerOsVersion || "Non relevé"}</dd></div>
        <div><dt>Dernière activité</dt><dd title={router.lastSeenAt}>{lastSeenLabel}</dd></div>
        {availability ? (
          // Full-width line: the header only has room for the dot itself.
          <div className="router-card__availability" title={availability.title}>
            <dt>Connexion</dt>
            <dd className={`router-card__availability-value router-card__availability-value--${isConnecting ? "checking" : availability.dot}`}>
              {isConnecting ? "Connexion en cours" : availability.label}
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function formatRouterLastSeen(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "Jamais" || normalized === "Maintenant") return normalized || "Jamais";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export function ConnectionChoiceDialog({
  onCancel,
  onLocal,
  onRemote,
  router
}: {
  onCancel: () => void;
  onLocal: () => void;
  onRemote: () => void;
  router: RouterCardData | null;
}) {
  if (!router) return null;
  const remoteAvailable = Boolean(router.remoteHost.trim());
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="connection-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon"><Router aria-hidden="true" /></div>
          <div><h2>{router.zoneName}</h2><p>{router.ipAddress} · {router.model}</p></div>
        </header>
        <dl className="router-card__details">
          <div><dt>Carte</dt><dd>{router.boardName}</dd></div>
          <div><dt>Série</dt><dd>{router.serialNumber}</dd></div>
          <div><dt>RouterOS</dt><dd>{router.routerOsVersion}</dd></div>
          <div><dt>Dernier test</dt><dd>{router.lastTestMessage ?? "Non testé"}</dd></div>
        </dl>
        <div className="connection-options">
          <button className="connection-option" onClick={onLocal} type="button">
            <Laptop aria-hidden="true" /><span><strong>Connexion locale</strong><small>{router.ipAddress}:{router.apiPort}</small></span>
          </button>
          <button className="connection-option" disabled={!remoteAvailable} onClick={onRemote} type="button">
            <Wifi aria-hidden="true" />
            <span>
              <strong>{router.remoteMode === "vpn" ? "Connexion à distance (VPN WireGuard)" : "Connexion à distance"}</strong>
              <small>
                {remoteAvailable
                  ? `${router.remoteMode === "vpn" ? "Tunnel VPN · " : ""}${router.remoteHost}:${router.remotePort}`
                  : "Adresse distante non configurée"}
              </small>
            </span>
          </button>
        </div>
        <div className="confirm-dialog__actions"><Button icon={WifiOff} onClick={onCancel} variant="ghost">Fermer</Button></div>
      </section>
    </div>
  );
}

function RouterFormDialog({
  formState,
  logsCount,
  onCancel,
  onChange,
  onSubmit,
  onTest,
  operation
}: {
  formState: RouterFormState | null;
  logsCount: number;
  onCancel: () => void;
  onChange: (values: RouterFormValues) => void;
  onSubmit: () => void;
  onTest: () => void;
  operation: RouterFormOperation;
}) {
  if (!formState) return null;
  const values = formState.values;
  const isBusy = operation !== null;
  const remoteMode = isRemoteConnectionMode(values.preferredMode);
  const update = (partial: Partial<RouterFormValues>) => onChange({ ...values, ...partial });
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-busy={isBusy} aria-modal="true" className="router-form-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon"><Router aria-hidden="true" /></div>
          <div><h2>{formState.mode === "add" ? "Ajouter routeur" : "Modifier routeur"}</h2><p>Testez obligatoirement la configuration avant de l'enregistrer.</p></div>
        </header>
        <fieldset className="router-form-grid router-form-fieldset" disabled={isBusy}>
          <label className="form-field">Nom du routeur<input value={values.name} onChange={(event) => update({ name: event.target.value })} /></label>
          <label className="form-field">
            Hotspot (DNS)
            <input
              placeholder="wifi.exemple.com"
              value={values.hotspotAddress}
              onChange={(event) => update({ hotspotAddress: event.target.value })}
            />
            <small>Adresse saisie par les clients pour ouvrir le portail captif.</small>
          </label>
          <label className="form-field">Adresse IP locale<input value={values.ipAddress} onChange={(event) => update({ ipAddress: event.target.value })} /></label>
          <label className="form-field">Port API<input value={values.apiPort} onChange={(event) => update({ apiPort: event.target.value })} /></label>
          <label className="form-field">Port API SSL<input value={values.apiSslPort} onChange={(event) => update({ apiSslPort: event.target.value })} /></label>
          <label className="form-field">Utilisateur MikroTik<input value={values.username} onChange={(event) => update({ username: event.target.value })} /></label>
          <PasswordField
            autoComplete="new-password"
            label="Mot de passe MikroTik"
            onChange={(password) => update({ password })}
            placeholder={formState.mode === "edit" ? "Laisser vide pour conserver" : ""}
            value={values.password}
          />
          <label className="form-field">
            Mode préféré
            <select
              value={values.preferredMode}
              onChange={(event) => {
                const preferredMode = event.target.value as RouterFormValues["preferredMode"];
                update(preferredMode === "vpn"
                  ? { preferredMode, remotePort: "8728", remoteUseSsl: false }
                  : { preferredMode });
              }}
            >
              <option value="local">Connexion locale</option>
              <option value="distant_ip">Adresse distante</option>
              <option value="vpn">VPN WireGuard</option>
            </select>
          </label>
          {remoteMode ? (
            <>
              <label className="form-field">Adresse distante<input value={values.remoteHost} onChange={(event) => update({ remoteHost: event.target.value })} /></label>
              <label className="form-field">Port distant<input value={values.remotePort} onChange={(event) => update({ remotePort: event.target.value })} /></label>
              {values.preferredMode !== "vpn" ? (
                <label className="toggle-option">
                  <input
                    checked={values.remoteUseSsl}
                    onChange={(event) => update({ remotePort: event.target.checked ? "8729" : "8728", remoteUseSsl: event.target.checked })}
                    type="checkbox"
                  />
                  <Wifi aria-hidden="true" /><span>Utiliser API SSL</span>
                </label>
              ) : null}
            </>
          ) : null}
          <label className="form-field router-form-notes">Notes internes<textarea value={values.notes} onChange={(event) => update({ notes: event.target.value })} /></label>
        </fieldset>
        {formState.detectedInfo ? (
          <div className="router-form-result"><Badge status="success">Infos récupérées</Badge><span>{formState.detectedInfo.model} · {formState.detectedInfo.boardName} · RouterOS {formState.detectedInfo.routerOsVersion}</span></div>
        ) : null}
        <div className="router-form-result">
          <Badge status={formState.testStatus === "connected" ? "success" : "warning"}>{formState.testMessage ?? routerTestMessage(formState.testStatus)}</Badge>
          <span>Tests enregistrés : {logsCount}</span>
        </div>
        {formState.error ? <p className="form-error">{formState.error}</p> : null}
        <div className="confirm-dialog__actions">
          <Button disabled={isBusy} onClick={onCancel} variant="ghost">Annuler</Button>
          <Button
            className={operation === "testing" ? "button--loading" : ""}
            disabled={isBusy}
            icon={operation === "testing" ? LoaderCircle : Search}
            onClick={onTest}
          >
            {operation === "testing" ? "Test en cours…" : "Tester la connexion"}
          </Button>
          <Button
            className={operation === "saving" ? "button--loading" : ""}
            disabled={isBusy || formState.testStatus !== "connected"}
            icon={operation === "saving" ? LoaderCircle : Save}
            onClick={onSubmit}
            variant="primary"
          >
            {operation === "saving"
              ? formState.mode === "add" ? "Ajout en cours…" : "Modification en cours…"
              : formState.mode === "add" ? "Ajouter le routeur" : "Enregistrer les modifications"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function DeleteRouterDialog({
  deleteProgress,
  isDeleting,
  onCancel,
  onConfirm,
  router
}: {
  deleteProgress: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  router: RouterCardData | null;
}) {
  if (!router) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-busy={isDeleting} aria-modal="true" className="connection-dialog" role="alertdialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon"><Trash2 aria-hidden="true" /></div>
          <div>
            <h2>Supprimer {router.zoneName} ?</h2>
            <p>{router.routerName || router.model} · {router.ipAddress}</p>
          </div>
        </header>
        <div className="form-error">
          <AlertTriangle aria-hidden="true" />
          <span>
            TicketPro supprimera du MikroTik tous les vouchers qu'il gère et coupera leurs autorisations réseau.
            Le routeur ne libérera sa place dans l'abonnement qu'après vérification, puis son accès VPN sera révoqué.
            Les historiques restent archivés. Les utilisateurs Hotspot créés manuellement ne sont pas touchés.
          </span>
        </div>
        {isDeleting && deleteProgress ? (
          <p aria-live="polite" className="connection-dialog__progress">{deleteProgress}</p>
        ) : null}
        <div className="confirm-dialog__actions">
          <Button disabled={isDeleting} onClick={onCancel} variant="ghost">Annuler</Button>
          <Button
            className={isDeleting ? "button--loading" : ""}
            disabled={isDeleting}
            icon={isDeleting ? LoaderCircle : Trash2}
            onClick={onConfirm}
            variant="danger"
          >
            {isDeleting ? "Suppression en cours…" : "Confirmer la suppression"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function connectionFingerprint(values: RouterFormValues): string {
  return JSON.stringify({
    apiPort: values.apiPort,
    apiSslPort: values.apiSslPort,
    ipAddress: values.ipAddress.trim(),
    password: values.password,
    preferredMode: values.preferredMode,
    remoteHost: values.remoteHost.trim(),
    remotePort: values.remotePort,
    remoteUseSsl: values.remoteUseSsl,
    username: values.username.trim()
  });
}

function inferConnectionError({
  host,
  mode,
  password,
  statusHint
}: {
  host: string;
  mode: RouterFormValues["preferredMode"];
  password: string;
  statusHint?: RouterCardData["status"];
}): RouterErrorCode | null {
  const normalizedHost = host.trim();
  if (mode === "agent_future") return "remote_unavailable";
  if (isRemoteConnectionMode(mode) && !normalizedHost) return "remote_not_configured";
  if (password.trim().toLowerCase() === "incorrect") return "authentication_failed";
  if (normalizedHost.endsWith(".254")) return "timeout";
  if (normalizedHost.startsWith("10.10.") || statusHint === "warning") return "api_disabled";
  if (statusHint === "offline") return "router_offline";
  return null;
}

function applyTestResult(
  router: RouterCardData,
  status: RouterConnectionTestStatus,
  message: string | null,
  systemInfo: RouterSystemInfo | null = null
): RouterCardData {
  return {
    ...router,
    boardName: systemInfo?.boardName ?? router.boardName,
    lastSeenAt: status === "connected" ? "Maintenant" : router.lastSeenAt,
    lastTestMessage: message,
    lastTestStatus: status,
    lastTestedAt: "Maintenant",
    model: systemInfo?.model ?? router.model,
    remoteEnabled: status === "connected" || router.remoteEnabled,
    routerName: systemInfo?.identity || router.routerName || router.zoneName,
    routerOsVersion: systemInfo?.routerOsVersion ?? router.routerOsVersion,
    serialNumber: systemInfo?.serialNumber ?? router.serialNumber,
    status: routerCardStatusFromTestStatus(status)
  };
}

function routerCardStatusFromTestStatus(status: RouterConnectionTestStatus): RouterCardData["status"] {
  if (status === "connected") return "active";
  if (status === "offline" || status === "timeout" || status === "remote_unavailable") return "offline";
  return "warning";
}

function validateRouterForm(formState: RouterFormState): string | null {
  const testError = validateRouterFormForTest(formState.values);
  if (testError) return testError;
  if (formState.mode === "add" && !formState.values.password.trim()) return "Entrez le mot de passe du routeur.";
  if (formState.testStatus !== "connected") return "Testez et validez cette configuration RouterOS avant de l'enregistrer.";
  return null;
}

function validateRouterFormForTest(values: RouterFormValues): string | null {
  if (!values.name.trim()) return "Entrez le nom du routeur.";
  if (!values.hotspotAddress.trim()) return "Entrez le DNS du Hotspot.";
  if (!isValidHotspotDnsName(values.hotspotAddress)) {
    return "Entrez un DNS Hotspot valide, par exemple wifi.exemple.com.";
  }
  if (!values.ipAddress.trim()) return "Entrez l’adresse IP locale.";
  if (!values.username.trim()) return "Entrez l’utilisateur MikroTik.";
  if (!isValidPort(values.apiPort) || !isValidPort(values.apiSslPort)) return "Entrez des ports API valides.";
  if (isRemoteConnectionMode(values.preferredMode)) {
    if (!values.remoteHost.trim()) return "Entrez l'adresse distante.";
    if (!isValidPort(values.remotePort)) return "Entrez un port distant valide.";
  }
  return null;
}

function isValidPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

