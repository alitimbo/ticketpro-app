import type { Permission, UserRole } from "../../domain/auth";
import { permissionsByRole, roleLabels } from "./permissions";

export type InternalProfileConfig = {
  accountId: string;
  displayName: string;
  id: string;
  isEnabled: boolean;
  lastUsedAt: string | null;
  permissions: Permission[];
  role: UserRole;
};

export type InternalProfileLog = {
  accountId: string;
  action: string;
  createdAt: string;
  internalProfileId: string | null;
  id: string;
  role: UserRole;
  userMessage: string;
};

export const internalProfilesStorageKey = "hotspot:internal_profiles";
export const internalProfileLogsStorageKey = "hotspot:internal_profile_logs";
export const internalProfileOrder: UserRole[] = ["admin", "operator", "agent", "guest"];

export const permissionSummaryByRole: Record<UserRole, string[]> = {
  admin: ["Accès complet", "Paramètres", "Abonnement", "Factures"],
  operator: ["Tickets", "Impression", "Fichiers", "Rapports"],
  agent: ["Création tickets", "Mes lots", "Rapport limité"],
  guest: ["Consultation", "Tickets en lecture", "Rapport en lecture"]
};

const developmentAccountId = "account-douma-demo";

export function loadInternalProfiles(accountId = resolveCurrentAccountId()): InternalProfileConfig[] {
  const defaults = createDefaultInternalProfiles(accountId);

  if (typeof localStorage === "undefined") {
    return defaults;
  }

  try {
    const raw = JSON.parse(localStorage.getItem(internalProfilesStorageKey) ?? "{}") as
      | Partial<InternalProfileConfig>[]
      | Record<string, Partial<InternalProfileConfig>[]>;
    const stored = Array.isArray(raw) ? raw : raw[accountId] ?? [];

    return defaults.map((profile) => {
      const saved = stored.find((item) => item.role === profile.role);

      return {
        ...profile,
        displayName: saved?.displayName?.trim() || profile.displayName,
        isEnabled: typeof saved?.isEnabled === "boolean" ? saved.isEnabled : profile.isEnabled,
        lastUsedAt: saved?.lastUsedAt ?? profile.lastUsedAt,
        permissions: Array.isArray(saved?.permissions) ? saved.permissions : profile.permissions
      };
    });
  } catch {
    return defaults;
  }
}

export function saveInternalProfiles(profiles: InternalProfileConfig[], accountId = resolveCurrentAccountId()): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const directory = readProfileDirectory();
  localStorage.setItem(
    internalProfilesStorageKey,
    JSON.stringify({
      ...directory,
      [accountId]: profiles.map((profile) => normalizeProfile(profile, accountId))
    })
  );
}

export function findInternalProfile(role: UserRole, accountId = resolveCurrentAccountId()): InternalProfileConfig {
  return loadInternalProfiles(accountId).find((profile) => profile.role === role) ?? createDefaultInternalProfiles(accountId).find((profile) => profile.role === role)!;
}

export function canDisableInternalProfile(profiles: InternalProfileConfig[], role: UserRole): boolean {
  if (role !== "admin") {
    return true;
  }

  return profiles.filter((profile) => profile.role === "admin" && profile.isEnabled).length > 1;
}

export function setInternalProfileEnabled(
  profiles: InternalProfileConfig[],
  role: UserRole,
  isEnabled: boolean
): { message?: string; profiles: InternalProfileConfig[]; success: boolean } {
  if (!isEnabled && !canDisableInternalProfile(profiles, role)) {
    return {
      message: "Impossible de désactiver le dernier profil Admin actif.",
      profiles,
      success: false
    };
  }

  return {
    profiles: profiles.map((profile) => (profile.role === role ? { ...profile, isEnabled } : profile)),
    success: true
  };
}

export function updateInternalProfileDisplayName(
  profiles: InternalProfileConfig[],
  role: UserRole,
  displayName: string
): InternalProfileConfig[] {
  return profiles.map((profile) =>
    profile.role === role
      ? {
          ...profile,
          displayName: displayName.trim() || roleLabels[role]
        }
      : profile
  );
}

export function recordInternalProfileUsed(
  role: UserRole,
  now = new Date().toISOString(),
  accountId = resolveCurrentAccountId()
): void {
  const profiles = loadInternalProfiles(accountId).map((profile) =>
    profile.role === role ? { ...profile, lastUsedAt: now } : profile
  );
  saveInternalProfiles(profiles, accountId);
}

export function isInternalProfileEnabled(role: UserRole, accountId = resolveCurrentAccountId()): boolean {
  return findInternalProfile(role, accountId).isEnabled;
}

export function getInternalProfilePermissions(role: UserRole): Permission[] {
  return permissionsByRole[role];
}

export function appendInternalProfileLog(input: {
  accountId: string;
  action: string;
  internalProfileId?: string | null;
  role: UserRole;
  userMessage: string;
}): InternalProfileLog {
  const log: InternalProfileLog = {
    accountId: input.accountId,
    action: input.action,
    createdAt: new Date().toISOString(),
    internalProfileId: input.internalProfileId ?? null,
    id: `internal-profile-log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: input.role,
    userMessage: input.userMessage
  };

  if (typeof localStorage !== "undefined") {
    const logs = readAllInternalProfileLogs();
    localStorage.setItem(internalProfileLogsStorageKey, JSON.stringify([log, ...logs].slice(0, 200)));
  }

  return log;
}

export function readInternalProfileLogs(accountId = resolveCurrentAccountId()): InternalProfileLog[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    return readAllInternalProfileLogs().filter((log) => log.accountId === accountId);
  } catch {
    return [];
  }
}

function readAllInternalProfileLogs(): InternalProfileLog[] {
  try {
    return JSON.parse(localStorage.getItem(internalProfileLogsStorageKey) ?? "[]") as InternalProfileLog[];
  } catch {
    return [];
  }
}

function createDefaultInternalProfiles(accountId: string): InternalProfileConfig[] {
  return internalProfileOrder.map((role) => ({
    accountId,
    displayName: roleLabels[role],
    id: `${accountId}:internal-profile-${role}`,
    isEnabled: true,
    lastUsedAt: null,
    permissions: [...permissionsByRole[role]],
    role
  }));
}

function normalizeProfile(profile: InternalProfileConfig, accountId: string): InternalProfileConfig {
  return {
    ...profile,
    accountId,
    id: `${accountId}:internal-profile-${profile.role}`,
    permissions: [...profile.permissions]
  };
}

function readProfileDirectory(): Record<string, Partial<InternalProfileConfig>[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(internalProfilesStorageKey) ?? "{}") as
      | Partial<InternalProfileConfig>[]
      | Record<string, Partial<InternalProfileConfig>[]>;
    return Array.isArray(raw) ? { [resolveCurrentAccountId()]: raw } : raw;
  } catch {
    return {};
  }
}

function resolveCurrentAccountId(): string {
  if (typeof localStorage === "undefined") {
    return developmentAccountId;
  }

  try {
    const session = JSON.parse(localStorage.getItem("hotspot:main_account_session") ?? "null") as { accountId?: string } | null;
    return session?.accountId ?? developmentAccountId;
  } catch {
    return developmentAccountId;
  }
}
