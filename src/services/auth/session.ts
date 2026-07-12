import type { AuthSession, UserRole } from "../../domain/auth";
import { permissionsByRole, roleLabels } from "./permissions";

export const authSessionKey = "hotspot:auth_session";
export const sessionTimeoutMs = 30 * 60 * 1000;
const appSettingsStorageKey = "hotspot:app_settings";
const developmentMainAccountEmail = "doumacorporation@gmail.com";
const developmentMainAccountId = "account-douma-demo";

function resolveSessionAccountId(accountEmail: string): string {
  const normalizedEmail = accountEmail.trim().toLowerCase();

  return normalizedEmail === developmentMainAccountEmail ? developmentMainAccountId : `account-${normalizedEmail}`;
}

export function getConfiguredSessionTimeoutMs(): number {
  if (typeof localStorage === "undefined") {
    return sessionTimeoutMs;
  }

  try {
    const settings = JSON.parse(localStorage.getItem(appSettingsStorageKey) ?? "{}") as {
      sessionTimeoutMinutes?: number;
    };
    const minutes = Number(settings.sessionTimeoutMinutes);

    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      return sessionTimeoutMs;
    }

    return minutes * 60 * 1000;
  } catch {
    return sessionTimeoutMs;
  }
}

export function createSession(
  role: UserRole,
  accountEmail = "",
  now = Date.now(),
  label = roleLabels[role],
  accountId = resolveSessionAccountId(accountEmail),
  permissions = permissionsByRole[role]
): AuthSession {
  const timeoutMs = getConfiguredSessionTimeoutMs();

  return {
    account_id: accountId,
    account_email: accountEmail,
    internal_profile_id: `${accountId}:internal-profile-${role}`,
    internal_profile_role: role,
    internal_profile_label: label,
    permissions: [...permissions],
    created_at: now,
    last_activity_at: now,
    expires_at: now + timeoutMs
  };
}

export function isSessionExpired(session: AuthSession, now = Date.now()): boolean {
  return session.expires_at <= now || now - session.last_activity_at >= getConfiguredSessionTimeoutMs();
}

export function refreshSession(session: AuthSession, now = Date.now()): AuthSession {
  const timeoutMs = getConfiguredSessionTimeoutMs();

  return {
    ...session,
    last_activity_at: now,
    expires_at: now + timeoutMs
  };
}

export function readStoredSession(): AuthSession | null {
  const value = localStorage.getItem(authSessionKey);

  if (!value) {
    return null;
  }

  try {
    const session = normalizeStoredSession(JSON.parse(value) as Partial<AuthSession> & Record<string, unknown>);

    if (!session) {
      localStorage.removeItem(authSessionKey);
      return null;
    }

    if (isSessionExpired(session)) {
      localStorage.removeItem(authSessionKey);
      return null;
    }

    storeSession(session);
    return session;
  } catch {
    localStorage.removeItem(authSessionKey);
    return null;
  }
}

export function storeSession(session: AuthSession): void {
  localStorage.setItem(authSessionKey, JSON.stringify(session));
}

export function clearStoredSession(): void {
  localStorage.removeItem(authSessionKey);
}

function normalizeStoredSession(value: Partial<AuthSession> & Record<string, unknown>): AuthSession | null {
  const legacyRole = value.role as UserRole | undefined;
  const role = value.internal_profile_role ?? legacyRole;
  const accountEmail = value.account_email ?? (value.accountEmail as string | undefined) ?? "";
  const accountId = value.account_id ?? (value.accountId as string | undefined) ?? resolveSessionAccountId(accountEmail);

  if (!role || !accountId || !accountEmail) {
    return null;
  }

  const legacyProfileId = value.profileId as string | undefined;
  const baseProfileId = value.internal_profile_id ?? legacyProfileId ?? `internal-profile-${role}`;
  const internalProfileId = baseProfileId.includes(":") ? baseProfileId : `${accountId}:${baseProfileId}`;

  return {
    account_id: accountId,
    account_email: accountEmail,
    internal_profile_id: internalProfileId,
    internal_profile_role: role,
    internal_profile_label: value.internal_profile_label ?? (value.label as string | undefined) ?? roleLabels[role],
    permissions: Array.isArray(value.permissions) ? value.permissions : [...permissionsByRole[role]],
    created_at: value.created_at ?? (value.createdAt as number | undefined) ?? Date.now(),
    last_activity_at: value.last_activity_at ?? (value.lastActivityAt as number | undefined) ?? Date.now(),
    expires_at: value.expires_at ?? (value.expiresAt as number | undefined) ?? Date.now() + getConfiguredSessionTimeoutMs()
  };
}
