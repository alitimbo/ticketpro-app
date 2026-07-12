import type { MainAccountRecord, MainAccountStatus } from "../../domain/auth";
import {
  appendAccountSecurityLog,
  readMainAccountRecords,
  saveMainAccountDirectoryRecord
} from "../../services/auth";
import {
  formatCfa,
  loadAccountSubscription,
  loadBillingInvoices,
  saveBillingInvoices,
  subscriptionPlans,
  updateSubscriptionStatus,
  changeSubscriptionPlan,
  type AccountSubscription,
  type BillingInvoice,
  type SubscriptionPaymentStatus,
  type SubscriptionPlan,
  type SubscriptionStatus
} from "../global/subscriptionPageModel";
import { buildInvoiceNumber } from "../global/invoicesPageModel";

const superAdminSalt = "hotspot-manager-local-super-admin-dev-v1";
export const superAdminConfigKey = "hotspot:dev_super_admin_config";
export const superAdminSessionKey = "hotspot:dev_super_admin_session";

export type SuperAdminConfig = {
  enabled: boolean;
  passwordHash: string | null;
};

export type SuperAdminSession = {
  createdAt: number;
  expiresAt: number;
};

export type SuperAdminAccountOverview = {
  account: MainAccountRecord;
  invoices: BillingInvoice[];
  invoiceCount: number;
  lastInvoice: BillingInvoice | null;
  plan: SubscriptionPlan;
  subscription: AccountSubscription;
};

export const emptySuperAdminConfig: SuperAdminConfig = {
  enabled: false,
  passwordHash: null
};

export function isSuperAdminAvailable(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function readSuperAdminConfig(): SuperAdminConfig {
  if (typeof localStorage === "undefined") {
    return emptySuperAdminConfig;
  }

  try {
    return {
      ...emptySuperAdminConfig,
      ...JSON.parse(localStorage.getItem(superAdminConfigKey) ?? "{}")
    };
  } catch {
    localStorage.removeItem(superAdminConfigKey);
    return emptySuperAdminConfig;
  }
}

export async function activateSuperAdmin(password: string): Promise<{ ok: boolean; message: string }> {
  if (!isSuperAdminAvailable()) {
    return { ok: false, message: "Mode Super Admin disponible uniquement en développement." };
  }

  if (password.length < 8) {
    return { ok: false, message: "Le mot de passe Super Admin doit contenir au moins 8 caractères." };
  }

  localStorage.setItem(
    superAdminConfigKey,
    JSON.stringify({
      enabled: true,
      passwordHash: await hashSuperAdminPassword(password)
    })
  );

  return { ok: true, message: "Mode Super Admin développement activé." };
}

export function deactivateSuperAdmin(): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(superAdminConfigKey, JSON.stringify(emptySuperAdminConfig));
  localStorage.removeItem(superAdminSessionKey);
}

export async function verifySuperAdminPassword(password: string): Promise<boolean> {
  const config = readSuperAdminConfig();

  if (!isSuperAdminAvailable() || !config.enabled || !config.passwordHash) {
    return false;
  }

  return (await hashSuperAdminPassword(password)) === config.passwordHash;
}

export function createSuperAdminSession(now = Date.now()): SuperAdminSession {
  const session: SuperAdminSession = {
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000
  };
  sessionStorage.setItem(superAdminSessionKey, JSON.stringify(session));
  return session;
}

export function readSuperAdminSession(now = Date.now()): SuperAdminSession | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const session = JSON.parse(sessionStorage.getItem(superAdminSessionKey) ?? "null") as SuperAdminSession | null;

    if (!session || session.expiresAt <= now) {
      sessionStorage.removeItem(superAdminSessionKey);
      return null;
    }

    return session;
  } catch {
    sessionStorage.removeItem(superAdminSessionKey);
    return null;
  }
}

export function listSuperAdminAccounts(): SuperAdminAccountOverview[] {
  return readMainAccountRecords().map((account) => {
    const subscription = loadAccountSubscription(account.id);
    const plan = subscriptionPlans.find((item) => item.id === subscription.planId) ?? subscriptionPlans[0];
    const invoices = loadBillingInvoices(account.id);

    return {
      account,
      invoices,
      invoiceCount: invoices.length,
      lastInvoice: invoices[0] ?? null,
      plan,
      subscription
    };
  });
}

export function updateAccountPlanForDevelopment(accountId: string, planId: string): AccountSubscription {
  const subscription = changeSubscriptionPlan(planId, accountId);
  appendAccountSecurityLog({
    accountId,
    message: "Pack modifié depuis le mode Super Admin développement."
  });
  return subscription;
}

export function updateAccountSubscriptionStatusForDevelopment(
  accountId: string,
  status: SubscriptionStatus,
  paymentStatus: SubscriptionPaymentStatus
): AccountSubscription {
  const subscription = updateSubscriptionStatus(status, paymentStatus, accountId);
  appendAccountSecurityLog({
    accountId,
    message: "Statut d'abonnement modifié depuis le mode Super Admin développement."
  });
  return subscription;
}

export function setAccountStatusForDevelopment(accountId: string, status: MainAccountStatus): MainAccountRecord {
  const account = readMainAccountRecords().find((item) => item.id === accountId);

  if (!account) {
    throw new Error("Compte introuvable.");
  }

  const next = saveMainAccountDirectoryRecord({
    ...account,
    status,
    updatedAt: new Date().toISOString()
  });
  appendAccountSecurityLog({
    accountId,
    message: status === "suspended" ? "Compte suspendu en mode développement." : "Compte réactivé en mode développement."
  });

  return next;
}

export function createInvoiceForDevelopment(accountId: string, now = new Date()): BillingInvoice[] {
  const subscription = loadAccountSubscription(accountId);
  const plan = subscriptionPlans.find((item) => item.id === subscription.planId) ?? subscriptionPlans[0];
  const invoice: BillingInvoice = {
    amountCfa: subscription.priceCfaSnapshot ?? plan.priceCfa ?? 0,
    dueAt: subscription.currentPeriodEnd,
    id: `invoice-super-admin-${accountId}-${now.getTime()}`,
    invoiceNumber: buildInvoiceNumber(now),
    issuedAt: now.toISOString(),
    notes: "Facture créée depuis le mode Super Admin développement.",
    packName: plan.name,
    paidAt: null,
    periodEnd: subscription.currentPeriodEnd,
    periodStart: subscription.currentPeriodStart,
    routerLimit: subscription.routerLimitSnapshot || plan.routerLimit,
    status: "draft"
  };
  const invoices = [invoice, ...loadBillingInvoices(accountId)];
  saveBillingInvoices(invoices, accountId);
  appendAccountSecurityLog({
    accountId,
    message: "Facture créée depuis le mode Super Admin développement."
  });

  return invoices;
}

export function markInvoicePaidForDevelopment(
  accountId: string,
  invoiceId: string,
  paidAt = new Date().toISOString()
): BillingInvoice[] {
  const invoices = loadBillingInvoices(accountId).map((invoice) =>
    invoice.id === invoiceId && invoice.status !== "cancelled"
      ? {
          ...invoice,
          paidAt,
          status: "paid" as const
        }
      : invoice
  );
  saveBillingInvoices(invoices, accountId);
  appendAccountSecurityLog({
    accountId,
    message: "Facture marquée payée depuis le mode Super Admin développement."
  });

  return invoices;
}

export function superAdminSubscriptionLabel(overview: SuperAdminAccountOverview): string {
  return `${overview.plan.name} - ${formatCfa(overview.subscription.priceCfaSnapshot)} / mois`;
}

async function hashSuperAdminPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${superAdminSalt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
