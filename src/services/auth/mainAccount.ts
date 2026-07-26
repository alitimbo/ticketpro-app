import type { MainAccountRecord, MainAccountSession } from "../../domain/auth";
import { getConfiguredSessionTimeoutMs } from "./session";

const MAIN_ACCOUNT_HASH_SALT = "hotspot-manager-main-account-v1";
const developmentMainAccount: MainAccountRecord = {
  companyName: "Douma Corporation",
  createdAt: "2026-07-01T00:00:00.000Z",
  displayName: "Douma Corporation",
  email: "doumacorporation@gmail.com",
  id: "account-douma-demo",
  lastLoginAt: null,
  passwordHash: "c82cac2bde74b84c9705468afab1cc9f33b62fba4114475fe3eed7db1a4f7121",
  phone: "",
  status: "active",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

export const mainAccountSessionKey = "hotspot:main_account_session";
export const mainAccountRecordKey = "hotspot:main_account_record";
export const mainAccountRecordsKey = "hotspot:main_account_records";
export const accountSecurityLogKey = "hotspot:account_security_logs";

export type MainAccountSecurityLog = {
  accountId: string;
  createdAt: string;
  id: string;
  internalProfileId: string | null;
  message: string;
};

export function resolveMainAccountId(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const saved = readMainAccountRecords().find((account) => account.email === normalizedEmail);

  if (saved?.email === normalizedEmail) {
    return saved.id;
  }

  return normalizedEmail === developmentMainAccount.email ? developmentMainAccount.id : `account-${normalizedEmail}`;
}

export async function hashMainAccountPassword(email: string, password: string): Promise<string> {
  const input = `${MAIN_ACCOUNT_HASH_SALT}:${email.trim().toLowerCase()}:${password}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyMainAccount(email: string, password: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = readMainAccountRecord(normalizedEmail);

  if (!account || normalizedEmail !== account.email) {
    return false;
  }

  if (account.status === "suspended" || account.status === "expired") {
    return false;
  }

  return (await hashMainAccountPassword(normalizedEmail, password)) === account.passwordHash;
}

export function createMainAccountSession(email: string, now = Date.now()): MainAccountSession {
  const timeoutMs = getConfiguredSessionTimeoutMs();
  const account = readMainAccountRecord(email) ?? developmentMainAccount;

  return {
    accountId: account.id,
    companyLabel: account.companyName || account.displayName || account.email,
    createdAt: now,
    email: email.trim().toLowerCase(),
    expiresAt: now + timeoutMs,
    lastActivityAt: now
  };
}

export function isMainAccountSessionExpired(session: MainAccountSession, now = Date.now()): boolean {
  return session.expiresAt <= now || now - session.lastActivityAt >= getConfiguredSessionTimeoutMs();
}

export function refreshMainAccountSession(session: MainAccountSession, now = Date.now()): MainAccountSession {
  return {
    ...session,
    expiresAt: now + getConfiguredSessionTimeoutMs(),
    lastActivityAt: now
  };
}

export function readMainAccountSession(): MainAccountSession | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const value = localStorage.getItem(mainAccountSessionKey);

  if (!value) {
    return null;
  }

  try {
    const session = JSON.parse(value) as MainAccountSession;

    if (isMainAccountSessionExpired(session)) {
      localStorage.removeItem(mainAccountSessionKey);
      return null;
    }

    return {
      ...session,
      accountId: session.accountId ?? resolveMainAccountId(session.email)
    };
  } catch {
    localStorage.removeItem(mainAccountSessionKey);
    return null;
  }
}

export function readMainAccountRecord(email = ""): MainAccountRecord | null {
  const normalizedEmail = email.trim().toLowerCase();
  const saved = readSavedMainAccountRecord();

  if (saved && (!normalizedEmail || saved.email === normalizedEmail)) {
    return saved;
  }

  const accountFromDirectory = readMainAccountRecords().find((account) => account.email === normalizedEmail);

  if (accountFromDirectory) {
    return accountFromDirectory;
  }

  if (!normalizedEmail || normalizedEmail === developmentMainAccount.email) {
    return developmentMainAccount;
  }

  return null;
}

export function saveMainAccountRecord(account: MainAccountRecord): MainAccountRecord {
  const normalized = normalizeMainAccountRecord(account);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(mainAccountRecordKey, JSON.stringify(normalized));
    saveMainAccountRecords(upsertMainAccount(readMainAccountRecords(), normalized));
  }

  return normalized;
}

export function readMainAccountRecords(): MainAccountRecord[] {
  if (typeof localStorage === "undefined") {
    return [developmentMainAccount];
  }

  const accounts = new Map<string, MainAccountRecord>();
  accounts.set(developmentMainAccount.id, developmentMainAccount);

  const savedSingle = readSavedMainAccountRecord();

  if (savedSingle) {
    accounts.set(savedSingle.id, savedSingle);
  }

  try {
    const stored = JSON.parse(localStorage.getItem(mainAccountRecordsKey) ?? "[]") as Partial<MainAccountRecord>[];
    stored.map(normalizeMainAccountRecord).forEach((account) => accounts.set(account.id, account));
  } catch {
    localStorage.removeItem(mainAccountRecordsKey);
  }

  return Array.from(accounts.values()).sort((left, right) => left.email.localeCompare(right.email));
}

export function saveMainAccountDirectoryRecord(account: MainAccountRecord): MainAccountRecord {
  const normalized = normalizeMainAccountRecord(account);

  if (typeof localStorage !== "undefined") {
    saveMainAccountRecords(upsertMainAccount(readMainAccountRecords(), normalized));
  }

  return normalized;
}

export function updateMainAccountDetails(input: {
  companyName: string;
  displayName: string;
  email: string;
  phone: string;
}): MainAccountRecord {
  const current = readMainAccountRecord(input.email) ?? developmentMainAccount;

  return saveMainAccountRecord({
    ...current,
    companyName: input.companyName.trim(),
    displayName: input.displayName.trim(),
    phone: input.phone.trim(),
    updatedAt: new Date().toISOString()
  });
}

export async function changeMainAccountPassword(input: {
  email: string;
  newPassword: string;
  oldPassword: string;
}): Promise<{ ok: boolean; message: string }> {
  const account = readMainAccountRecord(input.email);

  if (!account) {
    return { ok: false, message: "Compte principal introuvable." };
  }

  if (!input.oldPassword.trim() || !input.newPassword.trim()) {
    return { ok: false, message: "Entrez l'ancien et le nouveau mot de passe." };
  }

  const oldPasswordValid = await verifyMainAccount(account.email, input.oldPassword);

  if (!oldPasswordValid) {
    return { ok: false, message: "Ancien mot de passe incorrect." };
  }

  if (input.newPassword.length < 6) {
    return { ok: false, message: "Le nouveau mot de passe doit contenir au moins 6 caractères." };
  }

  saveMainAccountRecord({
    ...account,
    passwordHash: await hashMainAccountPassword(account.email, input.newPassword),
    updatedAt: new Date().toISOString()
  });

  return { ok: true, message: "Mot de passe principal mis à jour." };
}

export function recordMainAccountLogin(email: string, now = new Date().toISOString()): MainAccountRecord | null {
  const account = readMainAccountRecord(email);

  if (!account) {
    return null;
  }

  return saveMainAccountRecord({
    ...account,
    lastLoginAt: now,
    updatedAt: now
  });
}

export function appendAccountSecurityLog(input: {
  accountId: string;
  internalProfileId?: string | null;
  message: string;
}): MainAccountSecurityLog {
  const log: MainAccountSecurityLog = {
    accountId: input.accountId,
    createdAt: new Date().toISOString(),
    id: `security-${crypto.randomUUID()}`,
    internalProfileId: input.internalProfileId ?? null,
    message: input.message
  };

  if (typeof localStorage !== "undefined") {
    const current = readAccountSecurityLogs();
    localStorage.setItem(accountSecurityLogKey, JSON.stringify([log, ...current].slice(0, 100)));
  }

  return log;
}

export function readAccountSecurityLogs(): MainAccountSecurityLog[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    return JSON.parse(localStorage.getItem(accountSecurityLogKey) ?? "[]") as MainAccountSecurityLog[];
  } catch {
    localStorage.removeItem(accountSecurityLogKey);
    return [];
  }
}

export function storeMainAccountSession(session: MainAccountSession): void {
  localStorage.setItem(mainAccountSessionKey, JSON.stringify(session));
}

export function clearMainAccountSession(): void {
  localStorage.removeItem(mainAccountSessionKey);
}

function normalizeMainAccountRecord(input: Partial<MainAccountRecord>): MainAccountRecord {
  const email = input.email?.trim().toLowerCase() || developmentMainAccount.email;

  return {
    ...developmentMainAccount,
    ...input,
    companyName: input.companyName ?? developmentMainAccount.companyName,
    displayName: input.displayName ?? developmentMainAccount.displayName,
    email,
    id: input.id ?? resolveStoredMainAccountId(email),
    lastLoginAt: input.lastLoginAt ?? developmentMainAccount.lastLoginAt,
    passwordHash: input.passwordHash ?? developmentMainAccount.passwordHash,
    phone: input.phone ?? developmentMainAccount.phone,
    status: input.status ?? developmentMainAccount.status
  };
}

function readSavedMainAccountRecord(): MainAccountRecord | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(mainAccountRecordKey);
    return raw ? normalizeMainAccountRecord(JSON.parse(raw) as Partial<MainAccountRecord>) : null;
  } catch {
    localStorage.removeItem(mainAccountRecordKey);
    return null;
  }
}

function resolveStoredMainAccountId(email: string): string {
  return email === developmentMainAccount.email ? developmentMainAccount.id : `account-${email}`;
}

function saveMainAccountRecords(accounts: MainAccountRecord[]): void {
  localStorage.setItem(mainAccountRecordsKey, JSON.stringify(accounts.map(normalizeMainAccountRecord)));
}

function upsertMainAccount(accounts: MainAccountRecord[], account: MainAccountRecord): MainAccountRecord[] {
  const next = new Map(accounts.map((item) => [item.id, item]));
  next.set(account.id, account);
  return Array.from(next.values());
}
