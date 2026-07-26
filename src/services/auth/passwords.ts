import type { UserRole } from "../../domain/auth";
import { roleLabels } from "./permissions";

const PASSWORD_HASH_SALT = "hotspot-manager-local-auth-v1";
const developmentAccountId = "account-douma-demo";

const developmentPasswordHashes: Record<UserRole, string> = {
  admin: "9ffcea3caee6f051052df3849808f6dae17469a14cab1a5c55e59d4a9f37ba2a",
  operator: "7a70d720fa2c11cfcc79e2a62c761079f7e5c1e1a38d80c16f0d03cbdf3b8e2b",
  agent: "5eb5817ce535bec90e2cbcf587591b259ef8ec6f3d2c7fa7d26611bd04b9fefc",
  guest: "57fe88bc34ce4f2b7e3e7b2bd951259b2cb96e410819f809fe28f71ea4e19f15"
};

export const firstLaunchFlagKey = "hotspot:first_launch";
export const profilePasswordHashesKey = "hotspot:profile_password_hashes";

export async function hashProfilePassword(role: UserRole, password: string): Promise<string> {
  const input = `${PASSWORD_HASH_SALT}:${role}:${password}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyDevelopmentPassword(
  role: UserRole,
  password: string,
  accountId = resolveCurrentAccountId()
): Promise<boolean> {
  const hash = await hashProfilePassword(role, password);
  const configuredHash = readProfilePasswordHashes(accountId)[role];
  const developmentHash = accountId === developmentAccountId ? developmentPasswordHashes[role] : undefined;

  return hash === (configuredHash ?? developmentHash);
}

export function hasProfilePasswordConfigured(role: UserRole, accountId = resolveCurrentAccountId()): boolean {
  const developmentHash = accountId === developmentAccountId && getFirstLaunchRequired() ? developmentPasswordHashes[role] : "";
  return Boolean(readProfilePasswordHashes(accountId)[role] ?? developmentHash);
}

export function readProfilePasswordHashes(accountId = resolveCurrentAccountId()): Partial<Record<UserRole, string>> {
  if (typeof localStorage === "undefined") {
    return {};
  }

  try {
    const raw = JSON.parse(localStorage.getItem(profilePasswordHashesKey) ?? "{}") as
      | Partial<Record<UserRole, string>>
      | Record<string, Partial<Record<UserRole, string>>>;
    const isLegacy = ["admin", "operator", "agent", "guest"].some((role) => role in raw);
    return isLegacy ? (raw as Partial<Record<UserRole, string>>) : (raw as Record<string, Partial<Record<UserRole, string>>>)[accountId] ?? {};
  } catch {
    return {};
  }
}

export function saveProfilePasswordHash(role: UserRole, hash: string, accountId = resolveCurrentAccountId()): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const directory = readPasswordHashDirectory();
  localStorage.setItem(
    profilePasswordHashesKey,
    JSON.stringify({ ...directory, [accountId]: { ...readProfilePasswordHashes(accountId), [role]: hash } })
  );
}

export function resetProfilePasswordHash(role: UserRole, accountId = resolveCurrentAccountId()): void {
  saveProfilePasswordHash(role, "", accountId);
}

export function getFirstLaunchRequired(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  return localStorage.getItem(firstLaunchFlagKey) !== "false";
}

export function markFirstLaunchCompleted(): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(firstLaunchFlagKey, "false");
}

export function getProfilePasswordSetupMessage(role: UserRole): string {
  return `Le profil ${roleLabels[role]} doit définir un vrai mot de passe au premier lancement réel.`;
}

function readPasswordHashDirectory(): Record<string, Partial<Record<UserRole, string>>> {
  try {
    const raw = JSON.parse(localStorage.getItem(profilePasswordHashesKey) ?? "{}") as
      | Partial<Record<UserRole, string>>
      | Record<string, Partial<Record<UserRole, string>>>;
    const isLegacy = ["admin", "operator", "agent", "guest"].some((role) => role in raw);
    return isLegacy
      ? { [resolveCurrentAccountId()]: raw as Partial<Record<UserRole, string>> }
      : (raw as Record<string, Partial<Record<UserRole, string>>>);
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
