import type { AuthSession, Permission } from "../../domain/auth";

export class AuthorizationError extends Error {
  constructor(
    public readonly permission: Permission,
    message = "Vous n'avez pas la permission d'effectuer cette action."
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requireProfilePermission(session: AuthSession | null | undefined, permission: Permission): AuthSession {
  if (!session || !session.permissions.includes(permission)) {
    throw new AuthorizationError(permission);
  }

  return session;
}

export function canUseProfilePermission(session: AuthSession | null | undefined, permission: Permission): boolean {
  return Boolean(session?.permissions.includes(permission));
}

export function getProfileIdForAudit(session: AuthSession | null | undefined): string | null {
  return session?.internal_profile_id ?? null;
}
