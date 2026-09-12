import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, CreditCard, LogIn, MailCheck, RefreshCw, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { listLicensePlans, type LicensePlan } from "../../services/licensing";
import { abandonPaymentOrder, getPaymentOrderStatus, type InitiatedPaymentOrder, type IpayPaymentType } from "../../services/payments";
import { completeSaasRegistration, registerSaasAndInitiatePayment, registerSaasTrial, resendSaasEmailVerificationCode, startSaasEmailVerification, verifySaasEmail, type SaasEmailVerification } from "../../services/saas";
import { markFirstLaunchCompleted } from "../../services/auth";
import { PaymentMethodPicker } from "../../shared/payment/PaymentMethodPicker";
import { PaymentInstructions } from "../../shared/payment/PaymentInstructions";
import { Badge, Button, Card, PasswordField } from "../../shared/ui";
import { formatCfa, formatPlanDuration } from "../global/subscriptionPageModel";

type RegistrationForm = { organizationName: string; name: string; email: string; password: string; confirmPassword: string; msisdn: string; paymentType: IpayPaymentType; planId: string };
type RegistrationPhase = "details" | "verification" | "activation" | "payment";
const initialForm: RegistrationForm = { organizationName: "", name: "", email: "", password: "", confirmPassword: "", msisdn: "", paymentType: "mobile", planId: "" };

