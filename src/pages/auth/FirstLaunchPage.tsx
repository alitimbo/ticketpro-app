import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isProductionRuntime } from "../../config/runtime";
import { Building2, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, KeyRound, Laptop, LogIn, Router, ShieldCheck, ShoppingCart, Store, UserRound } from "lucide-react";
import { Badge, Button, Card, FilterButton, PasswordField, StatCard } from "../../shared/ui";
import { formatCfa, subscriptionPlans } from "../global/subscriptionPageModel";
import { useAppDatabase } from "../../services/database";
import { LicenseStateRepository } from "../../services/database";
import {
  activateLicense,
  getLicenseDeviceIdentity,
  isLicenseApiConfigured,
  listLicensePlans,
  protectLicenseToken,
  unprotectLicenseToken,
  type LicenseActivationResult,
  type LicensePlan
} from "../../services/licensing";
import {
  abandonPaymentOrder,
  getPaymentOrderStatus,
  initiateOrganizationPayment,
  type InitiatedPaymentOrder,
  type IpayPaymentType,
  type PaymentOrder
} from "../../services/payments";
import {
  changeResellerPassword,
  loginReseller,
  registerResellerAndInitiatePayment,
  resetResellerPassword,
  type ResellerLoginResult
} from "../../services/reseller";
import {
  completeFirstLaunch,
  defaultFirstLaunchState,
  firstLaunchSteps,
  validateFirstLaunchStep,
  type FirstLaunchState,
  type FirstLaunchStep,
  type FirstLaunchSummary,
  type FirstLaunchLicenseDetails
} from "./firstLaunchModel";

const stepTitles: Record<FirstLaunchStep, string> = {
  1: "Compte principal",
  2: "Licence",
  3: "Profils internes",
  4: "Résumé"
};

type FirstLaunchJourney = "organization_purchase" | "activation_key" | "reseller";
const pendingPaymentStorageKey = "ticketpro:pending_organization_payment";
const pendingResellerPaymentStorageKey = "ticketpro:pending_reseller_registration";

