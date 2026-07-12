import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthSession, MainAccountSession, Permission, UserRole } from "../../domain/auth";
import {
  clearMainAccountSession,
  clearStoredSession,
  createMainAccountSession,
  createSession,
  getFirstLaunchRequired,
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
  storeMainAccountSession,
  storeSession,
  verifyMainAccount,
  verifyDevelopmentPassword
} from "../../services/auth";

type LoginResult = {
  ok: boolean;
  message?: string;
};

type AuthContextValue = {
  accountSession: MainAccountSession | null;
  firstLaunchRequired: boolean;
  isAuthenticated: boolean;
  isMainAuthenticated: boolean;
  loginAccount: (email: string, password: string) => Promise<LoginResult>;
  loginProfile: (role: UserRole, password: string) => Promise<LoginResult>;
  logout: () => void;
  logoutAccount: () => void;
  logoutProfile: () => void;
  session: AuthSession | null;
  touchSession: () => void;
  refreshAccountSession: () => void;
  userCan: (permission: Permission) => boolean;
  userCanAny: (permissions?: Permission[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const logoutProfile = useCallback(() => {
    clearStoredSession();
    setSession(null);
  }, []);

  const logoutAccount = useCallback(() => {
    clearStoredSession();
    clearMainAccountSession();
    setSession(null);
    setAccountSession(null);
  }, []);

  const refreshAccountSessionFromStorage = useCallback(() => {
    const stored = readMainAccountSession();
    setAccountSession(stored);
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

      const refreshed = refreshSession(current);
      storeSession(refreshed);
      return refreshed;
    });
  }, []);

  const loginAccount = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    if (!email.trim() || !password.trim()) {
      return { ok: false, message: "Entrez l'email et le mot de passe." };
    }

    const isValid = await verifyMainAccount(email, password);

    if (!isValid) {
      return { ok: false, message: "Compte principal ou mot de passe incorrect." };
    }

    recordMainAccountLogin(email);
    const nextAccountSession = createMainAccountSession(email);
    storeMainAccountSession(nextAccountSession);
    setAccountSession(nextAccountSession);
    clearStoredSession();
    setSession(null);

    return { ok: true };
  }, []);

  const loginProfile = useCallback(async (role: UserRole, password: string): Promise<LoginResult> => {
    if (!accountSession) {
      return { ok: false, message: "Connectez d'abord le compte principal." };
    }

    if (!isInternalProfileEnabled(role, accountSession.accountId)) {
      return { ok: false, message: "Ce profil est désactivé." };
    }

    const profile = findInternalProfile(role, accountSession.accountId);
    const profileHasPassword = hasProfilePasswordConfigured(role, accountSession.accountId);

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
      setSession(nextSession);

      return { ok: true };
    }

    if (!profileHasPassword) {
      return { ok: false, message: "Ce profil n'a pas encore de mot de passe. Demandez à l'Admin de le configurer." };
    }

    if (!password.trim()) {
      return { ok: false, message: "Entrez le mot de passe du profil." };
    }

    const isValid = await verifyDevelopmentPassword(role, password, accountSession.accountId);

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
    setSession(nextSession);

    return { ok: true };
  }, [accountSession, firstLaunchRequired]);

  useEffect(() => {
    if (!accountSession && !session) {
      return undefined;
    }

    const events = ["click", "keydown", "mousemove", "focus"];
    const onActivity = () => touchSession();
    const interval = window.setInterval(() => {
      if (accountSession && isMainAccountSessionExpired(accountSession)) {
        logoutAccount();
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
      loginAccount,
      loginProfile,
      logout: logoutAccount,
      logoutAccount,
      logoutProfile,
      session,
      touchSession,
      refreshAccountSession: refreshAccountSessionFromStorage,
      userCan: (permission) => Boolean(session?.permissions.includes(permission)),
      userCanAny: (permissions = []) =>
        Boolean(session && (permissions.length === 0 || permissions.some((permission) => session.permissions.includes(permission))))
    }),
    [
      accountSession,
      firstLaunchRequired,
      loginAccount,
      loginProfile,
      logoutAccount,
      logoutProfile,
      refreshAccountSessionFromStorage,
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