export function SaasFirstLaunchPage({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [phase, setPhase] = useState<RegistrationPhase>("details");
  const [verification, setVerification] = useState<SaasEmailVerification | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [payment, setPayment] = useState<InitiatedPaymentOrder | null>(null);
  const [useFreeTrial, setUseFreeTrial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === form.planId) ?? plans[0] ?? null, [form.planId, plans]);

  useEffect(() => {
    void listLicensePlans().then((catalog) => {
      const organizationPlans = catalog.filter((plan) => !plan.is_reseller);
      setPlans(organizationPlans);
      setForm((current) => ({ ...current, planId: current.planId || organizationPlans.find((plan) => plan.is_recommended)?.id || organizationPlans[0]?.id || "" }));
    }).catch((catalogError) => setError(errorMessage(catalogError, "Impossible de charger les forfaits.")));
  }, []);

  const update = <K extends keyof RegistrationForm>(field: K, value: RegistrationForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const finish = () => { markFirstLaunchCompleted(); onComplete(); navigate("/", { replace: true }); };
  const openLogin = () => { markFirstLaunchCompleted(); onComplete(); navigate("/login", { replace: true }); };

  const startVerification = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    if (!form.organizationName.trim() || !form.name.trim() || !form.email.includes("@")) return setError("Renseignez votre entreprise, votre nom et un email valide.");
    if (form.password.length < 8) return setError("Le mot de passe doit contenir au moins 8 caractères.");
    if (form.password !== form.confirmPassword) return setError("Les mots de passe ne correspondent pas.");
    setIsLoading(true);
    try {
      const started = await startSaasEmailVerification({ organizationName: form.organizationName.trim(), name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password, confirmPassword: form.confirmPassword });
      setVerification(started); setForm((current) => ({ ...current, password: "", confirmPassword: "" })); setPhase(started.verified ? "activation" : "verification");
    } catch (cause) { setError(errorMessage(cause, "Impossible d'envoyer le code de vérification.")); } finally { setIsLoading(false); }
  };
  const confirmEmail = async (event: FormEvent) => {
    event.preventDefault(); if (!verification) return; setError(null); setIsLoading(true);
    try { await verifySaasEmail({ registrationToken: verification.registration_token, verificationCode }); setVerificationCode(""); setPhase("activation"); }
    catch (cause) { setError(errorMessage(cause, "La vérification de votre email a échoué.")); } finally { setIsLoading(false); }
  };
  const resendCode = async () => {
    if (!verification) return; setError(null); setIsLoading(true);
    try { setVerification(await resendSaasEmailVerificationCode(verification.registration_token)); setVerificationCode(""); }
    catch (cause) { setError(errorMessage(cause, "Impossible de renvoyer le code.")); } finally { setIsLoading(false); }
  };
  const activateRegistration = async (event: FormEvent) => {
    event.preventDefault(); if (!verification) return; setError(null);
    if (!useFreeTrial && (!selectedPlan || !form.msisdn.trim())) return setError("Choisissez un forfait et entrez le numéro qui effectuera le paiement.");
    setIsLoading(true);
    try {
      if (useFreeTrial) { await registerSaasTrial({ registrationToken: verification.registration_token }); finish(); return; }
      if (!selectedPlan) throw new Error("Choisissez un forfait.");
      setPayment(await registerSaasAndInitiatePayment({ registrationToken: verification.registration_token, planId: selectedPlan.id, msisdn: form.msisdn, paymentType: form.paymentType }));
      setPhase("payment");
    } catch (cause) { setError(errorMessage(cause, "Préparation du paiement impossible.")); } finally { setIsLoading(false); }
  };
  const confirmPayment = async () => {
    if (!payment) return; setIsLoading(true); setError(null);
    try {
      const status = await getPaymentOrderStatus({ orderId: payment.order.order_id, orderToken: payment.order_token });
      if (status.order.status === "pending") return setError("Le paiement est encore en attente. Validez-le sur votre téléphone puis réessayez.");
      if (status.order.status !== "succeeded" || status.order.fulfillment_status !== "fulfilled") return setError(status.order.failure_reason ?? "Le paiement n'a pas été validé.");
      await completeSaasRegistration({ orderId: payment.order.order_id, orderToken: payment.order_token }); finish();
    } catch (cause) { setError(errorMessage(cause, "Vérification du paiement impossible.")); } finally { setIsLoading(false); }
  };
  const restartPayment = async () => {
    if (!payment) return; setIsLoading(true); setError(null);
    try { const result = await abandonPaymentOrder({ orderId: payment.order.order_id, orderToken: payment.order_token }); if (!result.abandoned && result.order.status === "succeeded") { await confirmPayment(); return; } setPayment(null); setPhase("activation"); }
    catch (cause) { setError(errorMessage(cause, "Impossible de relancer le paiement.")); } finally { setIsLoading(false); }
  };
  const title = phase === "verification" ? "Vérifiez votre email" : phase === "activation" ? "Choisissez votre démarrage" : phase === "payment" ? "Terminez votre paiement" : "Créez votre espace TicketPro";

  return <main className="login-page"><section className="profile-choice-panel" aria-labelledby="saas-registration-title"><Card>
    <div className="login-panel__header"><p className="login-panel__brand">TicketPro par Akicorp Solutions</p><Badge status="active">{phase === "payment" ? "Paiement" : `Étape ${phase === "details" ? "1" : phase === "verification" ? "2" : "3"} sur 3`}</Badge><h1 className="login-panel__title" id="saas-registration-title">{title}</h1><p className="login-panel__text">{phase === "verification" ? `Saisissez le code à 6 chiffres envoyé à ${verification?.email ?? "votre adresse email"}.` : phase === "activation" ? "Votre adresse email est vérifiée. Démarrez votre essai ou choisissez un forfait." : phase === "payment" ? "Validez la demande sur votre téléphone, puis confirmez ci-dessous." : "Vérifiez votre email avant d'activer votre essai ou de payer un forfait."}</p></div>
    {phase === "details" ? <form className="first-launch-form" onSubmit={startVerification} noValidate>
      <div className="form-grid">
        <label className="form-field" htmlFor="saas-organization-name">Nom de l'entreprise <span aria-hidden="true">*</span><input id="saas-organization-name" autoComplete="organization" required value={form.organizationName} onChange={(event) => update("organizationName", event.target.value)} /></label>
        <label className="form-field" htmlFor="saas-owner-name">Votre nom <span aria-hidden="true">*</span><input id="saas-owner-name" autoComplete="name" required value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label className="form-field" htmlFor="saas-email">Email <span aria-hidden="true">*</span><input id="saas-email" autoComplete="email" required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
        <PasswordField label="Mot de passe (8 caractères minimum)" name="password" onChange={(value) => update("password", value)} value={form.password} /><PasswordField label="Confirmer le mot de passe" name="confirm-password" onChange={(value) => update("confirmPassword", value)} value={form.confirmPassword} />
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="confirm-dialog__actions"><Button icon={LogIn} onClick={openLogin} type="button" variant="ghost">J'ai déjà un compte</Button><Button disabled={isLoading} icon={MailCheck} type="submit" variant="primary">{isLoading ? "Envoi du code…" : "Vérifier mon email"}</Button></div>
    </form> : null}
    {phase === "verification" ? <form className="first-launch-form" onSubmit={confirmEmail} noValidate><label className="form-field" htmlFor="saas-verification-code">Code de vérification <span aria-hidden="true">*</span><input id="saas-verification-code" aria-describedby="saas-verification-code-hint" autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label><p id="saas-verification-code-hint" className="form-field__hint">Le code expire dans 10 minutes. Vérifiez vos courriers indésirables si nécessaire.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<p role="status" aria-live="polite">Un nouveau code peut être demandé après une minute. Chaque nouveau code rend le précédent inutilisable.</p><div className="confirm-dialog__actions"><Button disabled={isLoading} icon={RefreshCw} onClick={resendCode} type="button" variant="ghost">Renvoyer le code</Button><Button disabled={isLoading} icon={CheckCircle2} type="submit" variant="primary">{isLoading ? "Vérification…" : "Confirmer mon email"}</Button></div></form> : null}
    {phase === "activation" ? <form className="first-launch-form" onSubmit={activateRegistration} noValidate><div className="form-grid"><label className="toggle-option"><input checked={useFreeTrial} onChange={(event) => setUseFreeTrial(event.target.checked)} type="checkbox" /><span>Profiter de mon essai gratuit de 7 jours — 1 routeur</span></label>{!useFreeTrial ? <><label className="form-field" htmlFor="saas-plan">Forfait <span aria-hidden="true">*</span><select id="saas-plan" required value={form.planId} onChange={(event) => update("planId", event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} — {formatPlanDuration(plan.duration_days)} — {plan.router_limit} routeur(s) — {formatDeviceLimit(plan)} — {formatCfa(plan.price_cfa)}</option>)}</select></label><label className="form-field" htmlFor="saas-msisdn">Numéro de paiement <span aria-hidden="true">*</span><input id="saas-msisdn" inputMode="tel" required placeholder="90 90 90 90" value={form.msisdn} onChange={(event) => update("msisdn", event.target.value)} /></label></> : null}</div>{!useFreeTrial && selectedPlan ? <><div className="subscription-selection-summary" aria-live="polite"><div><span>Forfait choisi</span><strong>{selectedPlan.name}</strong></div><div><span>Durée</span><strong>{formatPlanDuration(selectedPlan.duration_days)}</strong></div><div><span>Capacité</span><strong>{selectedPlan.router_limit} routeur(s)</strong></div><div><span>Montant</span><strong>{formatCfa(selectedPlan.price_cfa)}</strong></div></div><PaymentMethodPicker onChange={(paymentType) => update("paymentType", paymentType)} value={form.paymentType} /></> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="confirm-dialog__actions"><Button disabled={isLoading || (!useFreeTrial && plans.length === 0)} icon={UserPlus} type="submit" variant="primary">{isLoading ? "Préparation…" : useFreeTrial ? "Démarrer mon essai gratuit" : "Créer et payer"}</Button></div></form> : null}
    {phase === "payment" && payment ? <div className="first-launch-form"><div className="auth-note"><CreditCard aria-hidden="true" size={20} /><p>{payment.order.plan.name} — {formatPlanDuration(payment.order.plan.duration_days)} — {formatCfa(payment.order.amount)}{payment.payment.meta_data?.code ? ` — Code : ${payment.payment.meta_data.code}` : ""}</p></div><PaymentInstructions amountLabel={formatCfa(payment.order.amount)} method={payment.order.payment_type} reference={payment.payment.public_reference || payment.order.transaction_id} />{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="confirm-dialog__actions"><Button disabled={isLoading} icon={RefreshCw} onClick={restartPayment} type="button" variant="ghost">Annuler et recommencer</Button><Button disabled={isLoading} icon={CheckCircle2} onClick={confirmPayment} type="button" variant="primary">{isLoading ? "Vérification…" : "J'ai validé le paiement"}</Button></div></div> : null}
  </Card></section></main>;
}

function errorMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
function formatDeviceLimit(plan: LicensePlan): string { return plan.device_limit_mode === "unlimited" || plan.max_devices === null ? "Appareils illimités" : `${plan.max_devices} appareil(s)`; }