export function FirstLaunchPage({
  onComplete,
  onResellerAccess
}: {
  onComplete?: () => void;
  onResellerAccess?: () => void;
}) {
  const { database, initializationError, isInitialized, isPersistent } = useAppDatabase();
  const navigate = useNavigate();
  const [state, setState] = useState<FirstLaunchState>(defaultFirstLaunchState);
  const [journey, setJourney] = useState<FirstLaunchJourney | null>(null);
  const [step, setStep] = useState<FirstLaunchStep>(1);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FirstLaunchSummary | null>(null);
  const [activation, setActivation] = useState<LicenseActivationResult | null>(null);
  const [catalogPlans, setCatalogPlans] = useState<LicensePlan[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [payment, setPayment] = useState<InitiatedPaymentOrder | null>(null);
  const [paymentMsisdn, setPaymentMsisdn] = useState("");
  const [paymentType, setPaymentType] = useState<IpayPaymentType>("mobile");
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const shouldActivate = isProductionRuntime || isLicenseApiConfigured();
  const selectedPlan = useMemo(
    () => activation?.plan ?? subscriptionPlans.find((plan) => plan.id === state.selectedPlanId) ?? subscriptionPlans[0],
    [activation, state.selectedPlanId]
  );
  const organizationPlans = useMemo(() => catalogPlans.filter((plan) => !plan.is_reseller), [catalogPlans]);

  useEffect(() => {
    if (!isLicenseApiConfigured()) {
      setCatalogPlans(subscriptionPlans.map(localPlanToLicensePlan));
      return;
    }

    let mounted = true;
    setIsCatalogLoading(true);
    void listLicensePlans()
      .then((plans) => {
        if (mounted) setCatalogPlans(plans);
      })
      .catch((catalogError) => {
        if (mounted) {
          setError(catalogError instanceof Error ? catalogError.message : "Catalogue indisponible.");
        }
      })
      .finally(() => {
        if (mounted) setIsCatalogLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const updateState = (partial: Partial<FirstLaunchState>) => {
    setError(null);
    setState((current) => ({ ...current, ...partial }));
  };

  const goNext = () => {
    const validationError = validateFirstLaunchStep(step, state);

    if (validationError) {
      setError(validationError);
      return;
    }
    if (step === 2 && shouldActivate && !activation) {
      setError("Vérifiez votre clé d'activation avant de continuer.");
      return;
    }

    setStep((current) => Math.min(4, current + 1) as FirstLaunchStep);
  };

  const goBack = () => {
    setError(null);
    setStep((current) => Math.max(1, current - 1) as FirstLaunchStep);
  };

  const verifyActivationKey = async () => {
    if (!state.activationKey.trim()) {
      setError("Saisissez votre clé d'activation TicketPro.");
      return;
    }

    try {
      setIsVerifying(true);
      setError(null);
      const verified = await activateLicense({
        accountId: `account-${state.account.email.trim().toLowerCase()}`,
        key: state.activationKey
      });
      setActivation(verified);
      setState((current) => ({
        ...current,
        selectedPlanId: verified.plan.id,
        subscriptionStatus: "active_manual"
      }));
    } catch (activationError) {
      setActivation(null);
      setError(activationError instanceof Error ? activationError.message : "Clé d'activation invalide.");
    } finally {
      setIsVerifying(false);
    }
  };

  const applyPaidOrder = async (paidOrder: PaymentOrder) => {
    if (paidOrder.fulfillment_status !== "fulfilled" || !paidOrder.license_key) {
      setError(
        paidOrder.status === "failed"
          ? paidOrder.failure_reason ?? "Le paiement a échoué."
          : "Le paiement est encore en attente de confirmation."
      );
      return;
    }
    const verified = await activateLicense({
      accountId: `account-${state.account.email.trim().toLowerCase()}`,
      key: paidOrder.license_key
    });
    setActivation(verified);
    setState((current) => ({
      ...current,
      activationKey: paidOrder.license_key ?? "",
      selectedPlanId: verified.plan.id,
      subscriptionStatus: "active_manual"
    }));
    localStorage.removeItem(pendingPaymentStorageKey);
    setError(null);
  };

  const initiatePayment = async () => {
    try {
      setIsPaymentLoading(true);
      setError(null);
      const initiated = await initiateOrganizationPayment({
        customerName: state.account.companyName,
        msisdn: paymentMsisdn,
        paymentType,
        planId: state.selectedPlanId
      });
      setPayment(initiated);
      localStorage.setItem(
        pendingPaymentStorageKey,
        JSON.stringify({
          accountEmail: state.account.email.trim().toLowerCase(),
          orderId: initiated.order.order_id,
          orderToken: await protectLicenseToken(initiated.order_token)
        })
      );
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Paiement impossible.");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const verifyPayment = async () => {
    if (!payment) return;
    try {
      setIsPaymentLoading(true);
      setError(null);
      const result = await getPaymentOrderStatus({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      setPayment((current) => (current ? { ...current, order: result.order } : current));
      await applyPaidOrder(result.order);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Vérification du paiement impossible.");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const restartPayment = async () => {
    if (!payment) return;
    try {
      setIsPaymentLoading(true);
      setError(null);
      const result = await abandonPaymentOrder({
        orderId: payment.order.order_id,
        orderToken: payment.order_token
      });
      if (!result.abandoned) {
        setPayment((current) => (current ? { ...current, order: result.order } : current));
        await applyPaidOrder(result.order);
        return;
      }
      localStorage.removeItem(pendingPaymentStorageKey);
      setPayment(null);
      setActivation(null);
      setError("Tentative abandonnée. Vous pouvez lancer un nouveau paiement.");
    } catch (paymentError) {
      setError(errorMessage(paymentError, "Impossible d'abandonner cette tentative."));
    } finally {
      setIsPaymentLoading(false);
    }
  };

  useEffect(() => {
    if (journey !== "organization_purchase" || payment || !state.account.email.trim()) return;
    const stored = localStorage.getItem(pendingPaymentStorageKey);
    if (!stored) return;
    let cancelled = false;
    void (async () => {
      try {
        const parsed = JSON.parse(stored) as { accountEmail: string; orderId: string; orderToken: string };
        if (parsed.accountEmail !== state.account.email.trim().toLowerCase()) return;
        const orderToken = await unprotectLicenseToken(parsed.orderToken);
        const result = await getPaymentOrderStatus({ orderId: parsed.orderId, orderToken });
        if (cancelled) return;
        setPayment({
          order: result.order,
          order_token: orderToken,
          payment: {
            meta_data: null,
            public_reference: result.order.provider_public_reference ?? "",
            reference: ""
          }
        });
        await applyPaidOrder(result.order);
      } catch {
        localStorage.removeItem(pendingPaymentStorageKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journey, payment, state.account.email]);

  const finish = async () => {
    try {
      if (isPersistent && !isInitialized) {
        throw new Error(
          initializationError
            ? `La base locale n'a pas pu être initialisée : ${initializationError}`
            : "La base locale est encore en cours d'initialisation."
        );
      }
      let stateForCompletion = state;
      if (shouldActivate) {
        if (!activation) {
          throw new Error("Vérifiez votre clé d'activation avant de terminer.");
        }
        stateForCompletion = {
          ...state,
          selectedPlanId: activation.plan.id,
          subscriptionStatus: "active_manual"
        };
      }
      const licenseDetails: FirstLaunchLicenseDetails | undefined = activation
        ? {
            billingPeriod: activation.plan.billing_period,
            description: activation.plan.description,
            durationDays: activation.duration_days,
            maxDevices: activation.max_devices,
            planCode: activation.plan.code,
            planId: activation.plan.id,
            planName: activation.plan.name,
            priceCfa: activation.plan.price_cfa,
            routerLimit: activation.router_limit
          }
        : undefined;
      if (activation && isPersistent) {
        const identity = await getLicenseDeviceIdentity();
        await new LicenseStateRepository(database).save({
          account_id: `account-${state.account.email.trim().toLowerCase()}`,
          activation_id: activation.activation_id,
          activation_token_encrypted: await protectLicenseToken(activation.activation_token),
          billing_period: activation.plan.billing_period,
          device_count: activation.device_count,
          device_id: identity.device_id,
          duration_days: activation.duration_days,
          expires_at: activation.expires_at,
          id: "current",
          install_id: identity.install_id,
          last_validated_at: new Date().toISOString(),
          license_id: activation.license_id,
          max_devices: activation.max_devices,
          plan_code: activation.plan.code,
          plan_description: activation.plan.description,
          plan_id: activation.plan.id,
          plan_name: activation.plan.name,
          price_cfa: activation.plan.price_cfa,
          router_count: activation.router_count,
          router_limit: activation.router_limit,
          status: activation.status
        });
      }
      const completed = await completeFirstLaunch(
        stateForCompletion,
        isPersistent ? database : undefined,
        licenseDetails
      );
      setSummary(completed);
      setError(null);
      onComplete?.();
      navigate("/login", { replace: true });
    } catch (completionError) {
      setError(errorMessage(completionError, "Configuration impossible."));
    }
  };

  if (!journey) {
    return <JourneyChooser onSelect={setJourney} />;
  }

  if (journey === "reseller") {
    return (
      <ResellerAccessStep
        onBack={() => setJourney(null)}
        onSuccess={() => {
          onResellerAccess?.();
          navigate("/revendeur", { replace: true });
        }}
      />
    );
  }

  return (
    <main className="login-page">
      <section className="profile-choice-panel" aria-labelledby="first-launch-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <Badge status="warning">Premier lancement</Badge>
            <h1 className="login-panel__title" id="first-launch-title">
              Configuration initiale
            </h1>
            <p className="login-panel__text">
              {journey === "organization_purchase"
                ? "Créez votre compte, payez votre pack et laissez TicketPro activer automatiquement la licence."
                : "Créez le compte principal, activez votre clé et protégez au moins le profil Admin."}
            </p>
          </div>

          <div className="filter-row">
            {firstLaunchSteps.map((item) => (
              <FilterButton active={item === step} key={item} onClick={() => setStep(item)}>
                {item}. {stepTitles[item]}
              </FilterButton>
            ))}
          </div>

          {step === 1 ? <AccountStep state={state} onChange={updateState} /> : null}
          {step === 2 ? (
            journey === "organization_purchase" ? (
              <OrganizationPaymentStep
                activation={activation}
                isLoading={isPaymentLoading}
                msisdn={paymentMsisdn}
                onInitiate={() => void initiatePayment()}
                onMsisdnChange={setPaymentMsisdn}
                onPaymentTypeChange={setPaymentType}
                onPlanChange={(selectedPlanId) => updateState({ selectedPlanId })}
                onRestart={() => void restartPayment()}
                onVerify={() => void verifyPayment()}
                payment={payment}
                paymentType={paymentType}
                plans={organizationPlans}
                selectedPlanId={state.selectedPlanId}
              />
            ) : (
              <PackStep
                activation={activation}
                isCatalogLoading={isCatalogLoading}
                isVerifying={isVerifying}
                onChange={(partial) => {
                  setActivation(null);
                  updateState(partial);
                }}
                onVerify={() => void verifyActivationKey()}
                plans={organizationPlans}
                state={state}
              />
            )
          ) : null}
          {step === 3 ? <ProfilesStep state={state} onChange={updateState} /> : null}
          {step === 4 ? (
            <SummaryStep
              paymentConfirmed={journey === "organization_purchase" && Boolean(activation)}
              selectedPlanName={selectedPlan.name}
              state={state}
              summary={summary}
            />
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <div className="confirm-dialog__actions">
            {step === 1 ? (
              <Button icon={ChevronLeft} onClick={() => setJourney(null)} variant="ghost">
                Changer de parcours
              </Button>
            ) : null}
            {step > 1 ? (
              <Button icon={ChevronLeft} onClick={goBack} variant="ghost">
                Retour
              </Button>
            ) : null}
            {step < 4 ? (
              <Button icon={ChevronRight} onClick={goNext} variant="primary">
                Continuer
              </Button>
            ) : (
              <Button icon={CheckCircle2} onClick={() => void finish()} variant="primary">
                Terminer la configuration
              </Button>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}

function JourneyChooser({ onSelect }: { onSelect: (journey: FirstLaunchJourney) => void }) {
  return (
    <main className="login-page">
      <section className="profile-choice-panel first-launch-choice" aria-labelledby="journey-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <Badge status="warning">Bienvenue</Badge>
            <h1 className="login-panel__title" id="journey-title">Comment souhaitez-vous commencer ?</h1>
            <p className="login-panel__text">
              Une seule application, avec un espace adapté automatiquement à votre activité.
            </p>
          </div>
          <div className="first-launch-journeys">
            <button className="first-launch-journey" onClick={() => onSelect("organization_purchase")} type="button">
              <ShoppingCart size={28} />
              <strong>Acheter un pack pour mon réseau</strong>
              <span>Paiement iPay puis activation automatique sur cet ordinateur.</span>
            </button>
            <button className="first-launch-journey" onClick={() => onSelect("activation_key")} type="button">
              <KeyRound size={28} />
              <strong>Activer une clé déjà reçue</strong>
              <span>Pour une clé achetée auprès de TicketPro ou d’un revendeur.</span>
            </button>
            <button className="first-launch-journey" onClick={() => onSelect("reseller")} type="button">
              <Store size={28} />
              <strong>Accéder à mon espace revendeur</strong>
              <span>Consulter les crédits, acheter un pack et créer des sous-clés.</span>
            </button>
          </div>
        </Card>
      </section>
    </main>
  );
}

function OrganizationPaymentStep({
  activation,
  isLoading,
  msisdn,
  onInitiate,
  onMsisdnChange,
  onPaymentTypeChange,
  onPlanChange,
  onRestart,
  onVerify,
  payment,
  paymentType,
  plans,
  selectedPlanId
}: {
  activation: LicenseActivationResult | null;
  isLoading: boolean;
  msisdn: string;
  onInitiate: () => void;
  onMsisdnChange: (value: string) => void;
  onPaymentTypeChange: (value: IpayPaymentType) => void;
  onPlanChange: (planId: string) => void;
  onRestart: () => void;
  onVerify: () => void;
  payment: InitiatedPaymentOrder | null;
  paymentType: IpayPaymentType;
  plans: LicensePlan[];
  selectedPlanId: string;
}) {
  return (
    <div className="page-stack">
      <Card title="Choisissez votre pack organisation">
        <div className="subscription-plan-grid">
          {plans.map((plan) => (
            <button
              className={
                plan.id === selectedPlanId
                  ? "subscription-plan-card subscription-plan-card--current"
                  : "subscription-plan-card"
              }
              key={plan.id}
              onClick={() => onPlanChange(plan.id)}
              type="button"
            >
              <div>
                <strong>{plan.name}</strong>
                <span>{plan.router_limit} routeur(s) · {plan.max_devices} PC</span>
              </div>
              <p>{plan.description}</p>
              <Badge status={plan.id === selectedPlanId ? "active" : "success"}>
                {formatCfa(plan.price_cfa)} / {billingPeriodLabel(plan.billing_period)}
              </Badge>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Paiement iPay Niger" description="Le montant et le forfait sont vérifiés par notre VPS.">
        <div className="router-form-grid">
          <label className="form-field">
            Numéro de paiement
            <input
              inputMode="tel"
              onChange={(event) => onMsisdnChange(event.target.value)}
              placeholder="22790909090"
              value={msisdn}
            />
            <small>Format Niger : 227 suivi des 8 chiffres du numéro.</small>
          </label>
          <label className="form-field">
            Moyen de paiement
            <select
              onChange={(event) => onPaymentTypeChange(event.target.value as IpayPaymentType)}
              value={paymentType}
            >
              <option value="mobile">Orange / Moov / Zamani</option>
              <option value="nita_online">Nita</option>
              <option value="amanata">Amana</option>
            </select>
          </label>
        </div>
        {!payment ? (
          <Button
            disabled={isLoading || !msisdn.trim() || !selectedPlanId}
            icon={CreditCard}
            onClick={onInitiate}
            variant="primary"
          >
            {isLoading ? "Initialisation…" : "Procéder au paiement"}
          </Button>
        ) : (
          <div className="page-stack">
            <div className="stats-grid">
              <StatCard icon={CreditCard} label="Référence" value={payment.payment.public_reference || payment.order.transaction_id} hint={`${formatCfa(payment.order.amount)} · ${payment.order.payment_type}`} />
              <StatCard icon={ShieldCheck} label="Statut" value={payment.order.status} hint={payment.order.fulfillment_status} />
            </div>
            {payment.payment.meta_data?.code ? (
              <p className="payment-code">Code de validation iPay : <strong>{payment.payment.meta_data.code}</strong></p>
            ) : null}
            <div className="confirm-dialog__actions">
              {!activation ? (
                <Button disabled={isLoading} onClick={onRestart} variant="ghost">
                  Abandonner et recommencer
                </Button>
              ) : null}
              <Button disabled={isLoading || Boolean(activation)} icon={CheckCircle2} onClick={onVerify} variant="primary">
                {isLoading ? "Vérification…" : activation ? "Licence activée" : "J’ai validé — vérifier le paiement"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {activation ? (
        <Card title="Paiement confirmé et licence activée">
          <div className="stats-grid">
            <StatCard icon={CreditCard} label="Forfait" value={activation.plan.name} hint={activation.plan.code} />
            <StatCard icon={Router} label="Routeurs" value={String(activation.router_limit)} hint="Quota autorisé" />
            <StatCard icon={Laptop} label="PC" value={String(activation.max_devices)} hint="Appareils autorisés" />
            <StatCard icon={ShieldCheck} label="Durée" value={`${activation.duration_days} jours`} hint="Démarrée aujourd’hui" />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function ResellerAccessStep({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginResult, setLoginResult] = useState<ResellerLoginResult | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [name, setName] = useState("");
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [paymentType, setPaymentType] = useState<IpayPaymentType>("mobile");
  const [registrationPayment, setRegistrationPayment] = useState<InitiatedPaymentOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (mode !== "register" || plans.length > 0) return;
    void listLicensePlans()
      .then((catalog) => {
        const resellerPlans = catalog.filter((plan) => plan.is_reseller);
        setPlans(resellerPlans);
        setPlanId(resellerPlans[0]?.id ?? "");
      })
      .catch((catalogError) => {
        setError(catalogError instanceof Error ? catalogError.message : "Forfaits indisponibles.");
      });
  }, [mode, plans.length]);

  useEffect(() => {
    const stored = localStorage.getItem(pendingResellerPaymentStorageKey);
    if (!stored || registrationPayment) return;
    let cancelled = false;
    void (async () => {
      try {
        const parsed = JSON.parse(stored) as { email: string; orderId: string; orderToken: string };
        const orderToken = await unprotectLicenseToken(parsed.orderToken);
        const result = await getPaymentOrderStatus({ orderId: parsed.orderId, orderToken });
        if (cancelled) return;
        setMode("register");
        setEmail(parsed.email);
        setRegistrationPayment({
          order: result.order,
          order_token: orderToken,
          payment: {
            meta_data: null,
            public_reference: result.order.provider_public_reference ?? "",
            reference: ""
          }
        });
      } catch {
        localStorage.removeItem(pendingResellerPaymentStorageKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [registrationPayment]);

  const login = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await loginReseller(email, password);
      setLoginResult(result);
      if (!result.reseller.must_change_password) onSuccess();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Connexion impossible.");
    } finally {
      setIsLoading(false);
    }
  };

  const changePassword = async () => {
    if (!loginResult) return;
    if (newPassword !== confirmPassword) {
      setError("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      await changeResellerPassword(loginResult.session_token, password, newPassword);
      onSuccess();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Changement impossible.");
    } finally {
      setIsLoading(false);
    }
  };

  const register = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const initiated = await registerResellerAndInitiatePayment({
        confirmPassword,
        email,
        msisdn,
        name,
        password,
        paymentType,
        planId
      });
      setRegistrationPayment(initiated);
      localStorage.setItem(
        pendingResellerPaymentStorageKey,
        JSON.stringify({
          email: email.trim().toLowerCase(),
          orderId: initiated.order.order_id,
          orderToken: await protectLicenseToken(initiated.order_token)
        })
      );
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : "Inscription impossible.");
    } finally {
      setIsLoading(false);
    }
  };

  const verifyRegistrationPayment = async () => {
    if (!registrationPayment) return;
    try {
      setIsLoading(true);
      setError(null);
      const result = await getPaymentOrderStatus({
        orderId: registrationPayment.order.order_id,
        orderToken: registrationPayment.order_token
      });
      setRegistrationPayment((current) => current ? { ...current, order: result.order } : current);
      if (result.order.fulfillment_status !== "fulfilled") {
        setError(result.order.status === "failed" ? "Le paiement a échoué." : "Le paiement est encore en attente.");
        return;
      }
      if (!password) {
        setError("Saisissez le mot de passe choisi lors de l’inscription pour ouvrir le compte.");
        return;
      }
      await loginReseller(email, password);
      localStorage.removeItem(pendingResellerPaymentStorageKey);
      onSuccess();
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : "Vérification impossible.");
    } finally {
      setIsLoading(false);
    }
  };

  const restartRegistrationPayment = async () => {
    if (!registrationPayment) return;
    try {
      setIsLoading(true);
      setError(null);
      const result = await abandonPaymentOrder({
        orderId: registrationPayment.order.order_id,
        orderToken: registrationPayment.order_token
      });
      setRegistrationPayment((current) => current ? { ...current, order: result.order } : current);
      if (!result.abandoned) {
        setError("Ce paiement a finalement été confirmé. Continuez avec le bouton de vérification.");
        return;
      }
      localStorage.removeItem(pendingResellerPaymentStorageKey);
      setRegistrationPayment(null);
      setError("Tentative abandonnée. Vous pouvez relancer votre inscription et votre paiement.");
    } catch (paymentError) {
      setError(errorMessage(paymentError, "Impossible d'abandonner cette tentative."));
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async () => {
    if (newPassword !== confirmPassword) {
      setError("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      await resetResellerPassword({ email, newPassword, resetToken });
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setResetToken("");
      setMode("login");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Réinitialisation impossible.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="profile-choice-panel">
        <Card title={
          loginResult?.reseller.must_change_password
            ? "Sécurisez votre compte"
            : mode === "login"
              ? "Connexion revendeur"
              : mode === "register"
                ? "Créer mon compte revendeur"
                : "Réinitialiser mon mot de passe"
        }>
          {!loginResult && !registrationPayment ? (
            <div className="filter-row">
              <FilterButton active={mode === "login"} onClick={() => setMode("login")}>Se connecter</FilterButton>
              <FilterButton active={mode === "register"} onClick={() => setMode("register")}>Devenir revendeur</FilterButton>
              <FilterButton active={mode === "reset"} onClick={() => setMode("reset")}>Mot de passe oublié</FilterButton>
            </div>
          ) : null}

          {mode === "login" && !loginResult?.reseller.must_change_password ? (
            <div className="router-form-grid">
              <label className="form-field">Email
                <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
              </label>
              <PasswordField autoComplete="current-password" label="Mot de passe" onChange={setPassword} value={password} />
            </div>
          ) : null}

          {mode === "register" && !registrationPayment ? (
            <div className="router-form-grid">
              <label className="form-field">Nom du revendeur ou entreprise
                <input onChange={(event) => setName(event.target.value)} value={name} />
              </label>
              <label className="form-field">Email
                <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
              </label>
              <PasswordField autoComplete="new-password" label="Mot de passe" onChange={setPassword} value={password} />
              <PasswordField autoComplete="new-password" label="Confirmer le mot de passe" onChange={setConfirmPassword} value={confirmPassword} />
              <label className="form-field">Premier pack
                <select onChange={(event) => setPlanId(event.target.value)} value={planId}>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name} — {formatCfa(plan.price_cfa)}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">Téléphone Niger
                <input onChange={(event) => setMsisdn(event.target.value)} placeholder="22790909090" value={msisdn} />
              </label>
              <label className="form-field">Moyen de paiement
                <select onChange={(event) => setPaymentType(event.target.value as IpayPaymentType)} value={paymentType}>
                  <option value="mobile">Orange / Moov / Zamani</option>
                  <option value="nita_online">Nita</option>
                  <option value="amanata">Amana</option>
                </select>
              </label>
            </div>
          ) : null}

          {mode === "reset" ? (
            <div className="router-form-grid">
              <label className="form-field">Email
                <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
              </label>
              <label className="form-field">Code reçu du support TicketPro
                <input autoComplete="one-time-code" onChange={(event) => setResetToken(event.target.value)} value={resetToken} />
              </label>
              <PasswordField autoComplete="new-password" label="Nouveau mot de passe" onChange={setNewPassword} value={newPassword} />
              <PasswordField autoComplete="new-password" label="Confirmer le nouveau mot de passe" onChange={setConfirmPassword} value={confirmPassword} />
            </div>
          ) : null}

          {registrationPayment ? (
            <div className="page-stack">
              <Badge status={registrationPayment.order.fulfillment_status === "fulfilled" ? "active" : "warning"}>
                {registrationPayment.order.fulfillment_status === "fulfilled" ? "Compte financé" : "Paiement en attente"}
              </Badge>
              <p>Référence : <strong>{registrationPayment.payment.public_reference}</strong></p>
              {registrationPayment.payment.meta_data?.code ? (
                <p className="payment-code">Code iPay : <strong>{registrationPayment.payment.meta_data.code}</strong></p>
              ) : null}
              <PasswordField
                autoComplete="current-password"
                label="Mot de passe choisi à l’inscription"
                onChange={setPassword}
                value={password}
              />
            </div>
          ) : null}

          {loginResult?.reseller.must_change_password ? (
            <div className="page-stack">
              <p>Votre mot de passe temporaire doit être remplacé avant d’accéder aux crédits.</p>
              <PasswordField autoComplete="new-password" label="Nouveau mot de passe" onChange={setNewPassword} value={newPassword} />
              <PasswordField autoComplete="new-password" label="Confirmer le nouveau mot de passe" onChange={setConfirmPassword} value={confirmPassword} />
              <small>12 caractères minimum, avec majuscule, minuscule, chiffre et symbole.</small>
            </div>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="confirm-dialog__actions">
            <Button icon={ChevronLeft} onClick={onBack} variant="ghost">Retour</Button>
            {registrationPayment && registrationPayment.order.fulfillment_status !== "fulfilled" ? (
              <Button disabled={isLoading} onClick={() => void restartRegistrationPayment()} variant="ghost">
                Abandonner et recommencer
              </Button>
            ) : null}
            <Button
              disabled={isLoading}
              icon={LogIn}
              onClick={() => void (
                registrationPayment
                  ? verifyRegistrationPayment()
                  : loginResult?.reseller.must_change_password
                    ? changePassword()
                    : mode === "reset"
                      ? resetPassword()
                    : mode === "register"
                      ? register()
                      : login()
              )}
              variant="primary"
            >
              {isLoading
                ? "Veuillez patienter…"
                : registrationPayment
                  ? "J’ai validé — vérifier"
                  : loginResult?.reseller.must_change_password
                    ? "Changer et continuer"
                    : mode === "reset"
                      ? "Réinitialiser le mot de passe"
                    : mode === "register"
                      ? "Créer et payer mon pack"
                      : "Se connecter"}
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}

function AccountStep({
  onChange,
  state
}: {
  onChange: (partial: Partial<FirstLaunchState>) => void;
  state: FirstLaunchState;
}) {
  const updateAccount = (partial: Partial<FirstLaunchState["account"]>) =>
    onChange({ account: { ...state.account, ...partial } });

  return (
    <div className="router-form-grid">
      <label className="form-field">
        Email
        <input
          autoComplete="email"
          onChange={(event) => updateAccount({ email: event.target.value })}
          type="email"
          value={state.account.email}
        />
      </label>
      <label className="form-field">
        Nom entreprise
        <input
          onChange={(event) => updateAccount({ companyName: event.target.value })}
          value={state.account.companyName}
        />
      </label>
      <label className="form-field">
        Téléphone optionnel
        <input onChange={(event) => updateAccount({ phone: event.target.value })} value={state.account.phone} />
      </label>
      <PasswordField
        autoComplete="new-password"
        label="Mot de passe principal"
        onChange={(password) => updateAccount({ password })}
        value={state.account.password}
      />
      <PasswordField
        autoComplete="new-password"
        label="Confirmer le mot de passe principal"
        onChange={(confirmPassword) => updateAccount({ confirmPassword })}
        value={state.account.confirmPassword}
      />
    </div>
  );
}

function PackStep({
  activation,
  isCatalogLoading,
  isVerifying,
  onChange,
  onVerify,
  plans,
  state
}: {
  activation: LicenseActivationResult | null;
  isCatalogLoading: boolean;
  isVerifying: boolean;
  onChange: (partial: Partial<FirstLaunchState>) => void;
  onVerify: () => void;
  plans: LicensePlan[];
  state: FirstLaunchState;
}) {
  return (
    <div className="page-stack">
      <Card title="Offres TicketPro">
        <p className="login-panel__text">
          Ces offres viennent directement de notre serveur. Votre clé détermine automatiquement le forfait :
          vous n'avez rien à sélectionner ici.
        </p>
        {isCatalogLoading ? <p>Chargement des offres…</p> : null}
        <div className="subscription-plan-grid">
          {plans.map((plan) => (
            <article
              className={
                plan.is_recommended
                  ? "subscription-plan-card subscription-plan-card--current"
                  : "subscription-plan-card"
              }
              key={plan.id}
            >
              <div>
                <strong>{plan.name}</strong>
                <span>{plan.router_limit} routeur(s) · {plan.max_devices} PC</span>
              </div>
              <p>{plan.description}</p>
              <Badge status={plan.is_recommended ? "active" : "success"}>
                {formatCfa(plan.price_cfa)} / {billingPeriodLabel(plan.billing_period)}
              </Badge>
            </article>
          ))}
        </div>
      </Card>

      <Card title="Clé d'activation TicketPro">
        <div className="form-field">
          <label htmlFor="ticketpro-license-key">Clé reçue après votre achat</label>
          <div className="input-with-icon">
            <KeyRound size={18} />
            <input
              id="ticketpro-license-key"
              autoComplete="off"
              onChange={(event) => onChange({ activationKey: event.target.value.toUpperCase() })}
              placeholder="TP-XXXX-XXXX-XXXX-XXXX"
              value={state.activationKey}
            />
          </div>
          <small>La licence détermine la durée, le quota global de routeurs et le nombre de PC autorisés.</small>
        </div>
        <div className="confirm-dialog__actions">
          <Button
            disabled={isVerifying || !state.activationKey.trim()}
            icon={KeyRound}
            onClick={onVerify}
            variant="primary"
          >
            {isVerifying ? "Vérification…" : "Vérifier ma clé"}
          </Button>
        </div>
      </Card>

      {activation ? (
        <Card title="Licence reconnue">
          <div className="stats-grid">
            <StatCard icon={CreditCard} label="Forfait" value={activation.plan.name} hint={activation.plan.code} />
            <StatCard icon={Router} label="Routeurs" value={String(activation.router_limit)} hint="Quota global partagé" />
            <StatCard icon={Laptop} label="PC autorisés" value={String(activation.max_devices)} hint={`${activation.device_count} activé(s)`} />
            <StatCard
              icon={ShieldCheck}
              label="Validité"
              value={`${activation.duration_days} jours`}
              hint={activation.expires_at ? `Jusqu'au ${new Date(activation.expires_at).toLocaleDateString("fr-FR")}` : ""}
            />
          </div>
          <Badge status="active">Clé valide — vous pouvez continuer</Badge>
        </Card>
      ) : null}
    </div>
  );
}

function ProfilesStep({
  onChange,
  state
}: {
  onChange: (partial: Partial<FirstLaunchState>) => void;
  state: FirstLaunchState;
}) {
  const updatePassword = (role: keyof FirstLaunchState["profilePasswords"], password: string) =>
    onChange({ profilePasswords: { ...state.profilePasswords, [role]: password } });

  return (
    <div className="router-form-grid">
      <PasswordField
        autoComplete="new-password"
        label="Mot de passe Admin obligatoire"
        onChange={(password) => updatePassword("admin", password)}
        value={state.profilePasswords.admin}
      />
      <PasswordField
        autoComplete="new-password"
        label="Mot de passe Opérateur optionnel"
        onChange={(password) => updatePassword("operator", password)}
        value={state.profilePasswords.operator}
      />
      <PasswordField
        autoComplete="new-password"
        label="Mot de passe Agent optionnel"
        onChange={(password) => updatePassword("agent", password)}
        value={state.profilePasswords.agent}
      />
      <PasswordField
        autoComplete="new-password"
        label="Mot de passe Invité optionnel"
        onChange={(password) => updatePassword("guest", password)}
        value={state.profilePasswords.guest}
      />
    </div>
  );
}

function SummaryStep({
  paymentConfirmed,
  selectedPlanName,
  state,
  summary
}: {
  paymentConfirmed: boolean;
  selectedPlanName: string;
  state: FirstLaunchState;
  summary: FirstLaunchSummary | null;
}) {
  const configuredProfiles = Object.entries(state.profilePasswords)
    .filter(([, password]) => Boolean(password.trim()))
    .map(([role]) => role);

  return (
    <div className="stats-grid">
      <StatCard icon={Building2} label="Compte" value={state.account.email || "À créer"} hint={state.account.companyName || "Entreprise"} />
      <StatCard icon={CreditCard} label="Pack" value={selectedPlanName} hint={state.subscriptionStatus === "trial" ? "Essai" : "Actif manuel"} />
      <StatCard icon={ShieldCheck} label="Profils configurés" value={String(configuredProfiles.length)} hint={configuredProfiles.join(", ") || "Admin requis"} />
      <StatCard
        icon={UserRound}
        label="Statut"
        value={summary ? "Créé" : "Prêt"}
        hint={paymentConfirmed ? "Paiement confirmé" : "Activation par clé"}
      />
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

function billingPeriodLabel(period: LicensePlan["billing_period"]): string {
  if (period === "yearly") return "an";
  if (period === "custom") return "période";
  return "mois";
}

function localPlanToLicensePlan(plan: (typeof subscriptionPlans)[number]): LicensePlan {
  return {
    billing_period: plan.billingPeriod,
    code: plan.id,
    description: plan.description,
    duration_days: plan.billingPeriod === "yearly" ? 365 : 30,
    id: plan.id,
    is_active: plan.isActive,
    is_recommended: plan.isRecommended,
    max_devices: plan.routerLimit >= 100
      ? 100
      : plan.routerLimit >= 50
        ? 25
        : plan.routerLimit >= 10
          ? 5
          : plan.routerLimit >= 5
            ? 2
            : 1,
    name: plan.name,
    price_cfa: plan.priceCfa,
    router_limit: plan.routerLimit
  };
}
