import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileText,
  Lock,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  XCircle
} from "lucide-react";
import type { MainAccountStatus } from "../../domain/auth";
import { Badge, Button, Card, DataListItem, EmptyState, PageHeader, PasswordField, StatCard } from "../../shared/ui";
import {
  activateSuperAdmin,
  createInvoiceForDevelopment,
  createSuperAdminSession,
  deactivateSuperAdmin,
  isSuperAdminAvailable,
  listSuperAdminAccounts,
  markInvoicePaidForDevelopment,
  readSuperAdminConfig,
  readSuperAdminSession,
  setAccountStatusForDevelopment,
  superAdminSubscriptionLabel,
  updateAccountPlanForDevelopment,
  updateAccountSubscriptionStatusForDevelopment,
  verifySuperAdminPassword
} from "./superAdminModel";
import {
  formatCfa,
  paymentStatusLabel,
  subscriptionPlans,
  subscriptionStatusLabel,
  type SubscriptionPaymentStatus,
  type SubscriptionStatus
} from "../global/subscriptionPageModel";
import { invoiceStatusLabel } from "../global/invoicesPageModel";

const subscriptionStatuses: SubscriptionStatus[] = ["active", "trial", "expired", "suspended", "cancelled"];
const paymentStatuses: SubscriptionPaymentStatus[] = ["manual", "paid", "pending", "unpaid"];
const accountStatuses: MainAccountStatus[] = ["active", "trial", "expired", "suspended"];

