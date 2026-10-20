import type { AppStatus } from "../../shared/ui";
import type { InvoicePdfInput } from "../../services/pdf";
import type { SaasInvoice } from "../../services/saas";
import { formatDate, type BillingInvoice } from "./subscriptionPageModel";

export type InvoiceStatus = BillingInvoice["status"];

/** Used by the internal administration tools only. */
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

/** "60 000 FCFA" — XOF is the West African CFA franc. */
export function formatInvoiceAmount(amount: number, currency = "XOF"): string {
  const unit = currency === "XOF" ? "FCFA" : currency;
  return `${new Intl.NumberFormat("fr-FR").format(amount)} ${unit}`;
}

/** 365 → "1 an", 30 → "1 mois", 7 → "7 jours". */
export function formatSubscriptionDuration(days: number): string {
  if (days > 0 && days % 365 === 0) return days === 365 ? "1 an" : `${days / 365} ans`;
  if (days > 0 && days % 30 === 0) return `${days / 30} mois`;
  return `${days} jour${days > 1 ? "s" : ""}`;
}

export function formatInvoicePeriod(invoice: Pick<SaasInvoice, "period_end" | "period_start">): string {
  return invoice.period_end
    ? `Du ${formatDate(invoice.period_start)} au ${formatDate(invoice.period_end)}`
    : `À partir du ${formatDate(invoice.period_start)}`;
}

/** "10 routeurs · 3 postes · 1 an" */
export function describeInvoiceSubscription(
  invoice: Pick<SaasInvoice, "device_limit_mode" | "duration_days" | "max_devices" | "router_limit">
): string {
  const routers = `${invoice.router_limit} routeur${invoice.router_limit > 1 ? "s" : ""}`;
  const devices = invoice.device_limit_mode === "unlimited" || invoice.max_devices === null
    ? "postes illimités"
    : `${invoice.max_devices} poste${invoice.max_devices > 1 ? "s" : ""}`;
  return [routers, devices, formatSubscriptionDuration(invoice.duration_days)].join(" · ");
}

export function invoicePdfFileName(invoice: Pick<SaasInvoice, "invoice_number">): string {
  return `Facture-TicketPro-${invoice.invoice_number}.pdf`;
}

export function invoicePdfInput(invoice: SaasInvoice): InvoicePdfInput {
  return {
    amountLabel: formatInvoiceAmount(invoice.amount, invoice.currency),
    customerEmail: invoice.customer.email,
    customerName: invoice.customer.name,
    description: `Abonnement TicketPro — ${invoice.plan.name}`,
    details: describeInvoiceSubscription(invoice),
    invoiceNumber: invoice.invoice_number,
    issuedAtLabel: formatDate(invoice.issued_at),
    organizationName: invoice.customer.organization_name,
    paidAtLabel: formatDate(invoice.paid_at),
    paymentMethod: invoice.payment.phone_masked
      ? `${invoice.payment.method_label} (${invoice.payment.phone_masked})`
      : invoice.payment.method_label,
    paymentReference: invoice.payment.reference,
    periodLabel: formatInvoicePeriod(invoice)
  };
}
