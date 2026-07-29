import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, KeyRound, LogOut, Mail, Phone, Router, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/auth/AuthProvider";
import { AccountRepository, AppLogRepository, RouterRepository, useAppDatabase } from "../../services/database";
import { AuditLogService } from "../../services/logging";
import {
  appendAccountSecurityLog,
  changeMainAccountPassword,
  hashMainAccountPassword,
  readAccountSecurityLogs,
  readMainAccountRecord,
  refreshMainAccountSession,
  storeMainAccountSession,
  updateMainAccountDetails,
  type MainAccountSecurityLog
} from "../../services/auth";
import { Badge, Button, Card, DataListItem, PageHeader, PasswordField, StatCard } from "../../shared/ui";
import { getSubscriptionOverview } from "./subscriptionPageModel";
import { accountStatusLabel, formatAccountDate, validateAccountDetails, validatePasswordChange } from "./accountPageModel";

type DetailsFormState = {
  companyName: string;
  displayName: string;
  phone: string;
};

type PasswordFormState = {
  confirmPassword: string;
  newPassword: string;
  oldPassword: string;
};

const emptyPasswordForm: PasswordFormState = {
  confirmPassword: "",
  newPassword: "",
  oldPassword: ""
};

export function AccountPage() {
  const navigate = useNavigate();
  const { accountSession, logoutAccount, refreshAccountSession, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [account, setAccount] = useState(() => readMainAccountRecord(accountSession?.email ?? ""));
  const accountRepository = useMemo(() => new AccountRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const appLogRepository = useMemo(() => new AppLogRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const [routersUsed, setRoutersUsed] = useState(0);
  const subscriptionOverview = useMemo(
    () => getSubscriptionOverview(routersUsed),
    [routersUsed]
  );
  const [detailsForm, setDetailsForm] = useState<DetailsFormState>({
    companyName: account?.companyName ?? "",
    displayName: account?.displayName ?? "",
    phone: account?.phone ?? ""
  });
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm);
  const [persistentSecurityLogs, setPersistentSecurityLogs] = useState<MainAccountSecurityLog[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const localSecurityLogs = useMemo(
    () => readAccountSecurityLogs().filter((log) => log.accountId === accountSession?.accountId).slice(0, 5),
    [accountSession?.accountId, message]
  );
  const securityLogs = isPersistent ? persistentSecurityLogs : localSecurityLogs;

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountSession) {
      return;
    }

    void accountRepository.findById(accountSession.accountId).then((record) => {
      if (record) {
        const nextAccount = {
          companyName: record.company_name ?? "",
          createdAt: record.created_at,
          displayName: record.display_name ?? "",
          email: record.email,
          id: record.id,
          lastLoginAt: record.last_login_at,
          passwordHash: record.password_hash,
          phone: record.phone ?? "",
          status: record.status,
          updatedAt: record.updated_at
        };
        setAccount(nextAccount);
        setDetailsForm({
          companyName: nextAccount.companyName,
          displayName: nextAccount.displayName,
          phone: nextAccount.phone
        });
      }
    });
  }, [accountRepository, accountSession, isInitialized, isPersistent]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountSession) {
      return;
    }

    void routerRepository.countSubscriptionRoutersByAccount(accountSession.accountId).then(setRoutersUsed);
  }, [accountSession, isInitialized, isPersistent, routerRepository]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountSession) {
      return;
    }

    void appLogRepository.listByAccount(accountSession.accountId).then((records) => {
      setPersistentSecurityLogs(
        records
          .filter((record) => record.category === "authentification")
          .slice(0, 5)
          .map((record) => ({
            accountId: accountSession.accountId,
            createdAt: record.created_at,
            id: record.id,
            internalProfileId: record.internal_profile_id,
            message: record.user_message
          }))
      );
    });
  }, [accountSession, appLogRepository, isInitialized, isPersistent, message]);

  if (!account || !accountSession) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Global" title="Mon compte" description="Compte principal indisponible." />
        <Card>
          <p className="form-error">Connectez le compte principal pour voir cette page.</p>
        </Card>
      </div>
    );
  }

  const updateDetails = async () => {
    const validationError = validateAccountDetails({
      ...account,
      companyName: detailsForm.companyName,
      displayName: detailsForm.displayName,
      phone: detailsForm.phone
    });

    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    const updated = updateMainAccountDetails({
      companyName: detailsForm.companyName,
      displayName: detailsForm.displayName,
      email: account.email,
      phone: detailsForm.phone
    });
    if (isPersistent) {
      await accountRepository.updateDetails({
        companyName: updated.companyName,
        displayName: updated.displayName,
        email: updated.email,
        id: updated.id,
        phone: updated.phone
      });
      await auditLogService.write({
        accountId: account.id,
        action: "account.details_updated",
        category: "authentification",
        internalProfileId: session?.internal_profile_id ?? null,
        internalProfileRole: session?.internal_profile_role ?? null,
        message: "Informations du compte principal mises à jour."
      });
    }
    setAccount(updated);
    const refreshedSession = refreshMainAccountSession({
      ...accountSession,
      companyLabel: updated.companyName || updated.displayName || updated.email
    });

    storeMainAccountSession(refreshedSession);
    refreshAccountSession();
    setError(null);
    setMessage(isPersistent ? "Informations du compte mises à jour dans SQLite." : "Informations du compte mises à jour.");
  };

  const updatePassword = async () => {
    const validationError = validatePasswordChange(passwordForm);

    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    const result = await changeMainAccountPassword({
      email: account.email,
      newPassword: passwordForm.newPassword,
      oldPassword: passwordForm.oldPassword
    });

    if (!result.ok) {
      setError(result.message);
      setMessage(null);
      return;
    }

    if (isPersistent) {
      await accountRepository.updatePassword(account.id, await hashMainAccountPassword(account.email, passwordForm.newPassword));
      await auditLogService.write({
        accountId: account.id,
        action: "account.password_changed",
        category: "authentification",
        internalProfileId: session?.internal_profile_id ?? null,
        internalProfileRole: session?.internal_profile_role ?? null,
        message: "Mot de passe principal modifié."
      });
    }

    appendAccountSecurityLog({
      accountId: account.id,
      internalProfileId: session?.internal_profile_id ?? null,
      message: "Mot de passe principal modifié."
    });
    setPasswordForm(emptyPasswordForm);
    setError(null);
    setMessage(result.message);
  };

  const completeLogout = () => {
    logoutAccount();
    navigate("/login", { replace: true });
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button icon={LogOut} onClick={completeLogout} variant="ghost">
            Déconnexion complète
          </Button>
        }
        description="Informations du compte principal connecté."
        eyebrow="Global"
        title="Mon compte"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="stats-grid">
        <StatCard icon={ShieldCheck} label="Statut du compte" value={accountStatusLabel(account.status)} hint={account.email} />
        <StatCard icon={Router} label="Routeurs utilisés" value={`${subscriptionOverview.routersUsed} / ${subscriptionOverview.subscription.routerLimitSnapshot}`} hint={subscriptionOverview.plan.name} />
        <StatCard icon={CalendarDays} label="Création" value={formatAccountDate(account.createdAt)} hint="Compte principal" />
        <StatCard icon={CalendarDays} label="Dernière connexion" value={formatAccountDate(account.lastLoginAt)} hint="Session principale" />
      </div>

      <Card title="Informations du compte" description="Ces informations décrivent le compte principal, pas un profil interne.">
        <div className="subscription-overview-grid">
          <DataListItem description={account.email} icon={Mail} title="Email" />
          <DataListItem description={account.displayName} icon={UserRound} title="Nom affiché" />
          <DataListItem description={account.companyName} icon={Building2} title="Entreprise" />
          <DataListItem description={account.phone || "Non renseigné"} icon={Phone} title="Téléphone" />
          <DataListItem
            description={subscriptionOverview.plan.name}
            icon={ShieldCheck}
            meta={<Badge status={subscriptionOverview.subscription.status === "active" ? "success" : "warning"}>{subscriptionOverview.statusLabel}</Badge>}
            title="Abonnement actuel"
          />
          <DataListItem
            description={`${subscriptionOverview.routersUsed} routeur(s) utilisé(s) sur ${subscriptionOverview.subscription.routerLimitSnapshot}`}
            icon={Router}
            title="Limite de routeurs"
          />
        </div>
      </Card>

      <Card title="Modifier les informations">
        <div className="router-form-grid">
          <label className="form-field">
            Nom affiché
            <input
              value={detailsForm.displayName}
              onChange={(event) => setDetailsForm((current) => ({ ...current, displayName: event.target.value }))}
            />
          </label>
          <label className="form-field">
            Entreprise
            <input
              value={detailsForm.companyName}
              onChange={(event) => setDetailsForm((current) => ({ ...current, companyName: event.target.value }))}
            />
          </label>
          <label className="form-field">
            Téléphone du propriétaire
            <input
              inputMode="tel"
              placeholder="Ex. +227 90 12 34 56"
              value={detailsForm.phone}
              onChange={(event) => setDetailsForm((current) => ({ ...current, phone: event.target.value }))}
            />
            <small>Ce numéro sera centré et imprimé sur chaque ticket généré.</small>
          </label>
        </div>
        <div className="confirm-dialog__actions">
          <Button icon={UserRound} onClick={() => void updateDetails()} variant="primary">
            Enregistrer
          </Button>
        </div>
      </Card>

      <Card title="Changer le mot de passe principal" description="L'ancien mot de passe est obligatoire. Aucun mot de passe n'est écrit dans les logs.">
        <div className="router-form-grid">
          <PasswordField
            label="Ancien mot de passe"
            onChange={(oldPassword) => setPasswordForm((current) => ({ ...current, oldPassword }))}
            value={passwordForm.oldPassword}
          />
          <PasswordField
            autoComplete="new-password"
            label="Nouveau mot de passe"
            onChange={(newPassword) => setPasswordForm((current) => ({ ...current, newPassword }))}
            value={passwordForm.newPassword}
          />
          <PasswordField
            autoComplete="new-password"
            label="Confirmer le nouveau mot de passe"
            onChange={(confirmPassword) => setPasswordForm((current) => ({ ...current, confirmPassword }))}
            value={passwordForm.confirmPassword}
          />
        </div>
        <div className="confirm-dialog__actions">
          <Button icon={KeyRound} onClick={() => void updatePassword()} variant="primary">
            Mettre à jour
          </Button>
        </div>
      </Card>

      <Card title="Sécurité récente">
        {securityLogs.length > 0 ? (
          <div className="data-list">
            {securityLogs.map((log) => (
              <DataListItem
                description={formatAccountDate(log.createdAt)}
                icon={ShieldCheck}
                key={log.id}
                title={log.message}
              />
            ))}
          </div>
        ) : (
          <p className="muted-text">Aucun changement de sécurité récent.</p>
        )}
      </Card>
    </div>
  );
}
