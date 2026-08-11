import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, CreditCard, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/auth/AuthProvider";
import { listLicensePlans, type LicensePlan } from "../../services/licensing";
import {
  abandonPaymentOrder,
  getPaymentOrderStatus,
  type InitiatedPaymentOrder,
  type IpayPaymentType
} from "../../services/payments";
import {
  completeSaasRegistration,
  registerSaasAndInitiatePayment,
  registerSaasTrial
} from "../../services/saas";
import { markFirstLaunchCompleted } from "../../services/auth";
import { PaymentMethodPicker } from "../../shared/payment/PaymentMethodPicker";
import { Badge, Button, Card, PasswordField } from "../../shared/ui";
import { formatCfa, formatPlanDuration } from "../global/subscriptionPageModel";

type RegistrationForm = {
  organizationName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  msisdn: string;
  paymentType: IpayPaymentType;
  planId: string;
};

const initialForm: RegistrationForm = {
  organizationName: "",
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  msisdn: "",
  paymentType: "mobile",
  planId: ""
};

export function SaasFirstLaunchPage({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate();
  const { loginAccount } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [payment, setPayment] = useState<InitiatedPaymentOrder | null>(null);
  const [useFreeTrial, setUseFreeTrial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) ?? plans[0] ?? null,
    [form.planId, plans]
  );

  useEffect(() => {
    void listLicensePlans()
      .then((catalog) => {
        const organizationPlans = catalog.filter((plan) => !plan.is_reseller);
        setPlans(organizationPlans);
        setForm((current) => ({
          ...current,
          planId: current.planId || organizationPlans.find((plan) => plan.is_recommended)?.id
            || organizationPlans[0]?.id
            || ""
        }));
      })
      .catch((catalogError) => {
        setError(errorMessage(catalogError, "Impossible de charger les forfaits."));
      });
  }, []);

  const update = <K extends keyof RegistrationForm>(field: K, value: RegistrationForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const startRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.organizationName.trim() || !form.name.trim() || !form.email.includes("@")) {
      setError("Renseignez votre entreprise, votre nom et un email valide.");
      return;
    }
    if (form.password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (!useFreeTrial && (!selectedPlan || !form.msisdn.trim())) {
      setError("Choisissez un forfait et entrez le numéro qui effectuera le paiement.");
      return;
    }
    setIsLoading(true);
    try {
      if (useFreeTrial) {
        await registerSaasTrial({
          organizationName: form.organizationName.trim(),
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          confirmPassword: form.confirmPassword
        });
        const login = await loginAccount(form.email, form.password);
        if (!login.ok) throw new Error(login.message ?? "Connexion automatique impossible.");
        markFirstLaunchCompleted();
        onComplete();
        navigate("/", { replace: true });
        return;
      }
      if (!selectedPlan) throw new Error("Choisissez un forfait.");
      const initiated = await registerSaasAndInitiatePayment({
        organizationName: form.organizationName.trim(),
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        confirmPassword: form.confirmPassword,
        planId: selectedPlan.id,
        msisdn: form.msisdn,
        paymentType: form.paymentType
      });
      setPayment(initiated);
    } catch (registrationError) {
      setError(errorMessage(registrationError, "Inscription impossible."));
    } finally {
      setIsLoading(false);
    }
  };

  const confirmPayment = async () => {
    if (!payment) return;
    setIsLoading(true);
    setError(null);
    try {
      const status = await getPaymentOrderStatus({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      if (status.order.status === "pending") {
        setError("Le paiement est encore en attente. Validez-le sur votre téléphone puis réessayez.");
        return;
      }
      if (status.order.status !== "succeeded" || status.order.fulfillment_status !== "fulfilled") {
        setError(status.order.failure_reason ?? "Le paiement n'a pas été validé.");
        return;
      }
      await completeSaasRegistration({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      const login = await loginAccount(form.email, form.password);
      if (!login.ok) throw new Error(login.message ?? "Connexion automatique impossible.");
      markFirstLaunchCompleted();
      onComplete();
      navigate("/", { replace: true });
    } catch (paymentError) {
      setError(errorMessage(paymentError, "Vérification du paiement impossible."));
    } finally {
      setIsLoading(false);
    }
  };

  const restartPayment = async () => {
    if (!payment) return;
    setIsLoading(true);
    setError(null);
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
    } catch (abandonError) {
      setError(errorMessage(abandonError, "Impossible de relancer le paiement."));
    } finally {
      setIsLoading(false);
    }
  };

  const openLogin = () => {
    markFirstLaunchCompleted();
    onComplete();
    navigate("/login", { replace: true });
  };

  return (
    <main className="login-page">
      <section className="profile-choice-panel" aria-labelledby="saas-registration-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <Badge status="active">{payment ? "Paiement" : "Création du compte"}</Badge>
            <h1 className="login-panel__title" id="saas-registration-title">
              {payment ? "Terminez votre paiement" : "Créez votre espace TicketPro"}
            </h1>
            <p className="login-panel__text">
              {payment
                ? "Validez la demande sur votre téléphone, puis confirmez ci-dessous."
                : "Un compte, un forfait, puis vous accédez directement à vos routeurs."}
            </p>
          </div>

          {!payment ? (
            <form className="first-launch-form" onSubmit={startRegistration}>
              <div className="form-grid">
                <label className="form-field">
                  Nom de l'entreprise
                  <input
                    autoFocus
                    onChange={(event) => update("organizationName", event.target.value)}
                    value={form.organizationName}
                  />
                </label>
                <label className="form-field">
                  Votre nom
                  <input onChange={(event) => update("name", event.target.value)} value={form.name} />
                </label>
                <label className="form-field">
                  Email
                  <input
                    autoComplete="email"
                    onChange={(event) => update("email", event.target.value)}
                    type="email"
                    value={form.email}
                  />
                </label>
                {!useFreeTrial ? (
                  <label className="form-field">
                    Numéro de paiement
                    <input
                      inputMode="tel"
                      onChange={(event) => update("msisdn", event.target.value)}
                      placeholder="90 90 90 90"
                      value={form.msisdn}
                    />
                  </label>
                ) : null}
                <PasswordField
                  label="Mot de passe (8 caractères minimum)"
                  name="password"
                  onChange={(value) => update("password", value)}
                  value={form.password}
                />
                <PasswordField
                  label="Confirmer le mot de passe"
                  name="confirm-password"
                  onChange={(value) => update("confirmPassword", value)}
                  value={form.confirmPassword}
                />
                <label className="toggle-option">
                  <input
                    checked={useFreeTrial}
                    onChange={(event) => setUseFreeTrial(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Profiter de mon essai gratuit de 7 jours — 1 routeur</span>
                </label>
                {!useFreeTrial ? (
                  <>
                    <label className="form-field">
                      Forfait
                      <select onChange={(event) => update("planId", event.target.value)} value={form.planId}>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} — {formatPlanDuration(plan.duration_days)} — {plan.router_limit} routeur(s) —{" "}
                            {formatDeviceLimit(plan)} — {formatCfa(plan.price_cfa)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      Moyen de paiement
                      <select
                        onChange={(event) => update("paymentType", event.target.value as IpayPaymentType)}
                        value={form.paymentType}
                      >
                        <option value="mobile">Mobile Money (Airtel, Moov, Zamani)</option>
                        <option value="nita_online">Nita</option>
                        <option value="amanata">Amana</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
              {!useFreeTrial && selectedPlan ? (
                <>
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
                  <PaymentMethodPicker
                    onChange={(paymentType) => update("paymentType", paymentType)}
                    value={form.paymentType}
                  />
                </>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              <div className="confirm-dialog__actions">
                <Button icon={LogIn} onClick={openLogin} type="button" variant="ghost">
                  J'ai déjà un compte
                </Button>
                <Button
                  disabled={isLoading || (!useFreeTrial && plans.length === 0)}
                  icon={UserPlus}
                  type="submit"
                  variant="primary"
                >
                  {isLoading
                    ? "Préparation…"
                    : useFreeTrial
                      ? "Démarrer mon essai gratuit"
                      : "Créer et payer"}
                </Button>
              </div>
            </form>
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
              {error ? <p className="form-error">{error}</p> : null}
              <div className="confirm-dialog__actions">
                <Button disabled={isLoading} icon={RefreshCw} onClick={restartPayment} type="button" variant="ghost">
                  Annuler et recommencer
                </Button>
                <Button disabled={isLoading} icon={CheckCircle2} onClick={confirmPayment} type="button" variant="primary">
                  {isLoading ? "Vérification…" : "J'ai validé le paiement"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDeviceLimit(plan: LicensePlan): string {
  return plan.device_limit_mode === "unlimited" || plan.max_devices === null
    ? "Appareils illimités"
    : `${plan.max_devices} appareil(s)`;
}
