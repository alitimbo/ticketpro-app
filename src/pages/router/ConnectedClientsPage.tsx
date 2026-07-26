import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Ban,
  Clock,
  Copy,
  Download,
  Eye,
  Laptop,
  RefreshCw,
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
import type { ActiveSessionCacheRecord } from "../../domain/database";
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
  RouterConnectionRepository,
  RouterRepository
} from "../../services/database/repositories";
import { DatabaseRouterActionLogger } from "../../services/logging";
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
  emptyConnectedClientFilters,
  filterConnectedClients,
  formatClientBytes,
  getConnectedClientPlanOptions,
  type ConnectedClientFilters,
  type ConnectedClientViewModel
} from "./connectedClientsPageModel";

type PendingAction = {
  client: ConnectedClientViewModel;
  type: "disconnect" | "disable";
} | null;

type Notice = {
  status: "error" | "success";
  text: string;
} | null;

export function ConnectedClientsPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canManage = session?.internal_profile_role === "admin";
  const [clients, setClients] = useState<ConnectedClientViewModel[]>([]);
  const [filters, setFilters] = useState<ConnectedClientFilters>(emptyConnectedClientFilters);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [selectedClient, setSelectedClient] = useState<ConnectedClientViewModel | null>(null);

  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const activeSessionCacheRepository = useMemo(() => new ActiveSessionCacheRepository(database), [database]);

  const createService = async () => {
    if (!isPersistent) {
      return new RouterService({
        adapter: new FakeRouterAdapter({ latencyMs: 0 }),
        logger: { write: (log) => setLogs((current) => [...current, log]) }
      });
    }

    if (!isInitialized || !session) {
      throw new Error("La base locale n'est pas encore prête.");
    }

    const router = await routerRepository.findById(routerId);
    if (!router) {
      throw new Error("Routeur introuvable dans la base locale.");
    }

    return createPersistedRouterService({
      authSession: session,
      connections: await connectionRepository.listByRouter(routerId),
      logger: new DatabaseRouterActionLogger(database),
      router
    });
  };

  const loadClients = async () => {
    if (isPersistent && (!isInitialized || !session)) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const service = await createService();
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
      }
      setClients(buildConnectedClientViewModels(activeUsers, hotspotUsers, plans, router));
      setLastRefreshAt(formatRefreshDate(new Date()));
    } catch (error) {
      if (isPersistent) {
        const [router, cachedUsers] = await Promise.all([
          routerRepository.findById(routerId),
          activeSessionCacheRepository.listByRouter(routerId)
        ]);

        if (router && cachedUsers.length > 0) {
          setClients(buildConnectedClientViewModels(cachedUsers.map(activeUserFromCache), [], [], router));
          setLastRefreshAt(formatRefreshDate(new Date(cachedUsers[0].cached_at)));
          setNotice({ status: "error", text: "Routeur hors ligne : affichage du dernier cache local." });
          setIsLoading(false);
          return;
        }
      }
      setNotice({
        status: "error",
        text: error instanceof RouterServiceError ? error.message : "Impossible de charger les clients connectés."
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadClients();
  }, [activeSessionCacheRepository, connectionRepository, database, isInitialized, isPersistent, routerId, routerRepository, session]);

  const filteredClients = useMemo(() => filterConnectedClients(clients, filters), [clients, filters]);
  const planOptions = useMemo(() => getConnectedClientPlanOptions(clients), [clients]);
  const totalDownload = filteredClients.reduce((total, client) => total + client.downloadedBytes, 0);
  const totalUpload = filteredClients.reduce((total, client) => total + client.uploadedBytes, 0);

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
    setPendingAction(null);
    setNotice(null);

    try {
      const service = await createService();
      if (type === "disable") {
        await service.disableHotspotUser(client.username);
      }

      await service.disconnectActiveUser(client.username);
      setClients((current) => current.filter((item) => item.username !== client.username));
      setNotice({
        status: "success",
        text: type === "disable" ? "Ticket désactivé et client déconnecté." : "Client déconnecté."
      });
    } catch (error) {
      setNotice({
        status: "error",
        text: error instanceof RouterServiceError ? error.message : "Action impossible pour le moment."
      });
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button disabled={isLoading} icon={RefreshCw} onClick={() => void loadClients()} variant="primary">
            Rafraîchir
          </Button>
        }
        description="Suivez les utilisateurs actuellement connectés au réseau."
        eyebrow="Routeur"
        title="Clients connectés"
      />

      <div className="stats-grid">
        <StatCard icon={UserRound} label="Connectés" value={String(filteredClients.length)} hint="Clients visibles" />
        <StatCard icon={Download} label="Download" value={formatClientBytes(totalDownload)} hint="Volume reçu" />
        <StatCard icon={Upload} label="Upload" value={formatClientBytes(totalUpload)} hint="Volume envoyé" />
        <StatCard icon={RefreshCw} label="Dernière mise à jour" value={lastRefreshAt ?? "En attente"} hint={`${logs.length} log(s)`} />
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
              <option value="">Tous</option>
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
          {lastRefreshAt ? <StatusDot label={`Mis à jour ${lastRefreshAt}`} status="active" /> : null}
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
                canManage={canManage}
                client={client}
                key={client.id}
                onCopyIp={() => void copyValue("IP", client.ipAddress)}
                onCopyMac={() => void copyValue("MAC", client.macAddress)}
                onDetail={() => setSelectedClient(client)}
                onDisable={() => setPendingAction({ client, type: "disable" })}
                onDisconnect={() => setPendingAction({ client, type: "disconnect" })}
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
        confirmLabel={pendingAction?.type === "disable" ? "Désactiver" : "Déconnecter"}
        description={
          pendingAction?.type === "disable"
            ? `Le ticket ${pendingAction.client.username} sera désactivé puis déconnecté.`
            : `Le client ${pendingAction?.client.username ?? ""} sera déconnecté.`
        }
        isOpen={Boolean(pendingAction)}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
        title={pendingAction?.type === "disable" ? "Désactiver le ticket ?" : "Déconnecter ce client ?"}
      />

      <ClientDetailDialog client={selectedClient} onClose={() => setSelectedClient(null)} />
    </div>
  );
}

