import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Ban,
  Clock,
  Copy,
  Download,
  Eye,
  Laptop,
  RefreshCw,
  RotateCcw,
  Router,
  Search,
  ShieldCheck,
  Smartphone,
  Ticket,
  Upload,
  UserRound,
  WifiOff
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  RouterAccessPolicySyncService,
  routerAccessPolicyCloudId,
  VoucherDeviceBindingService
} from "../../services/access";
import {
  FakeRouterAdapter,
  RouterService,
  RouterServiceError,
  createPersistedRouterService,
  type RouterActionLog
} from "../../services/router";
import { useAppDatabase } from "../../services/database";
import {
  ActiveSessionCacheRepository,
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketRepository
} from "../../services/database/repositories";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FilterButton,
  PageHeader,
  StatCard,
  StatusDot
} from "../../shared/ui";
import {
  buildConnectedClientViewModels,
  buildCachedConnectedClientViewModels,
  describeClientDataQuota,
  emptyConnectedClientFilters,
  findVouchersMissingQuota,
  filterConnectedClients,
  formatClientBytes,
  getConnectedClientPlanOptions,
  type ConnectedClientFilters,
  type ConnectedClientPlanOption,
  type ConnectedClientViewModel,
  type VoucherQuotaRepairCandidate
} from "./connectedClientsPageModel";

type PendingAction = {
  client: ConnectedClientViewModel;
  type: "disconnect" | "disable" | "release";
} | null;

type Notice = {
  status: "error" | "success";
  text: string;
} | null;

const connectedClientsLiveIntervalMs = 5_000;

