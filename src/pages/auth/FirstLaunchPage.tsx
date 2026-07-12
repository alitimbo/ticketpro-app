import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, ShieldCheck, UserRound } from "lucide-react";
import { Badge, Button, Card, FilterButton, PasswordField, StatCard } from "../../shared/ui";
import { formatCfa, subscriptionPlans } from "../global/subscriptionPageModel";
import {
  completeFirstLaunch,
  defaultFirstLaunchState,
  firstLaunchSteps,
  validateFirstLaunchStep,
  type FirstLaunchState,
  type FirstLaunchStep,
  type FirstLaunchSummary
} from "./firstLaunchModel";

const stepTitles: Record<FirstLaunchStep, string> = {
  1: "Compte principal",
  2: "Pack",
  3: "Profils internes",
  4: "Résumé"
};

export function FirstLaunchPage({ onComplete }: { onComplete?: () => void }) {
  const navigate = useNavigate();
  const [state, setState] = useState<FirstLaunchState>(defaultFirstLaunchState);
  const [step, setStep] = useState<FirstLaunchStep>(1);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FirstLaunchSummary | null>(null);
  const selectedPlan = useMemo(
    () => subscriptionPlans.find((plan) => plan.id === state.selectedPlanId) ?? subscriptionPlans[0],
    [state.selectedPlanId]
  );

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

    setStep((current) => Math.min(4, current + 1) as FirstLaunchStep);
  };

  const goBack = () => {
    setError(null);
    setStep((current) => Math.max(1, current - 1) as FirstLaunchStep);
  };

  const finish = async () => {
    try {
      const completed = await completeFirstLaunch(state);
      setSummary(completed);
      setError(null);
      onComplete?.();
      navigate("/login", { replace: true });
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "Configuration impossible.");
    }
  };

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
              Créez le compte principal, choisissez un pack et protégez au moins le profil Admin.
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
          {step === 2 ? <PackStep state={state} onChange={updateState} /> : null}
          {step === 3 ? <ProfilesStep state={state} onChange={updateState} /> : null}
          {step === 4 ? <SummaryStep state={state} selectedPlanName={selectedPlan.name} summary={summary} /> : null}

          {error ? <p className="form-error">{error}</p> : null}

          <div className="confirm-dialog__actions">
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
  onChange,
  state
}: {
  onChange: (partial: Partial<FirstLaunchState>) => void;
  state: FirstLaunchState;
}) {
  return (
    <div className="page-stack">
      <div className="subscription-plan-grid">
        {subscriptionPlans.map((plan) => (
          <button
            className={
              plan.id === state.selectedPlanId
                ? "subscription-plan-card subscription-plan-card--current"
                : "subscription-plan-card"
            }
            key={plan.id}
            onClick={() => onChange({ selectedPlanId: plan.id })}
            type="button"
          >
            <div>
              <strong>{plan.name}</strong>
              <span>{plan.routerLimit} routeur(s)</span>
            </div>
            <p>{plan.description}</p>
            <Badge status={plan.isRecommended ? "active" : "success"}>
              {formatCfa(plan.priceCfa)} / mois
            </Badge>
          </button>
        ))}
      </div>

      <Card title="Statut initial de l'abonnement">
        <div className="filter-row">
          <FilterButton active={state.subscriptionStatus === "trial"} onClick={() => onChange({ subscriptionStatus: "trial" })}>
            Essai
          </FilterButton>
          <FilterButton
            active={state.subscriptionStatus === "active_manual"}
            onClick={() => onChange({ subscriptionStatus: "active_manual" })}
          >
            Actif manuel
          </FilterButton>
        </div>
      </Card>
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
  selectedPlanName,
  state,
  summary
}: {
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
      <StatCard icon={UserRound} label="Statut" value={summary ? "Créé" : "Prêt"} hint="Aucun paiement en ligne" />
    </div>
  );
}