type ConnectedClientRowProps = {
  canManage: boolean;
  client: ConnectedClientViewModel;
  onCopyIp: () => void;
  onCopyMac: () => void;
  onDetail: () => void;
  onDisable: () => void;
  onDisconnect: () => void;
};

function ConnectedClientRow({
  canManage,
  client,
  onCopyIp,
  onCopyMac,
  onDetail,
  onDisable,
  onDisconnect
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
            <Badge status="active">Actif</Badge>
          </div>
          <p>{client.planName} · {client.routerName}</p>
        </div>
      </div>

      <div className="client-row__network">
        <span><Smartphone aria-hidden="true" /> {client.ipAddress}</span>
        <span><Laptop aria-hidden="true" /> {client.macAddress}</span>
      </div>

      <div className="client-row__usage">
        <span><Clock aria-hidden="true" /> {client.uptime}</span>
        <span>Reste {client.sessionTimeLeft}</span>
        <strong>{formatClientBytes(client.totalBytes)}</strong>
      </div>

      <ActionMenu
        items={[
          { icon: Eye, label: "Voir détail ticket", onSelect: onDetail },
          { icon: Copy, label: "Copier MAC", onSelect: onCopyMac },
          { icon: Copy, label: "Copier IP", onSelect: onCopyIp },
          ...(canManage
            ? [
                { icon: WifiOff, label: "Déconnecter", onSelect: onDisconnect },
                { icon: Ban, label: "Désactiver ticket", onSelect: onDisable }
              ]
            : [])
        ]}
      />
    </article>
  );
}

function ClientDetailDialog({
  client,
  onClose
}: {
  client: ConnectedClientViewModel | null;
  onClose: () => void;
}) {
  if (!client) {
    return null;
  }

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
          <Badge status="active">Actif</Badge>
        </header>

        <dl className="client-detail-grid">
          <DetailLine icon={ShieldCheck} label="Ticket" value={client.username} />
          <DetailLine icon={Router} label="Routeur" value={client.routerName} />
          <DetailLine icon={Smartphone} label="Adresse IP" value={client.ipAddress} />
          <DetailLine icon={Laptop} label="Adresse MAC" value={client.macAddress} />
          <DetailLine icon={Clock} label="Temps connecté" value={client.uptime} />
          <DetailLine icon={Clock} label="Temps restant" value={client.sessionTimeLeft} />
          <DetailLine icon={Download} label="Download" value={formatClientBytes(client.downloadedBytes)} />
          <DetailLine icon={Upload} label="Upload" value={formatClientBytes(client.uploadedBytes)} />
          <DetailLine icon={Laptop} label="Volume total" value={formatClientBytes(client.totalBytes)} />
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
    disabled: "Désactivé",
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

function activeUserFromCache(record: ActiveSessionCacheRecord) {
  return {
    downloadedBytes: record.downloaded_bytes,
    id: record.id,
    ipAddress: record.ip_address ?? "",
    macAddress: record.mac_address ?? "",
    sessionTimeLeft: record.session_time_left ?? "Non disponible",
    uploadedBytes: record.uploaded_bytes,
    uptime: record.uptime ?? "0s",
    username: record.username
  };
}
