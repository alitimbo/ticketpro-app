import { FileText, Router, Ticket, Users } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { Badge, Button, Card, DataListItem, PageHeader, StatCard, Toast, ToastRegion } from "../../shared/ui";

export function GlobalHomePage() {
  const { session } = useAuth();

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button icon={Router} variant="primary">Choisir un routeur</Button>}
        description="Synthèse locale des routeurs, des tickets du jour et des actions à surveiller."
        eyebrow="Global"
        title={`Bienvenue, ${session?.internal_profile_label ?? "Utilisateur"}`}
      />

      <div className="page-grid">
        <div className="span-4">
          <StatCard icon={Router} label="Routeurs" value="3" hint="2 disponibles maintenant" />
        </div>
        <div className="span-4">
          <StatCard icon={Ticket} label="Tickets créés" value="128" hint="Aujourd’hui" />
        </div>
        <div className="span-4">
          <StatCard icon={FileText} label="Fichiers PDF" value="7" hint="Prêts à imprimer" />
        </div>

        <Card className="span-8" title="Activité récente" description="Les dernières actions locales de l’opérateur.">
          <div className="data-list">
            <DataListItem
              description="20 tickets générés pour le plan Journée."
              icon={Ticket}
              meta={<Badge status="success">Succès</Badge>}
              title="Lot de tickets prêt"
            />
            <DataListItem
              description="Un routeur est marqué hors ligne."
              icon={Router}
              meta={<Badge status="offline">Hors ligne</Badge>}
              title="Vérification à prévoir"
            />
          </div>
        </Card>

        <Card className="span-4" title="État rapide">
          <div className="data-list">
            <DataListItem
              description="Opérateurs et consultation locale."
              icon={Users}
              meta={<Badge status="active">Actif</Badge>}
              title="Rôles prêts"
            />
          </div>
        </Card>
      </div>

      <ToastRegion>
        <Toast message="Les données de démonstration sont disponibles." status="success" title="Application prête" />
      </ToastRegion>
    </div>
  );
}
