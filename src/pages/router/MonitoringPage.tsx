import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileText,
  Gauge,
  HardDrive,
  ListChecks,
  RefreshCw,
  Router,
  ServerCog,
  Upload,
  Users,
  Wifi
} from "lucide-react";
import {
  FakeRouterAdapter,
  RouterService,
  RouterServiceError,
  createPersistedRouterService,
  type RouterActionLog
} from "../../services/router";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import {
  ActiveSessionCacheRepository,
  RouterConnectionRepository,
  RouterRepository,
  RouterSnapshotRepository
} from "../../services/database/repositories";
import { DatabaseRouterActionLogger } from "../../services/logging";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, StatusDot } from "../../shared/ui";
import type { IconComponent } from "../../shared/ui";
import {
  buildMonitoringViewModel,
  createChartPath,
  formatTraffic,
  type MonitoringDiagnostic,
  type MonitoringViewModel
} from "./monitoringPageModel";

export function MonitoringPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [model, setModel] = useState<MonitoringViewModel | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);

  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const snapshotRepository = useMemo(() => new RouterSnapshotRepository(database), [database]);
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

  const refresh = async () => {
    if (isPersistent && (!isInitialized || !session)) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const service = await createService();
      const [connection, servers, health, traffic, dateTime, plans, ticketUsers, activeUsers] = await Promise.all([
        service.testConnection(),
        service.getHotspotServers(),
        service.getRouterHealth(),
        service.getInterfaceTraffic(),
        service.getRouterDateTime(),
        service.getHotspotPlans(),
        service.listHotspotUsers(),
        service.listActiveUsers()
      ]);

      const snapshots = isPersistent ? await snapshotRepository.listByRouter(routerId) : [];

      if (isPersistent && session && connection) {
        const capturedAt = connection.checkedAt;
        const router = await routerRepository.findById(routerId);

        if (router) {
          await Promise.all([
            activeSessionCacheRepository.replaceForRouter(routerId, activeUsers, capturedAt),
            snapshotRepository.create({
              active_clients_count: activeUsers.length,
              captured_at: capturedAt,
              cpu_load: health.cpuLoad,
              id: createId("snapshot"),
              memory_total: health.memoryTotal,
              memory_used: health.memoryUsed,
              plans_count: plans.length,
              router_id: routerId,
              tickets_count: ticketUsers.length,
              uptime: health.uptime
            }),
            routerRepository.recordConnectionTest({
              accountId: session.account_id,
              checkedAt: capturedAt,
              errorMessage: null,
              internalProfileId: session.internal_profile_id,
              mode: router.connection_mode,
              routerId,
              status: "connected"
            })
          ]);
        }
      }

      setModel(
        buildMonitoringViewModel({
          activeUsers,
          checkedAt: new Date(),
          connection,
          dateTime,
          health,
          plans,
          snapshots,
          servers,
          ticketUsers,
          traffic
        })
      );
    } catch (caught) {
      if (isPersistent && session) {
        const router = await routerRepository.findById(routerId);
        if (router) {
          await routerRepository
            .recordConnectionTest({
              accountId: session.account_id,
              checkedAt: new Date().toISOString(),
              errorMessage: caught instanceof Error ? caught.message : String(caught),
              internalProfileId: session.internal_profile_id,
              mode: router.connection_mode,
              routerId,
              status: "offline"
            })
            .catch(() => undefined);
        }
      }
      setError(caught instanceof RouterServiceError ? caught.message : "Impossible de lire l’état du routeur.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [activeSessionCacheRepository, connectionRepository, database, isInitialized, isPersistent, routerId, routerRepository, session, snapshotRepository]);

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button disabled={isLoading} icon={RefreshCw} onClick={() => void refresh()} variant="primary">
            Rafraîchir
          </Button>
        }
        description="Comprenez rapidement si le routeur fonctionne correctement."
        eyebrow="Routeur"
        title="Monitoring"
      />

      {error ? <p className="form-error">{error}</p> : null}

      {model ? (
        <>
          <Card className={`monitoring-health monitoring-health--${model.overallStatus}`}>
            <div className="monitoring-health__main">
              <StatusIcon status={model.overallStatus} />
              <div>
                <span>Diagnostic</span>
                <h2>{model.overallMessage}</h2>
                <p>
                  Dernière synchronisation : {model.lastSyncLabel} · Routeur : {model.uptime}
                </p>
              </div>
            </div>
            <Badge status={model.overallStatus}>{model.overallStatus === "success" ? "Normal" : "À vérifier"}</Badge>
          </Card>

          <div className="stats-grid">
            <StatCard icon={ServerCog} label="API" value={model.apiStatusLabel} hint={isPersistent ? "Lecture RouterOS réelle" : "Démo locale"} />
            <StatCard icon={Wifi} label="Hotspot" value={model.hotspotStatusLabel} hint="Service clients" />
            <StatCard icon={Cpu} label="CPU" value={`${model.cpuLoad}%`} hint={model.cpuLoad >= 80 ? "Élevé" : "Normal"} />
            <StatCard icon={HardDrive} label="Mémoire" value={`${model.memoryPercent}%`} hint={model.memoryText} />
            <StatCard icon={Users} label="Clients actifs" value={String(model.activeClientsCount)} hint="Connectés maintenant" />
            <StatCard icon={Clock} label="Date routeur" value={model.dateTimeLabel} hint="Heure du routeur" />
            <StatCard icon={FileText} label="Tickets" value={String(model.ticketCount)} hint="Connus localement" />
            <StatCard icon={ListChecks} label="Plans" value={String(model.planCount)} hint="Disponibles" />
          </div>

          <div className="monitoring-grid">
            <Card title="Graphiques 60 secondes" description={isPersistent ? "Mesures capturées et conservées localement." : "Tendance de démonstration locale."}>
              <div className="monitoring-chart-grid">
                <MiniChart color="primary" icon={Cpu} label="CPU" suffix="%" values={model.cpuSeries} />
                <MiniChart color="green" icon={HardDrive} label="Mémoire" suffix="%" values={model.memorySeries} />
                <TrafficChart download={model.downloadSeries} upload={model.uploadSeries} />
              </div>
            </Card>

            <Card title="Diagnostic simple" description="Les points importants traduits en messages lisibles.">
              <div className="monitoring-diagnostics">
                {model.diagnostics.map((item) => (
                  <DiagnosticRow diagnostic={item} key={item.id} />
                ))}
              </div>
            </Card>
          </div>

          <div className="monitoring-grid monitoring-grid--wide">
            <Card title="Trafic" description="Download et upload par accès réseau.">
              <div className="monitoring-traffic-list">
                {model.traffic.map((traffic) => (
                  <div className="monitoring-traffic-row" key={traffic.interfaceName}>
                    <div>
                      <strong>{formatInterfaceName(traffic.interfaceName)}</strong>
                      <span>{traffic.isRunning ? "Actif" : "Inactif"}</span>
                    </div>
                    <div>
                      <Download aria-hidden="true" />
                      {formatTraffic(traffic.rxBytesPerSecond)}
                    </div>
                    <div>
                      <Upload aria-hidden="true" />
                      {formatTraffic(traffic.txBytesPerSecond)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Dernières erreurs" description="Les détails techniques restent masqués par défaut.">
              {model.lastErrors.length > 0 ? (
                <div className="monitoring-errors">
                  {model.lastErrors.map((item) => (
                    <DiagnosticRow diagnostic={item} key={item.id} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  description={isPersistent ? "Aucune alerte détectée sur les dernières mesures." : "Aucune alerte détectée sur les données de démonstration."}
                  icon={CheckCircle2}
                  title="Aucune erreur récente"
                />
              )}

              <button
                className="advanced-toggle monitoring-technical-toggle"
                onClick={() => setShowTechnicalLogs((current) => !current)}
                type="button"
              >
                <Gauge aria-hidden="true" />
                {showTechnicalLogs ? "Masquer les détails techniques" : "Afficher les détails techniques"}
              </button>

              {showTechnicalLogs ? (
                <div className="monitoring-technical-list">
                  {logs.slice(-12).map((log, index) => (
                    <div key={`${log.action}-${index}`}>
                      <strong>{log.action}</strong>
                      <span>{log.userMessage}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <EmptyState
            action={
              <Button disabled={isLoading} icon={RefreshCw} onClick={() => void refresh()} variant="primary">
                Rafraîchir
              </Button>
            }
            description="Les informations du routeur ne sont pas encore chargées."
            icon={Router}
            title="Monitoring en attente"
          />
        </Card>
      )}
    </div>
  );
}

function MiniChart({
  color,
  icon: Icon,
  label,
  suffix,
  values
}: {
  color: "green" | "primary";
  icon: IconComponent;
  label: string;
  suffix: string;
  values: number[];
}) {
  const current = values.length > 0 ? values[values.length - 1] : 0;

  return (
    <div className="mini-chart">
      <div className="mini-chart__header">
        <span>
          <Icon aria-hidden="true" />
          {label}
        </span>
        <strong>{current}{suffix}</strong>
      </div>
      <svg aria-hidden="true" className={`mini-chart__svg mini-chart__svg--${color}`} viewBox="0 0 240 64">
        <path d={createChartPath(values)} />
      </svg>
    </div>
  );
}

function TrafficChart({ download, upload }: { download: number[]; upload: number[] }) {
  return (
    <div className="mini-chart mini-chart--traffic">
      <div className="mini-chart__header">
        <span>
          <Activity aria-hidden="true" />
          Trafic
        </span>
        <strong>{formatTraffic(download.length > 0 ? download[download.length - 1] : 0)}</strong>
      </div>
      <svg aria-hidden="true" className="mini-chart__svg mini-chart__svg--traffic" viewBox="0 0 240 64">
        <path className="mini-chart__download" d={createChartPath(download)} />
        <path className="mini-chart__upload" d={createChartPath(upload)} />
      </svg>
      <div className="mini-chart__legend">
        <span>Download</span>
        <span>Upload</span>
      </div>
    </div>
  );
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function DiagnosticRow({ diagnostic }: { diagnostic: MonitoringDiagnostic }) {
  return (
    <div className="monitoring-diagnostic-row">
      <StatusIcon status={diagnostic.status} />
      <div>
        <strong>{diagnostic.label}</strong>
        <span>{diagnostic.message}</span>
      </div>
      <Badge status={diagnostic.status}>{diagnostic.status === "success" ? "OK" : "À voir"}</Badge>
    </div>
  );
}

function StatusIcon({ status }: { status: MonitoringDiagnostic["status"] }) {
  const Icon = status === "success" || status === "active" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`monitoring-status-icon monitoring-status-icon--${status}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}

function formatInterfaceName(name: string): string {
  const labels: Record<string, string> = {
    "bridge-hotspot": "Réseau clients",
    ether1: "Internet",
    wifi1: "Wi-Fi"
  };

  return labels[name] ?? name;
}