export function ConnectedClientsPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canDisconnect = session?.permissions.includes("router.clients.disconnect") ?? false;
  const canDisable =
    canDisconnect && (session?.permissions.includes("router.tickets.disable") ?? false);
  const canManageDeviceBinding =
    session?.permissions.includes("router.tickets.sync") ?? false;
  const [clients, setClients] = useState<ConnectedClientViewModel[]>([]);
  const [filters, setFilters] = useState<ConnectedClientFilters>(emptyConnectedClientFilters);
  const [, setLogs] = useState<RouterActionLog[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busyUsername, setBusyUsername] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"cache" | "live" | "none">("none");
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [selectedClient, setSelectedClient] = useState<ConnectedClientViewModel | null>(null);
  const [availablePlans, setAvailablePlans] = useState<ConnectedClientPlanOption[]>([]);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [quotaRepair, setQuotaRepair] = useState<VoucherQuotaRepairCandidate[] | null>(null);
  const [isRepairingQuota, setIsRepairingQuota] = useState(false);
  const refreshRunningRef = useRef(false);
  const clientsRef = useRef<ConnectedClientViewModel[]>([]);
  const liveRouterServiceRef = useRef<{ key: string; service: RouterService } | null>(null);

  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const activeSessionCacheRepository = useMemo(() => new ActiveSessionCacheRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const accessPolicyService = useMemo(
    () => new RouterAccessPolicySyncService(database),
    [database]
  );
  const bindingService = useMemo(
    () => new VoucherDeviceBindingService(ticketRepository),
    [ticketRepository]
  );
  const applyClients = (nextClients: ConnectedClientViewModel[]) => {
    clientsRef.current = nextClients;
    setClients(nextClients);
    setSelectedClient((current) =>
      current
        ? nextClients.find((client) => client.username === current.username) ?? null
        : null
    );
  };

  const createService = async (logActions = true) => {
    if (!isPersistent) {
      return new RouterService({
        adapter: new FakeRouterAdapter({ latencyMs: 0 }),
        logger: { write: (log) => setLogs((current) => [...current, log]) }
      });
    }

    if (!isInitialized || !session) {
      throw new Error("La base locale n'est pas encore prête.");
    }

    const serviceKey = `${session.account_id}:${routerId}`;
    if (!logActions && liveRouterServiceRef.current?.key === serviceKey) {
      return liveRouterServiceRef.current.service;
    }

    const router = await routerRepository.findById(routerId);
    if (!router || router.account_id !== session.account_id) {
      throw new Error("Routeur introuvable dans la base locale.");
    }

    const service = await createPersistedRouterService({
      authSession: session,
      connections: await connectionRepository.listByRouter(routerId),
      database,
      logActions,
      router
    });
    if (!logActions) liveRouterServiceRef.current = { key: serviceKey, service };
    return service;
  };

  const loadClients = async (options: { silent?: boolean; synchronizePolicy?: boolean } = {}) => {
    if (isPersistent && (!isInitialized || !session)) {
      return;
    }
    if (refreshRunningRef.current) return;

    refreshRunningRef.current = true;
    if (options.silent) setIsLiveRefreshing(true);
    else setIsLoading(true);
    if (!options.silent) setNotice(null);

    try {
      const service = await createService(!options.silent);
      const [activeUsers, hotspotUsers, plans, routers] = await Promise.all([
        service.listActiveUsers(),
        service.listHotspotUsers(),
        service.getHotspotPlans(),
        isPersistent ? Promise.resolve([]) : service.listRouters()
      ]);
      const persistedRouter = isPersistent ? await routerRepository.findById(routerId) : null;
      const router = persistedRouter ?? routers.find((item) => item.id === routerId) ?? routers[0] ?? { id: routerId, name: "Routeur" };

      if (isPersistent) {
        await activeSessionCacheRepository.replaceForRouter(routerId, activeUsers);
        if (session && (options.synchronizePolicy ?? !options.silent)) {
          const connections = persistedRouter
            ? await connectionRepository.listByRouter(routerId)
            : [];
          const [policy, ticketRecords] = await Promise.all([
            accessPolicyService.load(
              session.account_id,
              routerId,
              persistedRouter
                ? routerAccessPolicyCloudId(persistedRouter, connections)
                : routerId
            ),
            ticketRepository.listByRouter(routerId)
          ]);
          if (
            policy.policy.lockVoucherToFirstMac
            && canManageDeviceBinding
          ) {
            const bindingResult = await bindingService.synchronize({
              accountId: session.account_id,
              activeUsers,
              hotspotUsers,
              routerId,
              routerService: service,
              tickets: ticketRecords
            });
            if (bindingResult.errors.length > 0) {
              setNotice({
                status: "error",
                text: `${bindingResult.errors.length} voucher(s) n'ont pas pu être verrouillés. Consultez les logs puis réessayez.`
              });
            } else if (bindingResult.conflicts.length > 0) {
              setNotice({
                status: "error",
                text: `${bindingResult.conflicts.length} partage ou changement d’appareil suspect détecté.`
              });
            } else if (bindingResult.boundUsernames.length > 0) {
              setNotice({
                status: "success",
                text: `${bindingResult.boundUsernames.length} voucher(s) verrouillé(s) sur leur premier appareil.`
              });
            }
          }
        }
      }
      const liveClients = buildConnectedClientViewModels(activeUsers, hotspotUsers, plans, router);
      setAvailablePlans(plans.map((plan) => ({ id: plan.id, name: plan.name })));
      applyClients(liveClients);
      setDataSource("live");
      setLastRefreshAt(formatRefreshDate(new Date()));
      setLiveError(null);
    } catch (error) {
      const errorMessage = error instanceof RouterServiceError
        ? error.message
        : "Impossible de charger les clients connectés.";
      setLiveError(errorMessage);
      if (isPersistent) {
        const [router, cachedUsers, ticketRecords, planRecords] = await Promise.all([
          routerRepository.findById(routerId),
          activeSessionCacheRepository.listByRouter(routerId),
          ticketRepository.listByRouter(routerId),
          planRepository.listByRouter(routerId)
        ]);

        if (router && router.account_id === session?.account_id && cachedUsers.length > 0) {
          setAvailablePlans(planRecords.map((plan) => ({ id: plan.id, name: plan.name })));
          applyClients(
            buildCachedConnectedClientViewModels(
              cachedUsers,
              ticketRecords,
              planRecords,
              router
            )
          );
          setDataSource("cache");
          setLastRefreshAt(formatRefreshDate(new Date(cachedUsers[0].cached_at)));
          if (!options.silent) {
            setNotice({ status: "error", text: "Routeur hors ligne : affichage du dernier cache local." });
          }
          return;
        }
      }
      if (clientsRef.current.length === 0) {
        applyClients([]);
        setDataSource("none");
        setLastRefreshAt(null);
      } else {
        setDataSource("cache");
      }
      if (!options.silent) setNotice({ status: "error", text: errorMessage });
    } finally {
      refreshRunningRef.current = false;
      if (options.silent) setIsLiveRefreshing(false);
      else setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadClients();
    const synchronize = () => {
      if (document.visibilityState === "hidden") return;
      void loadClients({ silent: true, synchronizePolicy: false });
    };
    const interval = window.setInterval(synchronize, connectedClientsLiveIntervalMs);
    window.addEventListener("focus", synchronize);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", synchronize);
    };
    // Repository and organization changes intentionally restart this live loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessPolicyService, activeSessionCacheRepository, bindingService, canManageDeviceBinding, connectionRepository, database, isInitialized, isPersistent, planRepository, routerId, routerRepository, session, ticketRepository]);

  const filteredClients = useMemo(() => filterConnectedClients(clients, filters), [clients, filters]);
  const planOptions = useMemo(
    () => getConnectedClientPlanOptions(clients, availablePlans),
    [availablePlans, clients]
  );
  const totalDownload = filteredClients.reduce((total, client) => total + client.downloadedBytes, 0);
  const totalUpload = filteredClients.reduce((total, client) => total + client.uploadedBytes, 0);
  const hasActiveFilters =
    filters.code !== "" ||
    filters.duration !== "" ||
    filters.ipAddress !== "" ||
    filters.macAddress !== "" ||
    filters.planId !== "";

  const updateFilters = (partial: Partial<ConnectedClientFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
  };

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ status: "success", text: `${label} copié.` });
    } catch {
      setNotice({ status: "error", text: "Copie indisponible sur ce poste." });
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) {
      return;
    }

    const { client, type } = pendingAction;
    let ticketDisabled = false;
    let localStatusWarning = false;
    setPendingAction(null);
    setNotice(null);
    setBusyUsername(client.username);

    try {
      const service = await createService();
      if (type === "release") {
        if (!session) throw new Error("Session administrateur introuvable.");
        const ticket = (await ticketRepository.listByRouter(routerId)).find(
          (item) => item.username === client.username
        );
        if (!ticket) throw new Error("Voucher local introuvable.");
        await bindingService.clear({
          accountId: session.account_id,
          routerId,
          routerService: service,
          ticket
        });
        try {
          await service.disconnectActiveUser(client.username);
        } catch (error) {
          if (!(error instanceof RouterServiceError && error.code === "hotspot_not_found")) {
            throw error;
          }
        }
        if (isPersistent) {
          await activeSessionCacheRepository.removeByUsername(routerId, client.username);
        }
        setClients((current) => current.filter((item) => item.username !== client.username));
        setSelectedClient(null);
        setNotice({
          status: "success",
          text: "Appareil libéré. Le prochain appareil qui utilise ce voucher deviendra l’appareil autorisé."
        });
        return;
      }
      if (type === "disable") {
        await service.disableHotspotUser(client.username);
        ticketDisabled = true;
        if (isPersistent && session) {
          try {
            await ticketRepository.recordRouterStatusByUsername({
              accountId: session.account_id,
              routerId,
              status: "désactivé",
              username: client.username
            });
          } catch {
            localStatusWarning = true;
          }
        }
      }

      try {
        await service.disconnectActiveUser(client.username);
      } catch (error) {
        if (!(error instanceof RouterServiceError && error.code === "hotspot_not_found")) {
          throw error;
        }
      }
      if (isPersistent) {
        await activeSessionCacheRepository.removeByUsername(routerId, client.username);
      }
      setClients((current) => current.filter((item) => item.username !== client.username));
      setSelectedClient((current) => (current?.username === client.username ? null : current));
      setNotice({
        status: localStatusWarning ? "error" : "success",
        text:
          type === "disable"
            ? localStatusWarning
              ? "Ticket désactivé et client déconnecté, mais l'état local devra être resynchronisé."
              : "Ticket désactivé et client déconnecté."
            : "Client déconnecté."
      });
    } catch (error) {
      setNotice({
        status: "error",
        text: ticketDisabled
          ? "Le ticket a été désactivé, mais la déconnexion du client a échoué. Rafraîchissez pour vérifier son état."
          : error instanceof RouterServiceError
            ? error.message
            : "Action impossible pour le moment."
      });
    } finally {
      setBusyUsername(null);
    }
  };

  // Reads every RouterOS voucher and lists those whose plan has a quota that
  // RouterOS does not carry. Nothing is written before confirmation.
  const inspectVoucherQuotas = async () => {
    if (!isPersistent || !session) return;
    setIsRepairingQuota(true);
    setNotice(null);
    try {
      const service = await createService();
      const [routerUsers, activeUsers, planRecords] = await Promise.all([
        service.listHotspotUsersForVerification(),
        service.listActiveUsers(),
        planRepository.listByRouter(routerId)
      ]);
      const candidates = findVouchersMissingQuota(
        routerUsers,
        planRecords,
        new Set(activeUsers.map((user) => user.username))
      );
      if (candidates.length === 0) {
        setNotice({ status: "success", text: "Tous les vouchers des plans avec quota portent leur quota sur RouterOS." });
      } else {
        setQuotaRepair(candidates);
      }
    } catch (error) {
      setNotice({
        status: "error",
        text: error instanceof RouterServiceError ? error.message : "Lecture des quotas RouterOS impossible."
      });
    } finally {
      setIsRepairingQuota(false);
    }
  };

  const applyVoucherQuotas = async () => {
    const candidates = quotaRepair ?? [];
    setQuotaRepair(null);
    if (!session || candidates.length === 0) return;
    setIsRepairingQuota(true);
    let applied = 0;
    const failed: string[] = [];
    try {
      const service = await createService();
      const ticketsByUsername = new Map(
        (await ticketRepository.listByRouter(routerId)).map((ticket) => [ticket.username, ticket])
      );
      for (const candidate of candidates) {
        try {
          await service.setHotspotUserQuota(candidate.username, candidate.limitBytesTotal);
          applied += 1;
          const ticket = ticketsByUsername.get(candidate.username);
          if (ticket) {
            await ticketRepository.update({
              ...ticket,
              data_limit_mb_snapshot: candidate.limitBytesTotal / 1024 / 1024,
              data_remaining_bytes: Math.max(0, candidate.limitBytesTotal - candidate.usedBytes)
            });
          }
        } catch {
          failed.push(candidate.username);
        }
      }
      setNotice(failed.length > 0
        ? {
            status: "error",
            text: `${applied} quota(s) appliqué(s) et confirmé(s) par RouterOS ; échec pour ${failed.length} : ${failed.slice(0, 10).join(", ")}${failed.length > 10 ? "…" : ""}.`
          }
        : { status: "success", text: `${applied} quota(s) appliqué(s) et confirmé(s) par RouterOS.` });
      await loadClients({ synchronizePolicy: false });
    } catch (error) {
      setNotice({
        status: "error",
        text: error instanceof RouterServiceError ? error.message : "Application des quotas impossible."
      });
    } finally {
      setIsRepairingQuota(false);
    }
  };

  const quotaRepairConnected = quotaRepair?.filter((candidate) => candidate.isConnected).length ?? 0;
  const quotaRepairExceeded = quotaRepair?.filter((candidate) => candidate.exceedsQuota).length ?? 0;

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            {isPersistent && canManageDeviceBinding ? (
              <Button
                className={isRepairingQuota ? "button--loading" : ""}
                disabled={isRepairingQuota || isLoading}
                icon={ShieldCheck}
                onClick={() => void inspectVoucherQuotas()}
                variant="ghost"
              >
                Vérifier les quotas
              </Button>
            ) : null}
            <Button
              className={isLoading || isLiveRefreshing ? "button--loading" : ""}
              disabled={isLoading || isLiveRefreshing}
              icon={RefreshCw}
              onClick={() => void loadClients({ synchronizePolicy: true })}
              variant="primary"
            >
              Synchroniser maintenant
            </Button>
          </div>
        }
        description="Suivez les utilisateurs actuellement connectés au réseau."
        eyebrow="Routeur"
        title="Clients connectés"
      />

      <Card className={`report-live-card report-live-card--${dataSource === "live" ? "live" : dataSource === "cache" ? "degraded" : "connecting"}`}>
        <div className="report-live-status">
          <span className="report-live-status__icon"><Router aria-hidden="true" /></span>
          <div className="report-live-status__copy">
            <div className="button-row">
              <strong>Sessions RouterOS en direct</strong>
              <Badge status={dataSource === "live" ? "success" : dataSource === "cache" ? "warning" : "active"}>
                {isLoading || isLiveRefreshing ? "Synchronisation…" : dataSource === "live" ? "En direct" : dataSource === "cache" ? "Mode dégradé" : "Connexion…"}
              </Badge>
            </div>
            <span>
              {dataSource === "live"
                ? `Durée, consommation, appareils et sessions relus à ${lastRefreshAt ?? "l'instant"}.`
                : dataSource === "cache"
                  ? `Dernières données fiables conservées. ${liveError ?? "Le routeur est momentanément inaccessible."}`
                  : "Connexion au MikroTik et lecture des sessions actives…"}
            </span>
          </div>
          <div className="report-live-status__facts">
            <span>Actualisation</span>
            <strong>5 secondes</strong>
            <small>Uniquement lorsque cette page est visible</small>
          </div>
        </div>
      </Card>

      <div className="stats-grid">
        <StatCard icon={UserRound} label="Connectés" value={String(filteredClients.length)} hint="Clients visibles" />
        <StatCard icon={Download} label="Download" value={formatClientBytes(totalDownload)} hint="Volume reçu" />
        <StatCard icon={Upload} label="Upload" value={formatClientBytes(totalUpload)} hint="Volume envoyé" />
        <StatCard
          icon={RefreshCw}
          label="Dernière mise à jour"
          value={lastRefreshAt ?? "En attente"}
          hint={
            dataSource === "cache"
              ? "Cache local hors ligne"
              : dataSource === "live"
                ? "Lecture RouterOS"
                : "Aucune donnée reçue"
          }
        />
      </div>

      <Card>
        <div className="clients-toolbar">
          <label className="form-field">
            Recherche code
            <div className="input-with-icon">
              <Search aria-hidden="true" />
              <input
                placeholder="Code ticket"
                value={filters.code}
                onChange={(event) => updateFilters({ code: event.target.value })}
              />
            </div>
          </label>
          <label className="form-field">
            Recherche MAC
            <input
              placeholder="AA:BB:CC"
              value={filters.macAddress}
              onChange={(event) => updateFilters({ macAddress: event.target.value })}
            />
          </label>
          <label className="form-field">
            Recherche IP
            <input
              placeholder="192.168"
              value={filters.ipAddress}
              onChange={(event) => updateFilters({ ipAddress: event.target.value })}
            />
          </label>
          <label className="form-field">
            Plan
            <select value={filters.planId} onChange={(event) => updateFilters({ planId: event.target.value })}>
              <option value="">Tous les plans</option>
              {planOptions.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter-row clients-duration-filter">
          <FilterButton active={filters.duration === ""} onClick={() => updateFilters({ duration: "" })}>
            Toutes durées
          </FilterButton>
          <FilterButton active={filters.duration === "short"} onClick={() => updateFilters({ duration: "short" })}>
            Moins de 15 min
          </FilterButton>
          <FilterButton active={filters.duration === "medium"} onClick={() => updateFilters({ duration: "medium" })}>
            15 à 60 min
          </FilterButton>
          <FilterButton active={filters.duration === "long"} onClick={() => updateFilters({ duration: "long" })}>
            Plus de 1h
          </FilterButton>
          <span className="muted-inline">Articles ({filteredClients.length})</span>
          {hasActiveFilters ? (
            <Button
              icon={RotateCcw}
              onClick={() => setFilters(emptyConnectedClientFilters)}
              variant="ghost"
            >
              Réinitialiser
            </Button>
          ) : null}
          {lastRefreshAt ? (
            <StatusDot
              label={
                dataSource === "cache"
                  ? `Cache du ${lastRefreshAt}`
                  : `RouterOS actualisé ${lastRefreshAt}`
              }
              status={dataSource === "cache" ? "warning" : "active"}
            />
          ) : null}
        </div>
      </Card>

      {notice ? (
        <p className={`form-error ${notice.status === "success" ? "form-error--success" : ""}`}>{notice.text}</p>
      ) : null}

      <Card className="clients-list-card">
        {filteredClients.length > 0 ? (
          <div className="clients-list">
            {filteredClients.map((client) => (
              <ConnectedClientRow
                canDisable={canDisable}
                canDisconnect={canDisconnect}
                canReleaseDevice={canManageDeviceBinding}
                client={client}
                isBusy={busyUsername === client.username}
                isCached={dataSource === "cache"}
                key={client.id}
                onCopyIp={() => void copyValue("IP", client.ipAddress)}
                onCopyMac={() => void copyValue("MAC", client.macAddress)}
                onDetail={() => setSelectedClient(client)}
                onDisable={() => setPendingAction({ client, type: "disable" })}
                onDisconnect={() => setPendingAction({ client, type: "disconnect" })}
                onReleaseDevice={() => setPendingAction({ client, type: "release" })}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Button disabled={isLoading} icon={RefreshCw} onClick={() => void loadClients()} variant="primary">
                Rafraîchir
              </Button>
            }
            description="Aucun client connecté ne correspond aux filtres."
            icon={Laptop}
            title="Aucun client actif"
          />
        )}
      </Card>

      <ConfirmDialog
        confirmLabel={
          pendingAction?.type === "disable"
            ? "Désactiver"
            : pendingAction?.type === "release"
              ? "Libérer"
              : "Déconnecter"
        }
        description={
          pendingAction?.type === "disable"
            ? `Le ticket ${pendingAction.client.username} sera désactivé puis déconnecté.`
            : pendingAction?.type === "release"
              ? `Le verrou MAC du voucher ${pendingAction.client.username} sera supprimé et la session actuelle déconnectée.`
            : `Le client ${pendingAction?.client.username ?? ""} sera déconnecté.`
        }
        isOpen={Boolean(pendingAction)}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
        title={
          pendingAction?.type === "disable"
            ? "Désactiver le ticket ?"
            : pendingAction?.type === "release"
              ? "Libérer l’appareil associé ?"
              : "Déconnecter ce client ?"
        }
      />

      <ConfirmDialog
        confirmLabel="Appliquer les quotas"
        description={quotaRepair
          ? `${quotaRepair.length} voucher(s) n'ont pas sur RouterOS le quota prévu par leur plan`
            + ` (dont ${quotaRepairConnected} connecté(s)). Le quota du plan sera écrit sur chaque voucher puis relu.`
            + " La consommation déjà enregistrée est conservée : elle n'est ni remise à zéro ni recréditée."
            + (quotaRepairExceeded > 0
              ? ` ${quotaRepairExceeded} voucher(s) ont déjà dépassé ce quota : RouterOS les coupera immédiatement.`
              : "")
          : ""}
        isOpen={Boolean(quotaRepair)}
        onCancel={() => setQuotaRepair(null)}
        onConfirm={() => void applyVoucherQuotas()}
        title="Appliquer le quota des plans ?"
      />

      <ClientDetailDialog
        client={selectedClient}
        isCached={dataSource === "cache"}
        onClose={() => setSelectedClient(null)}
      />
    </div>
  );
}

type ConnectedClientRowProps = {
  canDisable: boolean;
  canDisconnect: boolean;
  canReleaseDevice: boolean;
  client: ConnectedClientViewModel;
  isBusy: boolean;
  isCached: boolean;
  onCopyIp: () => void;
  onCopyMac: () => void;
  onDetail: () => void;
  onDisable: () => void;
  onDisconnect: () => void;
  onReleaseDevice: () => void;
};

function ConnectedClientRow({
  canDisable,
  canDisconnect,
  canReleaseDevice,
  client,
  isBusy,
  isCached,
  onCopyIp,
  onCopyMac,
  onDetail,
  onDisable,
  onDisconnect,
  onReleaseDevice
}: ConnectedClientRowProps) {
  return (
    <article
      className="client-row client-row--compact"
      onClick={onDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDetail();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="client-row__identity">
        <div className="client-row__icon">
          <Ticket aria-hidden="true" />
        </div>
        <div>
          <div className="client-row__title">
            <strong>{client.username}</strong>
            <Badge status={isCached ? "warning" : "active"}>
              {isCached ? "Cache" : "Actif"}
            </Badge>
          </div>
          <p>{client.planName} · {client.routerName}</p>
        </div>
      </div>

      <div className="client-row__network">
        <span><Smartphone aria-hidden="true" /> {client.ipAddress}</span>
        <span><Laptop aria-hidden="true" /> {client.macAddress}</span>
      </div>

      <div className="client-row__usage">
        <span><Clock aria-hidden="true" /> Session {client.currentSessionUptime}</span>
        <span>Utilisé {client.uptime}</span>
        <span>Reste {client.sessionTimeLeft}</span>
        <strong>{formatClientBytes(client.totalBytes)}</strong>
        {client.consumptionPercent !== null ? (
          <small>{client.consumptionPercent}% consommé</small>
        ) : null}
      </div>

      <ActionMenu
        disabled={isBusy}
        items={[
          { icon: Eye, label: "Voir détail ticket", onSelect: onDetail },
          { icon: Copy, label: "Copier MAC", onSelect: onCopyMac },
          { icon: Copy, label: "Copier IP", onSelect: onCopyIp },
          ...(canDisconnect
            ? [{ icon: WifiOff, label: "Déconnecter", onSelect: onDisconnect }]
            : []),
          ...(canDisable
            ? [{ icon: Ban, label: "Désactiver ticket", onSelect: onDisable }]
            : []),
          ...(canReleaseDevice
            ? [{ icon: ShieldCheck, label: "Libérer l’appareil associé", onSelect: onReleaseDevice }]
            : [])
        ]}
      />
    </article>
  );
}

function ClientDetailDialog({
  client,
  isCached,
  onClose
}: {
  client: ConnectedClientViewModel | null;
  isCached: boolean;
  onClose: () => void;
}) {
  if (!client) {
    return null;
  }
  const dataQuota = describeClientDataQuota(client);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="client-detail-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <Ticket aria-hidden="true" />
          </div>
          <div>
            <h2>{client.username}</h2>
            <p>{client.planName} · {client.routerName}</p>
          </div>
          <Badge status={isCached ? "warning" : "active"}>
            {isCached ? "Dernier cache" : "Actif"}
          </Badge>
        </header>

        <dl className="client-detail-grid">
          <DetailLine icon={ShieldCheck} label="Ticket" value={client.username} />
          <DetailLine icon={Ticket} label="Profil RouterOS" value={client.profileName ?? "Non identifié"} />
          <DetailLine icon={Ticket} label="Plan" value={client.planName} />
          <DetailLine icon={Router} label="Routeur" value={client.routerName} />
          <DetailLine icon={Smartphone} label="Adresse IP" value={client.ipAddress} />
          <DetailLine icon={Laptop} label="Adresse MAC" value={client.macAddress} />
          <DetailLine icon={Clock} label="Session actuelle" value={client.currentSessionUptime} />
          <DetailLine icon={Clock} label="Temps total utilisé" value={client.uptime} />
          <DetailLine icon={Clock} label="Temps d'utilisation restant" value={client.sessionTimeLeft} />
          <DetailLine icon={Download} label="Download" value={formatClientBytes(client.downloadedBytes)} />
          <DetailLine icon={Upload} label="Upload" value={formatClientBytes(client.uploadedBytes)} />
          <DetailLine icon={Laptop} label="Volume total" value={formatClientBytes(client.totalBytes)} />
          <DetailLine icon={Download} label="Volume restant" value={dataQuota.remaining} />
          <DetailLine icon={Laptop} label="Quota total du voucher" value={dataQuota.total} />
          <DetailLine icon={Download} label="Débit descendant du profil" value={client.downloadLimit ?? "Non défini"} />
          <DetailLine icon={Upload} label="Débit montant du profil" value={client.uploadLimit ?? "Non défini"} />
          <DetailLine icon={Smartphone} label="Appareils simultanés" value={client.sharedUsers === null ? "Non défini" : String(client.sharedUsers)} />
          <DetailLine
            icon={Clock}
            label="Expiration de validité"
            value={client.expiresAt ? formatClientDateTime(client.expiresAt) : "Non définie"}
          />
          <DetailLine
            icon={ShieldCheck}
            label="Consommation"
            value={client.consumptionPercent === null ? "Sans limite mesurable" : `${client.consumptionPercent}%`}
          />
          <DetailLine icon={ShieldCheck} label="Statut ticket" value={ticketStatusLabel(client.ticketStatus)} />
        </dl>

        <div className="confirm-dialog__actions">
          <Button onClick={onClose} variant="primary">
            Fermer
          </Button>
        </div>
      </section>
    </div>
  );
}

function DetailLine({
  icon: Icon,
  label,
  value
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt><Icon aria-hidden="true" /> {label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ticketStatusLabel(status: ConnectedClientViewModel["ticketStatus"]): string {
  const labels: Record<ConnectedClientViewModel["ticketStatus"], string> = {
    active: "Actif",
    available: "Disponible",
    exhausted: "Épuisé",
    disabled: "Désactivé",
    error: "Erreur de révocation",
    expired: "Expiré",
    unknown: "Non identifié"
  };

  return labels[status];
}

function formatRefreshDate(date: Date): string {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatClientDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponible";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}
