import type { AppStatus } from "../../shared/ui";
import {
  billingPeriodLabel,
  formatCfa,
  formatDate,
  formatSubscriptionPeriod,
  loadAccountSubscription,
  loadBillingInvoices,
  saveBillingInvoices,
  subscriptionPlans,
  type BillingInvoice
} from "./subscriptionPageModel";

export type InvoiceStatus = BillingInvoice["status"];

export type InvoiceDetail = {
  accountEmail: string;
  accountName: string;
  invoice: BillingInvoice;
  packName: string;
  periodLabel: string;
};

export const demoBillingAccount = {
  email: "doumacorporation@gmail.com",
  name: "Douma Corporation"
};

export function listInvoices(): BillingInvoice[] {
  return loadBillingInvoices().sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
}

export function getInvoiceDetail(invoiceId: string): InvoiceDetail | null {
  const invoice = listInvoices().find((item) => item.id === invoiceId);

  if (!invoice) {
    return null;
  }

  return {
    accountEmail: demoBillingAccount.email,
    accountName: demoBillingAccount.name,
    invoice,
    packName: invoice.packName,
    periodLabel: formatSubscriptionPeriod(invoice.periodStart, invoice.periodEnd)
  };
}

export function markInvoicePaid(invoiceId: string, paidAt = new Date().toISOString()): BillingInvoice[] {
  const invoices = listInvoices().map((invoice) =>
    invoice.id === invoiceId && invoice.status !== "cancelled"
      ? {
          ...invoice,
          paidAt,
          status: "paid" as const
        }
      : invoice
  );
  saveBillingInvoices(invoices);
  return invoices;
}

export function cancelInvoice(invoiceId: string): BillingInvoice[] {
  const invoices = listInvoices().map((invoice) =>
    invoice.id === invoiceId && invoice.status !== "paid"
      ? {
          ...invoice,
          status: "cancelled" as const
        }
      : invoice
  );
  saveBillingInvoices(invoices);
  return invoices;
}

export function createManualInvoice(now = new Date()): BillingInvoice[] {
  const subscription = loadAccountSubscription();
  const plan = subscriptionPlans.find((item) => item.id === subscription.planId) ?? subscriptionPlans[0];
  const id = `invoice-manual-${now.getTime()}`;
  const invoice: BillingInvoice = {
    amountCfa: subscription.priceCfaSnapshot ?? plan.priceCfa ?? 0,
    dueAt: subscription.currentPeriodEnd,
    id,
    invoiceNumber: buildInvoiceNumber(now),
    issuedAt: now.toISOString(),
    notes: "Facture manuelle d'abonnement logiciel.",
    packName: plan.name,
    paidAt: null,
    periodEnd: subscription.currentPeriodEnd,
    periodStart: subscription.currentPeriodStart,
    routerLimit: subscription.routerLimitSnapshot || plan.routerLimit,
    status: "draft"
  };
  const invoices = [invoice, ...listInvoices()];
  saveBillingInvoices(invoices);
  return invoices;
}

export function buildInvoiceNumber(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const suffix = String(date.getTime()).slice(-4);
  return `FAC-${year}${month}${day}-${suffix}`;
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  const labels: Record<InvoiceStatus, string> = {
    cancelled: "Annulée",
    draft: "Brouillon",
    issued: "Émise",
    overdue: "En retard",
    paid: "Payée"
  };

  return labels[status];
}

export function invoiceStatusBadge(status: InvoiceStatus): AppStatus {
  const badges: Record<InvoiceStatus, AppStatus> = {
    cancelled: "offline",
    draft: "active",
    issued: "warning",
    overdue: "error",
    paid: "success"
  };

  return badges[status];
}

export function formatInvoiceAmount(invoice: BillingInvoice): string {
  return `${formatCfa(invoice.amountCfa)} / ${billingPeriodLabel("monthly")}`;
}

export function formatInvoicePeriod(invoice: BillingInvoice): string {
  return formatSubscriptionPeriod(invoice.periodStart, invoice.periodEnd);
}

export function formatInvoiceDate(value: string | null): string {
  return value ? formatDate(value) : "Non renseignée";
}
