import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, CreditCard, Package, RefreshCw, Router, ShieldCheck } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { RouterRepository, useAppDatabase } from "../../services/database";
import { listLicensePlans, type LicensePlan } from "../../services/licensing";
import {
  abandonPaymentOrder,
  getPaymentOrderStatus,
  type InitiatedPaymentOrder,
  type IpayPaymentType
} from "../../services/payments";
import { purchaseSaasSubscription } from "../../services/saas";
import { PaymentMethodPicker } from "../../shared/payment/PaymentMethodPicker";
import { Badge, Button, Card, DataListItem, PageHeader, StatCard } from "../../shared/ui";
import { formatCfa, formatDate, formatPlanDuration } from "./subscriptionPageModel";

export function SubscriptionPage() {
  const { refreshSaasAccount, saasAccount, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [routerCount, setRouterCount] = useState(0);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [paymentType, setPaymentType] = useState<IpayPaymentType>("mobile");
  const [payment, setPayment] = useState<InitiatedPaymentOrder | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const subscription = saasAccount?.subscription ?? null;
  const isGracePeriod = subscription?.status === "grace_period";
  const isTrial = subscription?.status === "trial";
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null;
  const canPay = Boolean(saasAccount?.access.can_manage_billing);

  useEffect(() => {
    void listLicensePlans()
      .then((catalog) => {
        const available = catalog.filter((plan) => !plan.is_reseller);
        setPlans(available);
        setSelectedPlanId((current) => current || available.find((plan) => plan.is_recommended)?.id || available[0]?.id || "");
      })
      .catch((error) => setMessage(errorMessage(error)));
  }, []);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) return;
    void routerRepository
      .listByAccount(session.account_id)
      .then((routers) => setRouterCount(routers.filter((router) => router.subscription_counted === 1).length))
      .catch((error) => setMessage(errorMessage(error)));
  }, [isInitialized, isPersistent, routerRepository, session]);

  const beginPayment = async () => {
    if (!selectedPlan || !msisdn.trim()) {
      setMessage("Choisissez un forfait et entrez le numéro qui effectuera le paiement.");
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      setPayment(await purchaseSaasSubscription({
        planId: selectedPlan.id,
        msisdn,
        paymentType
      }));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const confirmPayment = async () => {
    if (!payment) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const status = await getPaymentOrderStatus({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      if (status.order.status === "pending") {
        setMessage("Paiement encore en attente. Validez-le sur le téléphone puis réessayez.");
        return;
      }
      if (status.order.status !== "succeeded" || status.order.fulfillment_status !== "fulfilled") {
        setMessage(status.order.failure_reason ?? "Le paiement n'a pas abouti.");
        return;
      }
      await refreshSaasAccount();
      setPayment(null);
      setMessage("Abonnement activé. Les services TicketPro sont disponibles.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const restartPayment = async () => {
    if (!payment) return;
    setIsLoading(true);
    try {
      const result = await abandonPaymentOrder({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      if (!result.abandoned && result.order.status === "succeeded") {
        await confirmPayment();
        return;
      }
      setPayment(null);
      setMessage("Tentative annulée. Vous pouvez relancer un paiement.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        description="Votre abonnement contrôle le nombre de routeurs et l'accès aux services TicketPro."
        eyebrow="Compte SaaS"
        title="Abonnement"
      />

      {message ? <p className="form-error">{message}</p> : null}
      {isGracePeriod ? (
        <div className="notice notice--warning">
          Votre abonnement est expiré, mais vos services restent actifs pendant encore{" "}
          {subscription.grace_days_remaining} jour(s). Renouvelez avant le{" "}
          {subscription.grace_period_end ? formatDate(subscription.grace_period_end) : "délai indiqué"}.
        </div>
      ) : null}
      {isTrial ? (
        <div className="notice">
          Essai gratuit actif jusqu’au{" "}
          {subscription?.current_period_end ? formatDate(subscription.current_period_end) : "—"}.
          L’essai ne bénéficie pas du délai supplémentaire de 7 jours.
        </div>
      ) : null}

      <div className="stats-grid">
        <StatCard
          icon={Package}
          label="Pack actuel"
          value={subscription?.plan?.name ?? "Aucun pack actif"}
          hint={isGracePeriod ? "Délai de grâce actif" : isTrial ? "Essai gratuit" : subscription?.is_active ? "Abonnement actif" : "Renouvellement requis"}
        />
        <StatCard
          icon={Router}
          label="Routeurs utilisés"
          value={`${routerCount} / ${subscription?.router_limit ?? 0}`}
          hint="Quota de l'organisation"
        />
        <StatCard
          icon={ShieldCheck}
          label="Services"
          value={subscription?.is_active ? "Actifs" : "Suspendus"}
          hint={subscription?.is_active ? "Gestion distante autorisée" : "Connexion et paiement restent accessibles"}
        />
        <StatCard
          icon={CalendarDays}
          label="Échéance"
          value={
            isGracePeriod && subscription?.grace_period_end
              ? formatDate(subscription.grace_period_end)
              : subscription?.current_period_end ? formatDate(subscription.current_period_end) : "—"
          }
          hint={isGracePeriod ? "Suspension définitive des services" : "Expiration commune à l'organisation"}
        />
      </div>

      <Card title="Abonnement actuel" description="Informations vérifiées directement par le serveur TicketPro.">
        <div className="subscription-overview-grid">
          <DataListItem
            description={subscription?.plan?.name ?? "Aucun abonnement"}
            icon={Package}
            meta={
              <Badge status={subscription?.is_active ? "success" : "warning"}>
                {isGracePeriod ? "Grâce active" : isTrial ? "Essai" : subscription?.is_active ? "Actif" : "Expiré"}
              </Badge>
            }
            title="Forfait"
          />
          <DataListItem
            description={`${subscription?.router_limit ?? 0} routeur(s) maximum`}
            icon={Router}
            title="Quota"
          />
          <DataListItem
            description={subscription?.current_period_end ? formatDate(subscription.current_period_end) : "Non définie"}
            icon={CalendarDays}
            title="Fin de période"
          />
          <DataListItem
            description={formatCfa(subscription?.plan?.price_cfa ?? null)}
            icon={CreditCard}
            title="Dernier montant"
          />
        </div>
      </Card>

      <Card title="Souscrire ou renouveler" description="Le paiement est vérifié par iPay avant l'activation des services.">
        {!payment ? (
          <>
            <div className="form-grid">
              <label className="form-field">
                Forfait
                <select onChange={(event) => setSelectedPlanId(event.target.value)} value={selectedPlanId}>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} — {formatPlanDuration(plan.duration_days)} — {plan.router_limit} routeur(s) —{" "}
                      {formatDeviceLimit(plan)} — {formatCfa(plan.price_cfa)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Numéro de paiement
                <input
                  inputMode="tel"
                  onChange={(event) => setMsisdn(event.target.value)}
                  placeholder="90 90 90 90"
                  value={msisdn}
                />
              </label>
              <label className="form-field">
                Moyen de paiement
                <select onChange={(event) => setPaymentType(event.target.value as IpayPaymentType)} value={paymentType}>
                  <option value="mobile">Mobile Money (Airtel, Moov, Zamani)</option>
                  <option value="nita_online">Nita</option>
                  <option value="amanata">Amana</option>
                </select>
              </label>
            </div>
            {selectedPlan ? (
              <div className="subscription-selection-summary" aria-live="polite">
                <div>
                  <span>Forfait choisi</span>
                  <strong>{selectedPlan.name}</strong>
                </div>
                <div>
                  <span>Durée</span>
                  <strong>{formatPlanDuration(selectedPlan.duration_days)}</strong>
                </div>
                <div>
                  <span>Capacité</span>
                  <strong>{selectedPlan.router_limit} routeur(s)</strong>
                </div>
                <div>
                  <span>Appareils</span>
                  <strong>{formatDeviceLimit(selectedPlan)}</strong>
                </div>
                <div>
                  <span>Montant</span>
                  <strong>{formatCfa(selectedPlan.price_cfa)}</strong>
                </div>
              </div>
            ) : null}
            <PaymentMethodPicker onChange={setPaymentType} value={paymentType} />
            <Button
              disabled={!canPay || isLoading || plans.length === 0}
              icon={CreditCard}
              onClick={beginPayment}
              variant="primary"
            >
              {isLoading ? "Préparation…" : "Payer ce forfait"}
            </Button>
          </>
        ) : (
          <div className="first-launch-form">
            <div className="auth-note">
              <CreditCard aria-hidden="true" size={20} />
              <p>
                {payment.order.plan.name} — {formatPlanDuration(payment.order.plan.duration_days)} —{" "}
                {formatCfa(payment.order.amount)}
                {payment.payment.meta_data?.code ? ` — Code : ${payment.payment.meta_data.code}` : ""}
              </p>
            </div>
            <div className="confirm-dialog__actions">
              <Button disabled={isLoading} icon={RefreshCw} onClick={restartPayment} variant="ghost">
                Annuler et recommencer
              </Button>
              <Button disabled={isLoading} icon={CheckCircle2} onClick={confirmPayment} variant="primary">
                J'ai validé le paiement
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}

function formatDeviceLimit(plan: LicensePlan): string {
  return plan.device_limit_mode === "unlimited" || plan.max_devices === null
    ? "Appareils illimités"
    : `${plan.max_devices} appareil(s)`;
}
