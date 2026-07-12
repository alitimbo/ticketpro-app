import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, CreditCard, FileText, Package, Router, ShieldCheck } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { Badge, Button, Card, DataListItem, PageHeader, StatCard } from "../../shared/ui";
import { demoRouters } from "./routerPageModel";
import {
  billingPeriodLabel,
  changeSubscriptionPlan,
  countRoutersForSubscription,
  formatCfa,
  formatDate,
  formatSubscriptionPeriod,
  getSubscriptionOverview,
  markSubscriptionPaymentManual,
  type SubscriptionOverview
} from "./subscriptionPageModel";

export function SubscriptionPage() {
  const { session } = useAuth();
  const isAdmin = session?.internal_profile_role === "admin";
  const routersUsed = countRoutersForSubscription(demoRouters);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const overview = useMemo<SubscriptionOverview>(
    () => getSubscriptionOverview(routersUsed),
    [refreshKey, routersUsed]
  );

  const refresh = () => setRefreshKey((current) => current + 1);

  const changePlan = (planId: string) => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de modifier l'abonnement.");
      return;
    }

    changeSubscriptionPlan(planId);
    refresh();
    setMessage("Pack mis à jour en mode développement.");
  };

  const markManualPayment = () => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de modifier l'abonnement.");
      return;
    }

    markSubscriptionPaymentManual();
    refresh();
    setMessage("Paiement manuel enregistré.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          isAdmin ? (
            <Button icon={CheckCircle2} onClick={markManualPayment} variant="primary">
              Marquer paiement manuel
            </Button>
          ) : null
        }
        description="Facturation de l'utilisation de l'application. Ne concerne pas la vente de tickets WiFi."
        eyebrow="Global"
        title="Abonnement"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <div className="stats-grid">
        <StatCard icon={Package} label="Pack actuel" value={overview.plan.name} hint={`${overview.plan.routerLimit} routeur(s)`} />
        <StatCard icon={Router} label="Routeurs utilisés" value={`${overview.routersUsed} / ${overview.subscription.routerLimitSnapshot}`} hint="Routeurs comptabilisés" />
        <StatCard icon={ShieldCheck} label="Statut" value={overview.statusLabel} hint={`Paiement : ${overview.paymentStatusLabel}`} />
        <StatCard
          icon={CreditCard}
          label="Prix"
          value={formatCfa(overview.subscription.priceCfaSnapshot)}
          hint={`${formatCfa(overview.subscription.pricePerRouterCfaSnapshot)} / routeur`}
        />
      </div>

      <Card title="Abonnement actuel" description="Vue locale de l'abonnement du compte principal.">
        <div className="subscription-overview-grid">
          <DataListItem
            description={overview.plan.name}
            icon={Package}
            meta={<Badge status={overview.subscription.status === "active" ? "success" : "warning"}>{overview.statusLabel}</Badge>}
            title="Pack actuel"
          />
          <DataListItem
            description={`${overview.routersUsed} routeur(s) utilisés sur ${overview.subscription.routerLimitSnapshot}`}
            icon={Router}
            meta={<Badge status={overview.isOverLimit ? "error" : "success"}>{overview.routerUsagePercent}%</Badge>}
            title="Limite routeurs"
          />
          <DataListItem
            description={formatSubscriptionPeriod(overview.subscription.currentPeriodStart, overview.subscription.currentPeriodEnd)}
            icon={CalendarDays}
            title="Période actuelle"
          />
          <DataListItem
            description={formatDate(overview.subscription.currentPeriodEnd)}
            icon={CalendarDays}
            title="Prochain renouvellement"
          />
          <DataListItem
            description={formatCfa(overview.subscription.priceCfaSnapshot)}
            icon={CreditCard}
            meta={<Badge status="active">{overview.paymentStatusLabel}</Badge>}
            title="Montant"
          />
          <DataListItem
            description={`${formatCfa(overview.subscription.pricePerRouterCfaSnapshot)} par routeur / ${billingPeriodLabel(overview.plan.billingPeriod)}`}
            icon={CreditCard}
            title="Prix par routeur"
          />
        </div>
        {overview.isOverLimit ? (
          <p className="form-error subscription-warning">
            La limite de routeurs est dépassée. Changez de pack avant d'ajouter un nouveau routeur.
          </p>
        ) : null}
      </Card>

      <Card title="Voir les packs" description="Changement de pack réservé à l'Admin. Aucun paiement en ligne n'est intégré.">
        <div className="subscription-plan-grid">
          {overview.plans.map((plan) => {
            const isCurrent = plan.id === overview.plan.id;

            return (
              <article className={isCurrent ? "subscription-plan-card subscription-plan-card--current" : "subscription-plan-card"} key={plan.id}>
                <div>
                  <strong>{plan.name}</strong>
                  <span>{plan.routerLimit} routeur(s)</span>
                </div>
                {plan.isRecommended ? <Badge status="success">Recommandé</Badge> : null}
                <p>
                  {formatCfa(plan.priceCfa)}
                  {plan.priceCfa !== null ? ` / ${billingPeriodLabel(plan.billingPeriod)}` : ""}
                </p>
                <span>{formatCfa(plan.pricePerRouterCfa)} / routeur</span>
                <span>{plan.description}</span>
                <Button disabled={!isAdmin || isCurrent} onClick={() => changePlan(plan.id)} variant={isCurrent ? "ghost" : "secondary"}>
                  {isCurrent ? "Pack actuel" : "Changer de pack"}
                </Button>
              </article>
            );
          })}
        </div>
      </Card>

      <Card title="Factures" description="Historique local de facturation de l'abonnement logiciel.">
        <div className="data-list">
          {overview.invoices.map((invoice) => (
            <DataListItem
              description={`Émise le ${formatDate(invoice.issuedAt)} · Échéance ${formatDate(invoice.dueAt)}`}
              icon={FileText}
              key={invoice.id}
              meta={<Badge status={invoice.status === "paid" ? "success" : "warning"}>{invoiceStatusLabel(invoice.status)}</Badge>}
              title={`${invoice.invoiceNumber} · ${formatCfa(invoice.amountCfa)}`}
            />
          ))}
        </div>
      </Card>

      <Card title="Rappel périmètre">
        <DataListItem
          description="Ce module concerne uniquement l'abonnement logiciel et la limite de routeurs du compte principal. La facturation annuelle avec 2 mois offerts est prévue plus tard, mais elle n'est pas activée ici."
          icon={AlertTriangle}
          meta={<Badge status="warning">Pas de paiement en ligne</Badge>}
          title="Aucune vente de tickets WiFi"
        />
      </Card>
    </div>
  );
}

function invoiceStatusLabel(status: "cancelled" | "draft" | "issued" | "overdue" | "paid"): string {
  const labels: Record<typeof status, string> = {
    cancelled: "Annulée",
    draft: "Brouillon",
    issued: "Émise",
    overdue: "En retard",
    paid: "Payée"
  };

  return labels[status];
}