export function SuperAdminPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activationPassword, setActivationPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState(() => readSuperAdminSession());
  const config = useMemo(() => readSuperAdminConfig(), [refreshKey]);
  const accounts = useMemo(() => listSuperAdminAccounts(), [refreshKey]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.account.id ?? "");
  const selectedAccount = accounts.find((item) => item.account.id === selectedAccountId) ?? accounts[0] ?? null;

  const refresh = () => setRefreshKey((current) => current + 1);

  const activate = async () => {
    const result = await activateSuperAdmin(activationPassword);
    setMessage(result.message);

    if (result.ok) {
      setActivationPassword("");
      refresh();
    }
  };

  const login = async () => {
    const ok = await verifySuperAdminPassword(loginPassword);

    if (!ok) {
      setMessage("Mot de passe Super Admin incorrect.");
      return;
    }

    setSession(createSuperAdminSession());
    setLoginPassword("");
    setMessage("Mode Super Admin développement ouvert.");
  };

  const updatePlan = (planId: string) => {
    if (!selectedAccount) {
      return;
    }

    updateAccountPlanForDevelopment(selectedAccount.account.id, planId);
    refresh();
    setMessage("Pack du compte mis à jour.");
  };

  const updateSubscriptionStatus = (status: SubscriptionStatus, paymentStatus: SubscriptionPaymentStatus) => {
    if (!selectedAccount) {
      return;
    }

    updateAccountSubscriptionStatusForDevelopment(selectedAccount.account.id, status, paymentStatus);
    refresh();
    setMessage("Statut de l'abonnement mis à jour.");
  };

  const updateAccountStatus = (status: MainAccountStatus) => {
    if (!selectedAccount) {
      return;
    }

    setAccountStatusForDevelopment(selectedAccount.account.id, status);
    refresh();
    setMessage(status === "suspended" ? "Compte suspendu." : "Compte réactivé.");
  };

  const createInvoice = () => {
    if (!selectedAccount) {
      return;
    }

    createInvoiceForDevelopment(selectedAccount.account.id);
    refresh();
    setMessage("Facture créée en brouillon.");
  };

  const markLastInvoicePaid = () => {
    if (!selectedAccount?.lastInvoice) {
      return;
    }

    markInvoicePaidForDevelopment(selectedAccount.account.id, selectedAccount.lastInvoice.id);
    refresh();
    setMessage("Facture marquée comme payée.");
  };

  if (!isSuperAdminAvailable()) {
    return (
      <main className="login-page">
        <section className="profile-choice-panel">
          <Card>
            <EmptyState
              description="Ce module est désactivé hors mode développement."
              icon={ShieldAlert}
              title="Mode Super Admin indisponible"
            />
          </Card>
        </section>
      </main>
    );
  }

  if (!config.enabled) {
    return (
      <SuperAdminShell>
        <Card title="Activer le mode Super Admin développement" description="Désactivé par défaut. Ne pas utiliser en production.">
          <div className="router-form-grid">
            <PasswordField
              autoComplete="new-password"
              label="Créer le mot de passe local Super Admin"
              onChange={setActivationPassword}
              value={activationPassword}
            />
          </div>
          {message ? <p className="form-error">{message}</p> : null}
          <div className="confirm-dialog__actions">
            <Button icon={Lock} onClick={() => void activate()} variant="primary">
              Activer le mode développement
            </Button>
          </div>
        </Card>
      </SuperAdminShell>
    );
  }

  if (!session) {
    return (
      <SuperAdminShell>
        <Card title="Connexion Super Admin" description="Accès local temporaire réservé au développement.">
          <div className="router-form-grid">
            <PasswordField
              autoComplete="current-password"
              label="Mot de passe Super Admin"
              onChange={setLoginPassword}
              value={loginPassword}
            />
          </div>
          {message ? <p className="form-error">{message}</p> : null}
          <div className="confirm-dialog__actions">
            <Button icon={ShieldCheck} onClick={() => void login()} variant="primary">
              Entrer
            </Button>
            <Button
              icon={XCircle}
              onClick={() => {
                deactivateSuperAdmin();
                refresh();
                setMessage("Mode Super Admin désactivé.");
              }}
              variant="ghost"
            >
              Désactiver
            </Button>
          </div>
        </Card>
      </SuperAdminShell>
    );
  }

  return (
    <SuperAdminShell>
      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <div className="stats-grid">
        <StatCard icon={UserRound} label="Comptes locaux" value={String(accounts.length)} hint="Stockage développement" />
        <StatCard
          icon={Package}
          label="Pack sélectionné"
          value={selectedAccount?.plan.name ?? "Aucun"}
          hint={selectedAccount ? `${selectedAccount.subscription.routerLimitSnapshot} routeur(s)` : ""}
        />
        <StatCard
          icon={CreditCard}
          label="Montant"
          value={selectedAccount ? formatCfa(selectedAccount.subscription.priceCfaSnapshot) : "Aucun"}
          hint={selectedAccount ? paymentStatusLabel(selectedAccount.subscription.paymentStatus) : ""}
        />
        <StatCard
          icon={FileText}
          label="Factures"
          value={String(selectedAccount?.invoiceCount ?? 0)}
          hint={selectedAccount?.lastInvoice ? invoiceStatusLabel(selectedAccount.lastInvoice.status) : "Aucune facture"}
        />
      </div>

      <Card title="Comptes principaux locaux" description="Liste locale de développement.">
        {accounts.length === 0 ? (
          <EmptyState description="Aucun compte local." icon={UserRound} title="Aucun compte" />
        ) : (
          <div className="data-list">
            {accounts.map((overview) => (
              <button
                className={
                  overview.account.id === selectedAccount?.account.id
                    ? "super-admin-account super-admin-account--active"
                    : "super-admin-account"
                }
                key={overview.account.id}
                onClick={() => setSelectedAccountId(overview.account.id)}
                type="button"
              >
                <DataListItem
                  description={`${overview.account.companyName} · ${superAdminSubscriptionLabel(overview)}`}
                  icon={UserRound}
                  meta={<Badge status={overview.account.status === "active" ? "success" : "warning"}>{accountStatusLabel(overview.account.status)}</Badge>}
                  title={overview.account.email}
                />
              </button>
            ))}
          </div>
        )}
      </Card>

      {selectedAccount ? (
        <Card title="Gestion abonnement" description="Actions manuelles pour tester les packs pendant le développement.">
          <div className="router-form-grid">
            <label className="form-field">
              Pack
              <select onChange={(event) => updatePlan(event.target.value)} value={selectedAccount.plan.id}>
                {subscriptionPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - {formatCfa(plan.priceCfa)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Statut abonnement
              <select
                onChange={(event) =>
                  updateSubscriptionStatus(event.target.value as SubscriptionStatus, selectedAccount.subscription.paymentStatus)
                }
                value={selectedAccount.subscription.status}
              >
                {subscriptionStatuses.map((status) => (
                  <option key={status} value={status}>
                    {subscriptionStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Paiement
              <select
                onChange={(event) =>
                  updateSubscriptionStatus(selectedAccount.subscription.status, event.target.value as SubscriptionPaymentStatus)
                }
                value={selectedAccount.subscription.paymentStatus}
              >
                {paymentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Statut compte
              <select onChange={(event) => updateAccountStatus(event.target.value as MainAccountStatus)} value={selectedAccount.account.status}>
                {accountStatuses.map((status) => (
                  <option key={status} value={status}>
                    {accountStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="confirm-dialog__actions">
            <Button icon={FileText} onClick={createInvoice} variant="secondary">
              Créer une facture
            </Button>
            <Button disabled={!selectedAccount.lastInvoice} icon={CheckCircle2} onClick={markLastInvoicePaid} variant="primary">
              Marquer dernière facture payée
            </Button>
            <Button icon={RefreshCw} onClick={refresh} variant="ghost">
              Rafraîchir
            </Button>
          </div>
        </Card>
      ) : null}
    </SuperAdminShell>
  );
}

function SuperAdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="page-stack super-admin-page">
      <PageHeader
        description="Ne pas utiliser en production. Ce module sert uniquement à tester les abonnements logiciels sans paiement automatique."
        eyebrow="Développement"
        title="Mode Super Admin développement"
      />
      <Card>
        <DataListItem
          description="Ce mode est volontairement isolé et absent de la navigation normale."
          icon={AlertTriangle}
          meta={<Badge status="warning">Temporaire</Badge>}
          title="Ne pas utiliser en production"
        />
      </Card>
      {children}
    </main>
  );
}

function accountStatusLabel(status: MainAccountStatus): string {
  const labels: Record<MainAccountStatus, string> = {
    active: "Actif",
    expired: "Expiré",
    suspended: "Suspendu",
    trial: "Essai"
  };

  return labels[status];
}
