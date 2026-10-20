import crypto from "node:crypto";

const DAY_MS = 86_400_000;

const paymentMethodLabels = {
  amanata: "Amanata",
  mobile: "Mobile Money",
  nita_online: "NITA en ligne"
};

/**
 * One invoice per subscription payment that succeeded and was fulfilled.
 * Everything comes from the payment itself (amount, pack, duration) so an
 * invoice never changes when the subscription is renewed or extended later.
 */
export function buildOrganizationInvoice(order, { organizationName, customerEmail, periodStart } = {}) {
  const paidAt = order.paid_at ?? order.fulfilled_at ?? order.created_at;
  const startsAt = periodStart ?? paidAt;
  const durationDays = Number(order.duration_days) || 0;
  const endsAt = Number.isFinite(Date.parse(startsAt)) && durationDays > 0
    ? new Date(Date.parse(startsAt) + durationDays * DAY_MS).toISOString()
    : null;
  const unlimitedDevices = order.device_limit_mode === "unlimited";
  return {
    id: order.id,
    invoice_number: invoiceNumber(order.id, paidAt),
    status: "paid",
    issued_at: paidAt,
    paid_at: paidAt,
    currency: order.currency || "XOF",
    amount: Number(order.amount) || 0,
    plan: {
      code: order.plan_code,
      name: order.plan_name
    },
    router_limit: Number(order.router_limit) || 0,
    device_limit_mode: unlimitedDevices ? "unlimited" : "limited",
    max_devices: unlimitedDevices ? null : Number(order.max_devices) || 1,
    duration_days: durationDays,
    period_start: startsAt,
    period_end: endsAt,
    customer: {
      organization_name: organizationName ?? "",
      name: order.customer_name ?? "",
      email: customerEmail ?? ""
    },
    payment: {
      method: order.payment_type,
      method_label: paymentMethodLabels[order.payment_type] ?? "Paiement en ligne",
      phone_masked: maskPhone(order.msisdn),
      reference: order.provider_public_reference || order.transaction_id || order.id
    }
  };
}

/** Stable number derived from the payment: FAC-AAAAMM-XXXXXX. */
export function invoiceNumber(orderId, paidAt) {
  const date = new Date(Number.isFinite(Date.parse(paidAt)) ? paidAt : 0);
  const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = crypto.createHash("sha256").update(String(orderId)).digest("hex").slice(0, 6).toUpperCase();
  return `FAC-${month}-${suffix}`;
}

/** Keeps only the last 4 digits of the paying number. */
export function maskPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `**** ${digits.slice(-4)}`;
}
