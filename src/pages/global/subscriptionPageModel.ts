import type { RouterCardData } from "./routerPageModel";
import type {
  AccountSubscriptionRecord,
  BillingInvoiceRecord,
  SubscriptionPlanRecord
} from "../../domain/database";
import type { SaasSubscription } from "../../services/saas";

export type SubscriptionStatus = "active" | "cancelled" | "expired" | "suspended" | "trial";
export type SubscriptionPaymentStatus = "manual" | "paid" | "pending" | "unpaid";

export type SubscriptionPlan = {
  billingPeriod: "monthly" | "yearly";
  description: string;
  id: string;
  isActive: boolean;
  isRecommended: boolean;
  name: string;
  priceCfa: number | null;
  pricePerRouterCfa: number | null;
  routerLimit: number;
};

export type AccountSubscription = {
  currentPeriodEnd: string;
  currentPeriodStart: string;
  paymentStatus: SubscriptionPaymentStatus;
  planId: string;
  priceCfaSnapshot: number | null;
  pricePerRouterCfaSnapshot: number | null;
  routerLimitSnapshot: number;
  status: SubscriptionStatus;
};

export type BillingInvoice = {
  amountCfa: number;
  dueAt: string;
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  notes: string | null;
  packName: string;
  paidAt: string | null;
  periodEnd: string;
  periodStart: string;
  routerLimit: number;
  status: "cancelled" | "draft" | "issued" | "overdue" | "paid";
};

export type SubscriptionOverview = {
  canAddRouter: boolean;
  invoices: BillingInvoice[];
  isOverLimit: boolean;
  paymentStatusLabel: string;
  plan: SubscriptionPlan;
  plans: SubscriptionPlan[];
  routerUsagePercent: number;
  routersUsed: number;
  statusLabel: string;
  subscription: AccountSubscription;
};

const subscriptionStorageKey = "hotspot:account_subscription";
const invoicesStorageKey = "hotspot:billing_invoices";
const accountSubscriptionsStorageKey = "hotspot:account_subscriptions_by_account";
const accountInvoicesStorageKey = "hotspot:billing_invoices_by_account";
const mainAccountSessionStorageKey = "hotspot:main_account_session";

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    billingPeriod: "monthly",
    description: "Idéal pour un seul site WiFi ou une petite zone.",
    id: "subscription-plan-1-router",
    isActive: true,
    isRecommended: false,
    name: "Pack 1 routeur",
    priceCfa: 1500,
    pricePerRouterCfa: 1500,
    routerLimit: 1
  },
  {
    billingPeriod: "monthly",
    description: "Adapté aux petits exploitants qui gèrent plusieurs zones WiFi.",
    id: "subscription-plan-5-routers",
    isActive: true,
    isRecommended: true,
    name: "Pack 5 routeurs",
    priceCfa: 6000,
    pricePerRouterCfa: 1200,
    routerLimit: 5
  },
  {
    billingPeriod: "monthly",
    description: "Pour les gérants en croissance ou les techniciens qui suivent plusieurs clients.",
    id: "subscription-plan-10-routers",
    isActive: true,
    isRecommended: false,
    name: "Pack 10 routeurs",
    priceCfa: 10000,
    pricePerRouterCfa: 1000,
    routerLimit: 10
  },
  {
    billingPeriod: "monthly",
    description: "Pour les réseaux multi-sites, techniciens et exploitants avancés.",
    id: "subscription-plan-50-routers",
    isActive: true,
    isRecommended: false,
    name: "Pack 50 routeurs",
    priceCfa: 40000,
    pricePerRouterCfa: 800,
    routerLimit: 50
  },
  {
    billingPeriod: "monthly",
    description: "Pour les gros exploitants, revendeurs ou gestionnaires de nombreux sites.",
    id: "subscription-plan-100-routers",
    isActive: true,
    isRecommended: false,
    name: "Pack 100 routeurs",
    priceCfa: 70000,
    pricePerRouterCfa: 700,
    routerLimit: 100
  }
];

export const defaultAccountSubscription: AccountSubscription = {
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  currentPeriodStart: "2026-07-01T00:00:00.000Z",
  paymentStatus: "manual",
  planId: "subscription-plan-1-router",
  priceCfaSnapshot: 1500,
  pricePerRouterCfaSnapshot: 1500,
  routerLimitSnapshot: 1,
  status: "active"
};

export const defaultInvoices: BillingInvoice[] = [
  {
    amountCfa: 1500,
    dueAt: "2026-08-01T00:00:00.000Z",
    id: "invoice-demo-001",
    invoiceNumber: "FAC-2026-0001",
    issuedAt: "2026-07-01T00:00:00.000Z",
    notes: "Facture de démonstration pour l'abonnement logiciel.",
    packName: "Pack 1 routeur",
    paidAt: null,
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z",
    routerLimit: 1,
    status: "issued"
  }
];

