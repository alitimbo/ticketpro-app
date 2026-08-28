import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthSession, MainAccountRecord, MainAccountSession, Permission, UserRole } from "../../domain/auth";
import type { InternalProfileRecord } from "../../domain/database";
import { AccountRepository, InternalProfileRepository, useAppDatabase } from "../../services/database";
import { AuditLogService, LogRetentionService } from "../../services/logging";
import {
  clearMainAccountSession,
  clearStoredSession,
  createMainAccountSession,
  createSession,
  getFirstLaunchRequired,
  hashProfilePassword,
  hasProfilePasswordConfigured,
  findInternalProfile,
  isInternalProfileEnabled,
  isMainAccountSessionExpired,
  isSessionExpired,
  readMainAccountSession,
  recordMainAccountLogin,
  readStoredSession,
  recordInternalProfileUsed,
  refreshMainAccountSession,
  refreshSession,
  saveMainAccountRecord,
  storeMainAccountSession,
  storeSession,
  verifyDevelopmentPassword
} from "../../services/auth";
import { getInternalProfilePermissions } from "../../services/auth";
import {
  getSaasAccount,
  loginSaas,
  logoutSaas,
  readSaasSession,
  switchSaasOrganization,
  type SaasAuthResult
} from "../../services/saas";
import { completeFirstLaunch, defaultFirstLaunchState } from "../../pages/auth/firstLaunchModel";
import { disconnectEmbeddedVpn, getVpnProviderStatus } from "../../services/vpn";

type LoginResult = {
  ok: boolean;
  message?: string;
};

