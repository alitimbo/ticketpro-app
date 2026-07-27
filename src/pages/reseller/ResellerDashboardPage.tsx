import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, KeyRound, LogOut, RefreshCw, Router, ShoppingCart, Users } from "lucide-react";
import { Badge, Button, Card, StatCard } from "../../shared/ui";
import { formatCfa } from "../global/subscriptionPageModel";
import {
  abandonPaymentOrder,
  getPaymentOrderStatus,
  type InitiatedPaymentOrder,
  type IpayPaymentType
} from "../../services/payments";
import { listLicensePlans, type LicensePlan } from "../../services/licensing";
import {
  createResellerLicense,
  clearResellerSession,
  getResellerOverview,
  initiateResellerPackPayment,
  listResellerLicenses,
  logoutReseller,
  readResellerSession,
  type ResellerLicense,
  type ResellerOverview
} from "../../services/reseller";

export function ResellerDashboardPage({ onExit }: { onExit: () => void }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<ResellerOverview | null>(null);
  const [licenses, setLicenses] = useState<ResellerLicense[]>([]);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [childForm, setChildForm] = useState({ label: "", routerLimit: 1, maxDevices: 1, durationDays: 30 });
  const [paymentForm, setPaymentForm] = useState<{ msisdn: string; paymentType: IpayPaymentType; planId: string }>({
    msisdn: "",
    paymentType: "mobile",
    planId: ""
  });
  const [payment, setPayment] = useState<InitiatedPaymentOrder | null>(null);

  const resellerPlans = useMemo(() => plans.filter((plan) => plan.is_reseller), [plans]);

  const refresh = useCallback(async (token: string) => {
    const [nextOverview, nextLicenses, nextPlans] = await Promise.all([
      getResellerOverview(token),
      listResellerLicenses(token),
      listLicensePlans()
    ]);
    setOverview(nextOverview);
    setLicenses(nextLicenses);
    setPlans(nextPlans);
    setPaymentForm((current) => ({
      ...current,
      planId: current.planId || nextPlans.find((plan) => plan.is_reseller)?.id || ""
    }));
  }, []);

  useEffect(() => {
    void readResellerSession()
      .then(async (token) => {
        if (!token) {
          onExit();
          return;
        }
        setSessionToken(token);
        await refresh(token);
      })
      .catch((loadError) => {
        const message = loadError instanceof Error ? loadError.message : "Espace revendeur indisponible.";
        if (/session revendeur invalide|erreur revendeur \(401\)/i.test(message)) {
          clearResellerSession();
          onExit();
          return;
        }
        setError(message);
      })
      .finally(() => setIsLoading(false));
  }, [onExit, refresh]);

  const createKey = async () => {
    if (!sessionToken) return;
    try {
      setError(null);
      const result = await createResellerLicense(sessionToken, childForm);
      setCreatedKey(result.key);
      await refresh(sessionToken);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "Création impossible.");
    }
  };

  const initiatePayment = async () => {
    if (!sessionToken || !paymentForm.planId) return;
    try {
      setError(null);
      setPayment(await initiateResellerPackPayment(sessionToken, paymentForm));
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Paiement impossible.");
    }
  };

  const verifyPayment = async () => {
    if (!sessionToken || !payment) return;
    try {
      setError(null);
      const result = await getPaymentOrderStatus({
        orderId: payment.order.order_id,
        orderToken: payment.order_token,
        resellerSessionToken: sessionToken
      });
      setPayment((current) => current ? { ...current, order: result.order } : current);
      if (result.order.fulfillment_status === "fulfilled") await refresh(sessionToken);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Vérification impossible.");
    }
  };

  const restartPayment = async () => {
    if (!sessionToken || !payment) return;
    try {
      setError(null);
      const result = await abandonPaymentOrder({
        orderId: payment.order.order_id,
        orderToken: payment.order_token,
        resellerSessionToken: sessionToken
      });
      if (!result.abandoned) {
        setPayment((current) => current ? { ...current, order: result.order } : current);
        if (result.order.fulfillment_status === "fulfilled") await refresh(sessionToken);
        return;
      }
      setPayment(null);
      setError("Tentative abandonnée. Vous pouvez lancer un nouveau paiement.");
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Abandon impossible.");
    }
  };

  const exit = async () => {
    await logoutReseller(sessionToken ?? undefined);
    onExit();
  };

  if (isLoading) return <main className="login-page"><p>Chargement de l’espace revendeur…</p></main>;
  if (!overview) {
    return (
      <main className="login-page">
        <Card title="Session revendeur indisponible">
          {error ? <p className="form-error">{error}</p> : null}
          <Button onClick={() => void exit()}>Revenir à l’accueil</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="page-shell page-stack">
      <div className="page-header">
        <div>
          <Badge status="active">Espace revendeur</Badge>
          <h1>{overview.name}</h1>
          <p>{overview.email}</p>
        </div>
        <div className="confirm-dialog__actions">
          <Button icon={RefreshCw} onClick={() => sessionToken && void refresh(sessionToken)} variant="ghost">
            Actualiser
          </Button>
          <Button icon={LogOut} onClick={() => void exit()} variant="danger">
            Déconnexion
          </Button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon={ShoppingCart} label="Crédits achetés" value={String(overview.router_capacity)} hint="Tous les packs" />
        <StatCard icon={Router} label="Crédits consommés" value={String(overview.router_consumed)} hint="Définitivement attribués" />
        <StatCard icon={CreditCard} label="Crédits disponibles" value={String(overview.router_available)} hint="Prêts à vendre" />
        <StatCard icon={Users} label="Sous-clés" value={String(licenses.length)} hint="Tous statuts" />
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="dashboard-grid">
        <Card title="Créer une sous-clé" description="Les crédits attribués sont consommés définitivement.">
          <div className="router-form-grid">
            <label className="form-field">Référence client
              <input value={childForm.label} onChange={(event) => setChildForm({ ...childForm, label: event.target.value })} />
            </label>
            <label className="form-field">Routeurs
              <input min={1} type="number" value={childForm.routerLimit} onChange={(event) => setChildForm({ ...childForm, routerLimit: Number(event.target.value) })} />
            </label>
            <label className="form-field">PC autorisés
              <input min={1} type="number" value={childForm.maxDevices} onChange={(event) => setChildForm({ ...childForm, maxDevices: Number(event.target.value) })} />
            </label>
            <label className="form-field">Durée en jours
              <input min={1} type="number" value={childForm.durationDays} onChange={(event) => setChildForm({ ...childForm, durationDays: Number(event.target.value) })} />
            </label>
          </div>
          <Button disabled={!childForm.label.trim() || childForm.routerLimit > overview.router_available} icon={KeyRound} onClick={() => void createKey()}>
            Générer la sous-clé
          </Button>
          {createdKey ? (
            <div className="form-field">
              <label htmlFor="created-license-key">Clé à transmettre — affichée dans cette session</label>
              <input id="created-license-key" readOnly value={createdKey} />
              <Button onClick={() => void navigator.clipboard.writeText(createdKey)} variant="ghost">Copier</Button>
            </div>
          ) : null}
        </Card>

        <Card title="Acheter un nouveau pack" description="Le paiement confirmé ajoute automatiquement les crédits.">
          <div className="router-form-grid">
            <label className="form-field">Pack
              <select value={paymentForm.planId} onChange={(event) => setPaymentForm({ ...paymentForm, planId: event.target.value })}>
                {resellerPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} — {formatCfa(plan.price_cfa)}</option>)}
              </select>
            </label>
            <label className="form-field">Téléphone Niger
              <input placeholder="22790909090" value={paymentForm.msisdn} onChange={(event) => setPaymentForm({ ...paymentForm, msisdn: event.target.value })} />
            </label>
            <label className="form-field">Moyen de paiement
              <select value={paymentForm.paymentType} onChange={(event) => setPaymentForm({ ...paymentForm, paymentType: event.target.value as IpayPaymentType })}>
                <option value="mobile">Mobile Money (Airtel, Moov, Zamani)</option>
                <option value="nita_online">MyNita</option>
                <option value="amanata">Amanata</option>
              </select>
            </label>
          </div>
          <Button disabled={!paymentForm.planId || !paymentForm.msisdn.trim()} icon={CreditCard} onClick={() => void initiatePayment()}>
            Payer le pack
          </Button>
          {payment ? (
            <div className="page-stack">
              <Badge status={payment.order.fulfillment_status === "fulfilled" ? "active" : "warning"}>
                {payment.order.fulfillment_status === "fulfilled" ? "Crédits ajoutés" : "Paiement en attente"}
              </Badge>
              {payment.payment.meta_data?.code ? <p>Code iPay : <strong>{payment.payment.meta_data.code}</strong></p> : null}
              <div className="confirm-dialog__actions">
                {payment.order.fulfillment_status !== "fulfilled" ? (
                  <Button onClick={() => void restartPayment()} variant="ghost">Abandonner et recommencer</Button>
                ) : null}
                <Button onClick={() => void verifyPayment()} variant="ghost">Vérifier le paiement</Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="Mes sous-clés">
        <div className="data-table">
          <table>
            <thead><tr><th>Client</th><th>Routeurs</th><th>Durée</th><th>Statut</th><th>Expiration</th></tr></thead>
            <tbody>
              {licenses.map((license) => (
                <tr key={license.id}>
                  <td>{license.label || license.plan_name}</td>
                  <td>{license.router_limit}</td>
                  <td>{license.duration_days} jours</td>
                  <td><Badge status={license.status === "active" ? "active" : license.status === "issued" ? "warning" : "error"}>{license.status}</Badge></td>
                  <td>{license.expires_at ? new Date(license.expires_at).toLocaleDateString("fr-FR") : "Pas encore activée"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