export function loadAccountSubscription(accountId = resolveCurrentAccountId()): AccountSubscription {
  if (typeof localStorage === "undefined") {
    return defaultAccountSubscription;
  }

  try {
    const scopedSubscription = accountId ? readAccountSubscriptions()[accountId] : null;
    const legacySubscription = JSON.parse(localStorage.getItem(subscriptionStorageKey) ?? "{}") as Partial<AccountSubscription>;
    return normalizeAccountSubscription(scopedSubscription ?? legacySubscription);
  } catch {
    return defaultAccountSubscription;
  }
}

/**
 * Last subscription confirmed by the TicketPro server for this account, used
 * only while the server cannot be reached. Access stays bounded by the end
 * date the server sent (grace included); nothing is extended locally, and an
 * account never confirmed on this device gets no offline access.
 */
export function cachedSubscriptionAllowsAccess(accountId: string | null | undefined, now = Date.now()): boolean {
  if (typeof localStorage === "undefined" || !accountId) return false;
  const cached = readAccountSubscriptions()[accountId];
  if (!cached) return false;
  const accessEndsAt = Date.parse(cached.currentPeriodEnd);
  return (cached.status === "active" || cached.status === "trial")
    && Number.isFinite(accessEndsAt)
    && accessEndsAt > now;
}

export function saveAccountSubscription(subscription: AccountSubscription, accountId = resolveCurrentAccountId()): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const normalized = normalizeAccountSubscription(subscription);
  const currentAccountId = resolveCurrentAccountId();

  if (accountId) {
    localStorage.setItem(
      accountSubscriptionsStorageKey,
      JSON.stringify({
        ...readAccountSubscriptions(),
        [accountId]: normalized
      })
    );
  }

  if (!accountId || accountId === currentAccountId) {
    localStorage.setItem(subscriptionStorageKey, JSON.stringify(normalized));
  }
}

export function loadBillingInvoices(accountId = resolveCurrentAccountId()): BillingInvoice[] {
  if (typeof localStorage === "undefined") {
    return defaultInvoices;
  }

  try {
    const scopedInvoices = accountId ? readAccountInvoices()[accountId] : null;

    if (scopedInvoices && scopedInvoices.length > 0) {
      return scopedInvoices.map(normalizeBillingInvoice);
    }

    const saved = JSON.parse(localStorage.getItem(invoicesStorageKey) ?? "[]") as BillingInvoice[];
    return saved.length > 0 ? saved.map(normalizeBillingInvoice) : defaultInvoices;
  } catch {
    return defaultInvoices;
  }
}

export function saveBillingInvoices(invoices: BillingInvoice[], accountId = resolveCurrentAccountId()): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const normalized = invoices.map(normalizeBillingInvoice);
  const currentAccountId = resolveCurrentAccountId();

  if (accountId) {
    localStorage.setItem(
      accountInvoicesStorageKey,
      JSON.stringify({
        ...readAccountInvoices(),
        [accountId]: normalized
      })
    );
  }

  if (!accountId || accountId === currentAccountId) {
    localStorage.setItem(invoicesStorageKey, JSON.stringify(normalized));
  }
}

function normalizeAccountSubscription(subscription: Partial<AccountSubscription> | null | undefined): AccountSubscription {
  return {
    ...defaultAccountSubscription,
    ...(subscription ?? {})
  };
}

function normalizeBillingInvoice(invoice: BillingInvoice): BillingInvoice {
  return {
    ...defaultInvoices[0],
    ...invoice,
    notes: invoice.notes ?? null,
    paidAt: invoice.paidAt ?? null,
    packName: invoice.packName ?? defaultInvoices[0].packName,
    periodEnd: invoice.periodEnd ?? invoice.dueAt,
    periodStart: invoice.periodStart ?? invoice.issuedAt,
    routerLimit: invoice.routerLimit ?? defaultInvoices[0].routerLimit
  };
}

export function countRoutersForSubscription(routers: RouterCardData[]): number {
  return routers.filter((router) => router.subscriptionCounted !== false).length;
}

export function canAddRouterForSubscription(
  subscription: AccountSubscription,
  routersUsed: number,
  now = Date.now()
): boolean {
  const hasActiveAccess = subscription.status === "active" || subscription.status === "trial";
  const periodEnd = new Date(subscription.currentPeriodEnd).getTime();
  const periodIsValid = Number.isFinite(periodEnd) && periodEnd > now;

  return hasActiveAccess && periodIsValid && routersUsed < subscription.routerLimitSnapshot;
}