type AuthContextValue = {
  accountSession: MainAccountSession | null;
  firstLaunchRequired: boolean;
  isAuthenticated: boolean;
  isMainAuthenticated: boolean;
  isSubscriptionActive: boolean;
  isSubscriptionChecked: boolean;
  loginAccount: (email: string, password: string) => Promise<LoginResult>;
  loginProfile: (role: UserRole, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  logoutAccount: () => Promise<void>;
  logoutProfile: () => void;
  session: AuthSession | null;
  saasAccount: SaasAuthResult | null;
  refreshSaasAccount: () => Promise<void>;
  switchOrganization: (membershipId: string) => Promise<LoginResult>;
  touchSession: () => void;
  refreshAccountSession: () => void;
  userCan: (permission: Permission) => boolean;
  userCanAny: (permissions?: Permission[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const activityPersistenceIntervalMs = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const accountRepository = useMemo(() => new AccountRepository(database), [database]);
  const internalProfileRepository = useMemo(() => new InternalProfileRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const logRetentionService = useMemo(() => new LogRetentionService(database), [database]);
  const [accountSession, setAccountSession] = useState<MainAccountSession | null>(() => readMainAccountSession());
  const [session, setSession] = useState<AuthSession | null>(() => {
    const account = readMainAccountSession();
    const profile = readStoredSession();

    if (!account || !profile || profile.account_email !== account.email || profile.account_id !== account.accountId) {
      clearStoredSession();
      return null;
    }

    return profile;
  });
  const [firstLaunchRequired] = useState(() => getFirstLaunchRequired());
  const [saasAccount, setSaasAccount] = useState<SaasAuthResult | null>(null);
  const [isSubscriptionChecked, setIsSubscriptionChecked] = useState(false);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session?.account_id) {
      return;
    }

    void logRetentionService.runAutomatic(session.account_id).catch(() => undefined);
  }, [
    isInitialized,
    isPersistent,
    logRetentionService,
    session?.account_id
  ]);

  const logoutProfile = useCallback(() => {
    clearStoredSession();
    setSession(null);
  }, []);

  const logoutAccount = useCallback(async () => {
    await Promise.allSettled([
      getVpnProviderStatus()
        .then((status) => status.provider === "EMBEDDED" ? disconnectEmbeddedVpn() : undefined),
      logoutSaas()
    ]);
    clearStoredSession();
    clearMainAccountSession();
    setSession(null);
    setAccountSession(null);
    setSaasAccount(null);
    setIsSubscriptionChecked(false);
  }, []);

  const refreshSaasAccount = useCallback(async () => {
    try {
      const token = await readSaasSession();
      if (!token) {
        clearStoredSession();
        clearMainAccountSession();
        setSession(null);
        setAccountSession(null);
        setSaasAccount(null);
        return;
      }
      const current = await getSaasAccount();
      setSaasAccount(current);
      const storedAccount = readMainAccountSession();
      if (storedAccount) {
        const restoredSession = createSession(
          current.user.app_role,
          current.user.email,
          Date.now(),
          current.user.name,
          storedAccount.accountId,
          current.user.permissions
        );
        storeSession(restoredSession);
        setSession(restoredSession);
      }
    } catch {
      setSaasAccount(null);
    } finally {
      setIsSubscriptionChecked(true);
    }
  }, []);

  const refreshAccountSessionFromStorage = useCallback(() => {
    const stored = readMainAccountSession();
    setAccountSession(stored);
  }, []);

  const selectOrganization = useCallback(async (membershipId: string): Promise<LoginResult> => {
    try {
      const selected = await switchSaasOrganization(membershipId);
      setSaasAccount(selected);
      const storedAccount = readMainAccountSession();
      if (!storedAccount) return { ok: false, message: "Session locale introuvable." };
      const updatedAccount = { ...storedAccount, companyLabel: selected.organization.name };
      storeMainAccountSession(updatedAccount);
      setAccountSession(updatedAccount);
      const selectedSession = createSession(
        selected.user.app_role,
        selected.user.email,
        Date.now(),
        selected.user.name,
        updatedAccount.accountId,
        selected.user.permissions
      );
      storeSession(selectedSession);
      setSession(selectedSession);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Changement d'organisation impossible."
      };
    }
  }, []);

  const touchSession = useCallback(() => {
    setAccountSession((current) => {
      if (!current) {
        return null;
      }

      if (isMainAccountSessionExpired(current)) {
        clearMainAccountSession();
        clearStoredSession();
        setSession(null);
        return null;
      }

      if (Date.now() - current.lastActivityAt < activityPersistenceIntervalMs) {
        return current;
      }

      const refreshed = refreshMainAccountSession(current);
      storeMainAccountSession(refreshed);
      return refreshed;
    });
    setSession((current) => {
      if (!current) {
        return null;
      }

      if (isSessionExpired(current)) {
        clearStoredSession();
        return null;
      }

      if (Date.now() - current.last_activity_at < activityPersistenceIntervalMs) {
        return current;
      }

      const refreshed = refreshSession(current);
      storeSession(refreshed);
      return refreshed;
    });
  }, []);

  const loginAccount = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    if (!email.trim() || !password.trim()) {
      return { ok: false, message: "Entrez l'email et le mot de passe." };
    }

    if (isPersistent && !isInitialized) {
      return { ok: false, message: "La base locale est encore en cours d'initialisation." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    let saasAccount;
    try {
      saasAccount = await loginSaas(normalizedEmail, password);
      setSaasAccount(saasAccount);
      setIsSubscriptionChecked(true);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Connexion TicketPro impossible."
      };
    }

    let persistentAccount = isPersistent ? await accountRepository.findByEmail(normalizedEmail) : null;
    if (!persistentAccount) {
      await completeFirstLaunch(
        {
          ...defaultFirstLaunchState,
          account: {
            companyName: saasAccount.organization.name,
            confirmPassword: password,
            email: normalizedEmail,
            password,
            phone: saasAccount.user.phone ?? ""
          },
          profilePasswords: {
            admin: password,
            agent: "",
            guest: "",
            operator: ""
          },
          selectedPlanId: saasAccount.subscription.plan?.id ?? defaultFirstLaunchState.selectedPlanId,
          subscriptionStatus: "active_manual"
        },
        isPersistent ? database : undefined,
        saasAccount.subscription.plan
          ? {
              billingPeriod: "monthly",
              description: "Abonnement SaaS TicketPro.",
              durationDays: Math.max(
                1,
                Math.ceil(
                  ((Date.parse(saasAccount.subscription.current_period_end ?? "") || Date.now()) - Date.now())
                    / 86_400_000
                )
              ),
              maxDevices: 100,
              planCode: saasAccount.subscription.plan.code,
              planId: saasAccount.subscription.plan.id,
              planName: saasAccount.subscription.plan.name,
              priceCfa: saasAccount.subscription.plan.price_cfa,
              routerLimit: Math.max(1, saasAccount.subscription.router_limit)
            }
          : undefined
      );
      persistentAccount = isPersistent ? await accountRepository.findByEmail(normalizedEmail) : null;
    }

    if (persistentAccount) {
      saveMainAccountRecord(mainAccountRecordFromDatabase(persistentAccount));
      await accountRepository.recordLogin(persistentAccount.id);
      await auditLogService.write({
        accountId: persistentAccount.id,
        action: "auth.account_login",
        category: "authentification",
        internalProfileId: null,
        message: "Connexion au compte principal réussie."
      });
    } else recordMainAccountLogin(email);
    const nextAccountSession = createMainAccountSession(email);
    storeMainAccountSession(nextAccountSession);
    setAccountSession(nextAccountSession);
    if (saasAccount.requires_organization_selection) {
      clearStoredSession();
      setSession(null);
    } else {
      const localRole: UserRole = saasAccount.user.app_role;
      const nextSession = createSession(
        localRole,
        normalizedEmail,
        Date.now(),
        saasAccount.user.name,
        nextAccountSession.accountId,
        saasAccount.user.permissions
      );
      storeSession(nextSession);
      setSession(nextSession);
    }

    return { ok: true };
  }, [accountRepository, auditLogService, database, isInitialized, isPersistent]);

  useEffect(() => {
    if (!accountSession) {
      setIsSubscriptionChecked(false);
      setSaasAccount(null);
      return;
    }
    void refreshSaasAccount();
  }, [accountSession?.accountId, refreshSaasAccount]);

  const loginProfile = useCallback(async (role: UserRole, password: string): Promise<LoginResult> => {
    if (!accountSession) {
      return { ok: false, message: "Connectez d'abord le compte principal." };
    }

    if (isPersistent && !isInitialized) {
      return { ok: false, message: "La base locale est encore en cours d'initialisation." };
    }

    const persistentProfile = isPersistent
      ? (await internalProfileRepository.listByAccount(accountSession.accountId)).find((item) => item.role === role)
      : null;
    const localProfile = findInternalProfile(role, accountSession.accountId);
    const profile = persistentProfile ? profileConfigFromDatabase(persistentProfile, accountSession.accountId) : localProfile;

    if (!(persistentProfile ? persistentProfile.is_enabled === 1 : isInternalProfileEnabled(role, accountSession.accountId))) {
      return { ok: false, message: "Ce profil est désactivé." };
    }

    const profileHasPassword = persistentProfile
      ? Boolean(persistentProfile.password_hash)
      : hasProfilePasswordConfigured(role, accountSession.accountId);

    if (!profileHasPassword && firstLaunchRequired) {
      const nextSession = createSession(
        role,
        accountSession.email,
        Date.now(),
        profile.displayName,
        accountSession.accountId,
        profile.permissions
      );
      storeSession(nextSession);
      recordInternalProfileUsed(role, undefined, accountSession.accountId);
      if (persistentProfile) {
        await internalProfileRepository.recordUsed(accountSession.accountId, persistentProfile.id);
        await auditLogService.write({
          accountId: accountSession.accountId,
          action: "auth.profile_login",
          category: "authentification",
          internalProfileId: persistentProfile.id,
          internalProfileRole: role,
          message: `Connexion du profil ${role} réussie.`
        });
      }
      setSession(nextSession);

      return { ok: true };
    }

    if (!profileHasPassword) {
      return { ok: false, message: "Ce profil n'a pas encore de mot de passe. Demandez à l'Admin de le configurer." };
    }

    if (!password.trim()) {
      return { ok: false, message: "Entrez le mot de passe du profil." };
    }

    const isValid = persistentProfile
      ? (await hashProfilePassword(role, password)) === persistentProfile.password_hash
      : await verifyDevelopmentPassword(role, password, accountSession.accountId);

    if (!isValid) {
      return { ok: false, message: "Mot de passe incorrect." };
    }

    const nextSession = createSession(
      role,
      accountSession.email,
      Date.now(),
      profile.displayName,
      accountSession.accountId,
      profile.permissions
    );
    storeSession(nextSession);
    recordInternalProfileUsed(role, undefined, accountSession.accountId);
    if (persistentProfile) {
      await internalProfileRepository.recordUsed(accountSession.accountId, persistentProfile.id);
      await auditLogService.write({
        accountId: accountSession.accountId,
        action: "auth.profile_login",
        category: "authentification",
        internalProfileId: persistentProfile.id,
        internalProfileRole: role,
        message: `Connexion du profil ${role} réussie.`
      });
    }
    setSession(nextSession);

    return { ok: true };
  }, [accountSession, auditLogService, firstLaunchRequired, internalProfileRepository, isInitialized, isPersistent]);

  useEffect(() => {
    if (!accountSession && !session) {
      return undefined;
    }

    const events = ["click", "keydown", "mousemove", "focus"];
    const onActivity = () => touchSession();
    const interval = window.setInterval(() => {
      if (accountSession && isMainAccountSessionExpired(accountSession)) {
        void logoutAccount();
        return;
      }

      if (session && isSessionExpired(session)) {
        logoutProfile();
      }
    }, 15_000);

    events.forEach((eventName) => window.addEventListener(eventName, onActivity));

    return () => {
      window.clearInterval(interval);
      events.forEach((eventName) => window.removeEventListener(eventName, onActivity));
    };
  }, [accountSession, logoutAccount, logoutProfile, session, touchSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accountSession,
      firstLaunchRequired,
      isAuthenticated: Boolean(session),
      isMainAuthenticated: Boolean(accountSession),
      isSubscriptionActive: Boolean(saasAccount?.subscription.is_active),
      isSubscriptionChecked,
      loginAccount,
      loginProfile,
      logout: logoutAccount,
      logoutAccount,
      logoutProfile,
      session,
      saasAccount,
      refreshSaasAccount,
      switchOrganization: selectOrganization,
      touchSession,
      refreshAccountSession: refreshAccountSessionFromStorage,
      userCan: (permission) => Boolean(session?.permissions.includes(permission)),
      userCanAny: (permissions = []) =>
        Boolean(session && (permissions.length === 0 || permissions.some((permission) => session.permissions.includes(permission))))
    }),
    [
      accountSession,
      firstLaunchRequired,
      isSubscriptionChecked,
      loginAccount,
      loginProfile,
      logoutAccount,
      logoutProfile,
      refreshAccountSessionFromStorage,
      refreshSaasAccount,
      selectOrganization,
      saasAccount,
      session,
      touchSession
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth doit être utilisé dans AuthProvider.");
  }

  return context;
}

function mainAccountRecordFromDatabase(record: {
  company_name: string | null;
  created_at: string;
  display_name: string | null;
  email: string;
  id: string;
  last_login_at: string | null;
  password_hash: string;
  phone: string | null;
  status: MainAccountRecord["status"];
  updated_at: string;
}): MainAccountRecord {
  return {
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
}

function profileConfigFromDatabase(record: InternalProfileRecord, accountId: string) {
  let permissions: Permission[] = [];
  try {
    const parsed = JSON.parse(record.permissions_json) as unknown;
    if (Array.isArray(parsed)) {
      permissions = parsed.filter((item): item is Permission => typeof item === "string");
    }
  } catch {
    permissions = [];
  }

  return {
    accountId,
    displayName: record.display_name,
    id: record.id,
    isEnabled: record.is_enabled === 1,
    lastUsedAt: record.last_used_at,
    permissions,
    role: record.role
  };
}
