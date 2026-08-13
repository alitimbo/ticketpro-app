import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Router, Ticket, Users } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type {
  AppLogRecord,
  GeneratedFileRecord,
  RouterRecord,
  TicketRecord
} from "../../domain/database";
import {
  AppLogRepository,
  GeneratedFileRepository,
  RouterRepository,
  TicketRepository,
  useAppDatabase
} from "../../services/database";
import { Badge, Button, Card, DataListItem, EmptyState, PageHeader, StatCard } from "../../shared/ui";

type DashboardData = {
  files: GeneratedFileRecord[];
  logs: AppLogRecord[];
  routers: RouterRecord[];
  tickets: TicketRecord[];
};

const emptyDashboard: DashboardData = {
  files: [],
  logs: [],
  routers: [],
  tickets: []
};

export function GlobalHomePage() {
  const navigate = useNavigate();
  const { accountSession, saasAccount, session } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const fileRepository = useMemo(() => new GeneratedFileRepository(database), [database]);
  const logRepository = useMemo(() => new AppLogRepository(database), [database]);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accountId || !isInitialized) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void Promise.all([
      saasAccount?.organization.id
        ? routerRepository.listByOrganization(accountId, saasAccount.organization.id)
        : routerRepository.listByAccount(accountId),
      ticketRepository.listByAccount(accountId),
      fileRepository.listByAccount(accountId),
      logRepository.listByAccount(accountId)
    ])
      .then(([routers, tickets, files, logs]) => {
        if (!cancelled) {
          const routerIds = new Set(routers.map((router) => router.id));
          setDashboard({
            files: files.filter((file) => routerIds.has(file.router_id)),
            logs: logs.filter((log) => log.router_id !== null && routerIds.has(log.router_id)),
            routers,
            tickets: tickets.filter((ticket) => routerIds.has(ticket.router_id))
          });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Impossible de charger le tableau de bord.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, fileRepository, isInitialized, logRepository, routerRepository, saasAccount?.organization.id, ticketRepository]);

  const ticketsToday = dashboard.tickets.filter((ticket) => isToday(ticket.created_at)).length;
  const availableRouters = dashboard.routers.filter((router) => router.status === "active").length;
  const recentLogs = dashboard.logs.slice(0, 5);

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button icon={Router} onClick={() => navigate("/routeurs")} variant="primary">
            Gérer les routeurs
          </Button>
        }
        description="Synthèse réelle des routeurs, tickets et fichiers de votre organisation."
        eyebrow="Global"
        title={`Bienvenue, ${session?.internal_profile_label ?? "Utilisateur"}`}
      />

      {error ? <p className="form-error">{error}</p> : null}

      <div className="page-grid">
        <div className="span-4">
          <StatCard
            icon={Router}
            label="Routeurs"
            value={isLoading ? "…" : String(dashboard.routers.length)}
            hint={isLoading ? "Chargement" : `${availableRouters} disponible(s) maintenant`}
          />
        </div>
        <div className="span-4">
          <StatCard
            icon={Ticket}
            label="Tickets créés"
            value={isLoading ? "…" : String(ticketsToday)}
            hint="Aujourd’hui"
          />
        </div>
        <div className="span-4">
          <StatCard
            icon={FileText}
            label="Fichiers générés"
            value={isLoading ? "…" : String(dashboard.files.length)}
            hint="Conservés localement"
          />
        </div>

        <Card
          className="span-8"
          title="Activité récente"
          description="Les dernières actions enregistrées pour cette organisation."
        >
          {recentLogs.length > 0 ? (
            <div className="data-list">
              {recentLogs.map((log) => (
                <DataListItem
                  description={formatActivityDate(log.created_at)}
                  icon={log.router_id ? Router : Ticket}
                  key={log.id}
                  meta={<Badge status={log.level === "error" ? "offline" : log.level === "warning" ? "warning" : "success"}>{log.category}</Badge>}
                  title={log.user_message}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              description="Les opérations effectuées dans TicketPro apparaîtront ici."
              icon={Ticket}
              title="Aucune activité enregistrée"
            />
          )}
        </Card>

        <Card className="span-4" title="État du réseau">
          <div className="data-list">
            <DataListItem
              description={
                dashboard.routers.length === 0
                  ? "Ajoutez votre premier MikroTik pour commencer."
                  : `${availableRouters} routeur(s) actif(s) sur ${dashboard.routers.length}.`
              }
              icon={Users}
              meta={
                <Badge status={availableRouters > 0 ? "success" : "warning"}>
                  {availableRouters > 0 ? "Opérationnel" : "À configurer"}
                </Badge>
              }
              title={dashboard.routers.length === 0 ? "Aucun routeur configuré" : "Réseau enregistré"}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const today = new Date();

  return (
    date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  );
}

function formatActivityDate(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Date inconnue"
    : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