export function getSubscriptionOverview(
  routersUsed: number,
  accountId?: string,
  now = Date.now(),
  saasSubscription?: SaasSubscription | null
): SubscriptionOverview {
  const cachedSubscription = loadAccountSubscription(accountId);
  const currentSubscription = saasSubscription
    ? subscriptionFromSaas(saasSubscription, cachedSubscription)
    : cachedSubscription;
  const currentPlan = saasSubscription
    ? subscriptionPlanFromSaas(saasSubscription, currentSubscription)
    : null;
  const plans = currentPlan
    ? [currentPlan, ...subscriptionPlans.filter((plan) => plan.id !== currentPlan.id)]
    : subscriptionPlans;

  return buildSubscriptionOverview(
    currentSubscription,
    plans,
    loadBillingInvoices(accountId),
    routersUsed,
    now
  );
}

export function buildSubscriptionOverview(
  subscription: AccountSubscription,
  plans: SubscriptionPlan[],
  invoices: BillingInvoice[],
  routersUsed: number,
  now = Date.now()
): SubscriptionOverview {
  const plan = plans.find((item) => item.id === subscription.planId) ?? plans[0] ?? subscriptionPlans[0];
  const limit = subscription.routerLimitSnapshot || plan.routerLimit;
  const routerUsagePercent = Math.min(100, Math.round((routersUsed / Math.max(1, limit)) * 100));

  return {
    canAddRouter: canAddRouterForSubscription({ ...subscription, routerLimitSnapshot: limit }, routersUsed, now),
    invoices,
    isOverLimit: routersUsed > limit,
    paymentStatusLabel: paymentStatusLabel(subscription.paymentStatus),
    plan,
    plans,
    routerUsagePercent,
    routersUsed,
    statusLabel: subscriptionStatusLabel(subscription.status),
    subscription
  };
}

export function subscriptionFromRecord(record: AccountSubscriptionRecord): AccountSubscription {
  return {
    currentPeriodEnd: record.current_period_end,
    currentPeriodStart: record.current_period_start,
    paymentStatus: record.payment_status,
    planId: record.subscription_plan_id,
    priceCfaSnapshot: record.price_cfa_snapshot,
    pricePerRouterCfaSnapshot: record.price_per_router_cfa_snapshot,
    routerLimitSnapshot: record.router_limit_snapshot,
    status: record.status
  };
}

export function subscriptionPlanFromRecord(record: SubscriptionPlanRecord): SubscriptionPlan {
  return {
    billingPeriod: record.billing_period,
    description: record.description ?? "",
    id: record.id,
    isActive: record.is_active === 1,
    isRecommended: record.is_recommended === 1,
    name: record.name,
    priceCfa: record.price_cfa,
    pricePerRouterCfa: record.price_per_router_cfa,
    routerLimit: record.router_limit
  };
}

export function invoiceFromRecord(record: BillingInvoiceRecord, packName: string, routerLimit: number): BillingInvoice {
  return {
    amountCfa: record.amount_cfa,
    dueAt: record.due_at ?? record.issued_at ?? record.created_at,
    id: record.id,
    invoiceNumber: record.invoice_number,
    issuedAt: record.issued_at ?? record.created_at,
    notes: record.notes,
    // The invoice's own snapshot wins; the current subscription is only a
    // fallback for invoices issued before snapshots existed.
    packName: record.pack_name ?? packName,
    paidAt: record.paid_at,
    periodEnd: record.period_end ?? record.due_at ?? record.created_at,
    periodStart: record.period_start ?? record.issued_at ?? record.created_at,
    routerLimit: record.router_limit ?? routerLimit,
    status: record.status
  };
}

export function changeSubscriptionPlan(planId: string, accountId?: string): AccountSubscription {
  const plan = subscriptionPlans.find((item) => item.id === planId);

  if (!plan) {
    throw new Error("Pack introuvable.");
  }

  const next: AccountSubscription = {
    ...loadAccountSubscription(accountId),
    paymentStatus: "manual",
    planId: plan.id,
    priceCfaSnapshot: plan.priceCfa,
    pricePerRouterCfaSnapshot: plan.pricePerRouterCfa,
    routerLimitSnapshot: plan.routerLimit,
    status: "active"
  };
  saveAccountSubscription(next, accountId);

  return next;
}

export function markSubscriptionPaymentManual(accountId?: string): AccountSubscription {
  const next: AccountSubscription = {
    ...loadAccountSubscription(accountId),
    paymentStatus: "manual",
    status: "active"
  };
  saveAccountSubscription(next, accountId);

  return next;
}

