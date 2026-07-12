import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  CalendarClock,
  Cpu,
  FileText,
  Gauge,
  HardDrive,
  Printer,
  Radio,
  RefreshCw,
  Router,
  Server,
  Ticket,
  Users,
  Wifi
} from "lucide-react";
import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotServer,
  HotspotUser,
  RouterDateTime,
  RouterHealth,
  RouterSystemInfo
} from "../../domain/router";
import { useAuth } from "../../app/auth/AuthProvider";
import { FakeRouterAdapter, RouterService, RouterServiceError } from "../../services/router";
import { compareLocalAndRouterTickets, type TicketSyncSummary } from "../../services/sync";
import { Badge, Button, Card, DataListItem, PageHeader, StatCard, StatusDot } from "../../shared/ui";
import { formatBytes, getRouterQuickActions } from "./routerHomeModel";
import { createDemoTickets } from "./ticketsPageModel";

type RouterDashboardData = {
  activeUsers: ActiveHotspotUser[];
  dateTime: RouterDateTime;
  health: RouterHealth;
  plans: HotspotPlan[];
  servers: HotspotServer[];
  systemInfo: RouterSystemInfo;
  users: HotspotUser[];
};

export function RouterHomePage() {
  const navigate = useNavigate();
  const { routerId = "routeur-demo" } = useParams();
  const { session, userCan } = useAuth();
  const [dashboard, setDashboard] = useState<RouterDashboardData | null>(null);
  const [cpuLoad, setCpuLoad] = useState(0);
  const [connectionMessage, setConnectionMessage] = useState("Connexion active");
  const [syncSummary, setSyncSummary] = useState<TicketSyncSummary | null>(null);
  const service = useMemo(
    () => new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }) }),
    []
  );
  const actions = session ? getRouterQuickActions(session.internal_profile_role, routerId) : [];
  const canCreateTickets = userCan("router.tickets.generate");

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      const [systemInfo, servers, plans, users, activeUsers, health, dateTime] = await Promise.all([
        service.getSystemInfo(),
        service.getHotspotServers(),
        service.getHotspotPlans(),
        service.listHotspotUsers(),
        service.listActiveUsers(),
        service.getRouterHealth(),
        service.getRouterDateTime()
      ]);

      if (!isMounted) {
        return;
      }

      setDashboard({ activeUsers, dateTime, health, plans, servers, systemInfo, users });
      setSyncSummary(compareLocalAndRouterTickets(createDemoTickets(), users, activeUsers).summary);
      setCpuLoad(health.cpuLoad);
    }

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [service]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCpuLoad((current) => {
        const next = current + Math.round(Math.random() * 8 - 3);
        return Math.min(72, Math.max(8, next));
      });
    }, 1800);

    return () => window.clearInterval(interval);
  }, []);

  const testRouter = async () => {
    try {
      await service.testConnection();
      setConnectionMessage("Routeur connecté");
    } catch (error) {
      setConnectionMessage(error instanceof RouterServiceError ? error.message : "Test impossible.");
    }
  };

  if (!dashboard) {
    return (
      <div className="page-stack">
        <PageHeader
          description="Chargement des informations du routeur."
          eyebrow="Routeur"
          title="Maison routeur"
        />
        <Card>
          <StatusDot label="Chargement" status="warning" />
        </Card>
      </div>
    );
  }

  const hotspotEnabled = dashboard.servers.some((server) => server.isEnabled);
  const memoryPercent = Math.round((dashboard.health.memoryUsed / dashboard.health.memoryTotal) * 100);
  const hasSyncWarning = Boolean(
    syncSummary &&
      (syncSummary.conflict > 0 || syncSummary.error > 0 || syncSummary.localMissing > 0 || syncSummary.routerMissing > 0)
  );

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          canCreateTickets ? (
            <Button
              icon={Ticket}
              onClick={() => navigate(`/routeurs/${routerId}/tickets/generation`)}
              size="large"
              variant="primary"
            >
              Créer des tickets
            </Button>
          ) : null
        }
        description="Vue claire du routeur sélectionné, de ses tickets et de son état actuel."
        eyebrow="Routeur"
        title="Boutique centre"
      />

      <section className="router-hero">
        <div className="router-hero__main">
          <div className="router-card__icon">
            <Router aria-hidden="true" />
          </div>
          <div>
            <h2>{dashboard.systemInfo.model}</h2>
            <p>{dashboard.systemInfo.identity}</p>
          </div>
        </div>
        <div className="router-hero__states">
          <StatusDot label={connectionMessage} status="active" />
          <Badge status={hotspotEnabled ? "success" : "warning"}>
            {hotspotEnabled ? "Hotspot actif" : "Hotspot à vérifier"}
          </Badge>
        </div>
      </section>

      <div className="page-grid">
        <Card className="span-8" title="Informations routeur">
          <div className="router-info-grid">
            <InfoItem label="Zone" value="Boutique centre" />
            <InfoItem label="Modèle" value={dashboard.systemInfo.model} />
            <InfoItem label="Carte" value={dashboard.systemInfo.boardName} />
            <InfoItem label="Numéro de série" value={dashboard.systemInfo.serialNumber} />
            <InfoItem label="Version" value={dashboard.systemInfo.routerOsVersion} />
            <InfoItem label="Date et heure" value={`${dashboard.dateTime.date} ${dashboard.dateTime.time}`} />
          </div>
        </Card>

        <Card className="span-4" title="État temps réel">
          <div className="router-meter">
            <div>
              <p>CPU</p>
              <strong>{cpuLoad}%</strong>
            </div>
            <div className="router-meter__bar">
              <span style={{ width: `${cpuLoad}%` }} />
            </div>
          </div>
          <div className="router-meter">
            <div>
              <p>Mémoire</p>
              <strong>
                {formatBytes(dashboard.health.memoryUsed)} / {formatBytes(dashboard.health.memoryTotal)}
              </strong>
            </div>
            <div className="router-meter__bar">
              <span style={{ width: `${memoryPercent}%` }} />
            </div>
          </div>
        </Card>

        <div className="span-4">
          <StatCard icon={Activity} label="Actifs" value={String(dashboard.activeUsers.length)} hint="Clients connectés" />
        </div>
        <div className="span-4">
          <StatCard icon={Ticket} label="Tickets" value={String(dashboard.users.length)} hint="Tickets simulés" />
        </div>
        <div className="span-4">
          <StatCard icon={FileText} label="Plans" value={String(dashboard.plans.length)} hint="Offres disponibles" />
        </div>
        <div className="span-4">
          <StatCard icon={Users} label="Utilisateurs Hotspot" value={String(dashboard.users.length)} hint="Comptes locaux" />
        </div>
        <div className="span-4">
          <StatCard icon={Printer} label="Imprimante" value="Prête" hint="PDF disponibles" />
        </div>
        <div className="span-4">
          <StatCard icon={CalendarClock} label="Dernière synchronisation" value="Maintenant" hint={dashboard.health.uptime} />
        </div>
        <div className="span-4">
          <StatCard
            icon={RefreshCw}
            label="Tickets vérifiés"
            value={syncSummary ? `${syncSummary.routerSynced}/${syncSummary.totalLocal}` : "À vérifier"}
            hint={syncSummary ? `${syncSummary.routerMissing} absent(s) routeur` : "Synchronisation non lancée"}
          />
        </div>

        <Card className="span-8" title="État du routeur">
          <div className="data-list">
            <DataListItem
              description={`${dashboard.activeUsers.length} client(s) connecté(s), ${dashboard.users.length} utilisateur(s) Hotspot.`}
              icon={Wifi}
              meta={<StatusDot label="Connecté" status="active" />}
              title="Connexion"
            />
            <DataListItem
              description={dashboard.servers.map((server) => `${server.name} sur ${server.interfaceName}`).join(", ")}
              icon={Radio}
              meta={<Badge status={hotspotEnabled ? "success" : "warning"}>{hotspotEnabled ? "Actif" : "À vérifier"}</Badge>}
              title="Hotspot"
            />
            <DataListItem
              description={`${formatBytes(dashboard.health.memoryUsed)} utilisés sur ${formatBytes(dashboard.health.memoryTotal)}.`}
              icon={HardDrive}
              meta={<Badge status="active">{memoryPercent}%</Badge>}
              title="Mémoire"
            />
            <DataListItem
              description={
                syncSummary
                  ? `${syncSummary.routerSynced} ticket(s) confirmé(s), ${syncSummary.routerMissing} absent(s) du routeur, ${syncSummary.localMissing} absent(s) localement.`
                  : "La comparaison avec le routeur n'a pas encore été lancée."
              }
              icon={RefreshCw}
              meta={<Badge status={hasSyncWarning ? "warning" : "success"}>{hasSyncWarning ? "À vérifier" : "À jour"}</Badge>}
              title="Synchronisation tickets"
            />
          </div>
        </Card>

        <Card className="span-4" title="Actions rapides" description="Actions adaptées à votre profil.">
          <div className="quick-action-grid">
            {actions.map((action) => (
              <Button
                icon={iconForAction(action.id)}
                key={action.id}
                onClick={() => (action.to ? navigate(action.to) : void testRouter())}
                variant={action.id === "createTickets" ? "primary" : "secondary"}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="router-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function iconForAction(actionId: string) {
  const icons = {
    clients: Users,
    createTickets: Ticket,
    report: FileText,
    testRouter: Gauge,
    tickets: Server
  };

  return icons[actionId as keyof typeof icons] ?? Activity;
}