export function updateSubscriptionStatus(
  status: SubscriptionStatus,
  paymentStatus: SubscriptionPaymentStatus,
  accountId?: string
): AccountSubscription {
  const next: AccountSubscription = {
    ...loadAccountSubscription(accountId),
    paymentStatus,
    status
  };
  saveAccountSubscription(next, accountId);

  return next;
}

export function formatCfa(value: number | null): string {
  if (value === null) {
    return "Prix à définir";
  }

  return `${new Intl.NumberFormat("fr-FR").format(value)} CFA`;
}

/**
 * Convertit l'abonnement de l'organisation active en snapshot local. Le SaaS
 * reste prioritaire tant qu'il est joignable ; ce snapshot sert au mode hors ligne.
 */
export function subscriptionFromSaas(
  subscription: SaasSubscription,
  fallback: AccountSubscription = defaultAccountSubscription
): AccountSubscription {
  const routerLimit = Math.max(0, Number(subscription.router_limit) || 0);
  const priceCfa = subscription.plan?.price_cfa ?? fallback.priceCfaSnapshot;

  return {
    currentPeriodEnd:
      subscription.access_ends_at
      ?? subscription.current_period_end
      ?? (subscription.is_active ? "9999-12-31T23:59:59.999Z" : fallback.currentPeriodEnd),
    currentPeriodStart: subscription.current_period_start ?? fallback.currentPeriodStart,
    paymentStatus: subscription.is_trial ? "pending" : subscription.is_active ? "paid" : "unpaid",
    planId: subscription.plan?.id ?? fallback.planId,
    priceCfaSnapshot: priceCfa,
    pricePerRouterCfaSnapshot:
      priceCfa === null || routerLimit < 1 ? null : Math.round(priceCfa / routerLimit),
    routerLimitSnapshot: routerLimit,
    status: mapSaasSubscriptionStatus(subscription)
  };
}

export function subscriptionPlanFromSaas(
  subscription: SaasSubscription,
  snapshot = subscriptionFromSaas(subscription)
): SubscriptionPlan {
  return {
    billingPeriod: "monthly",
    description: "Abonnement de l'organisation active, vérifié par TicketPro.",
    id: snapshot.planId,
    isActive: subscription.is_active,
    isRecommended: false,
    name: subscription.plan?.name ?? "Abonnement TicketPro",
    priceCfa: snapshot.priceCfaSnapshot,
    pricePerRouterCfa: snapshot.pricePerRouterCfaSnapshot,
    routerLimit: snapshot.routerLimitSnapshot
  };
}

function mapSaasSubscriptionStatus(subscription: SaasSubscription): SubscriptionStatus {
  if (subscription.is_active) {
    return subscription.is_trial ? "trial" : "active";
  }

  if (subscription.status === "cancelled") return "cancelled";
  return "expired";
}

export function formatPlanDuration(durationDays: number): string {
  return `${durationDays} jour${durationDays > 1 ? "s" : ""}`;
}

export function formatSubscriptionPeriod(start: string, end: string): string {
  return `${formatDate(start)} au ${formatDate(end)}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function billingPeriodLabel(period: SubscriptionPlan["billingPeriod"]): string {
  return period === "monthly" ? "mois" : "an";
}

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  const labels: Record<SubscriptionStatus, string> = {
    active: "Actif",
    cancelled: "Annulé",
    expired: "Expiré",
    suspended: "Suspendu",
    trial: "Essai"
  };

  return labels[status];
}

export function paymentStatusLabel(status: SubscriptionPaymentStatus): string {
  const labels: Record<SubscriptionPaymentStatus, string> = {
    manual: "Manuel",
    paid: "Payé",
    pending: "En attente",
    unpaid: "Impayé"
  };

  return labels[status];
}

function resolveCurrentAccountId(): string | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }

  try {
    const session = JSON.parse(localStorage.getItem(mainAccountSessionStorageKey) ?? "null") as { accountId?: string } | null;
    return session?.accountId;
  } catch {
    return undefined;
  }
}

function readAccountSubscriptions(): Record<string, AccountSubscription> {
  try {
    return JSON.parse(localStorage.getItem(accountSubscriptionsStorageKey) ?? "{}") as Record<string, AccountSubscription>;
  } catch {
    localStorage.removeItem(accountSubscriptionsStorageKey);
    return {};
  }
}

function readAccountInvoices(): Record<string, BillingInvoice[]> {
  try {
    return JSON.parse(localStorage.getItem(accountInvoicesStorageKey) ?? "{}") as Record<string, BillingInvoice[]>;
  } catch {
    localStorage.removeItem(accountInvoicesStorageKey);
    return {};
  }
}
