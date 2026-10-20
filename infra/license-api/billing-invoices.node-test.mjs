import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrganizationInvoice, invoiceNumber, maskPhone } from "./billing-invoices.mjs";

const order = {
  id: "order-ultra-1",
  transaction_id: "TX-1",
  provider_public_reference: "IPAY-REF-1",
  plan_code: "ULTRA-1Y",
  plan_name: "Ultra",
  router_limit: 10,
  max_devices: 3,
  device_limit_mode: "limited",
  duration_days: 365,
  amount: 60000,
  currency: "XOF",
  msisdn: "22790909090",
  customer_name: "Client Ultra",
  payment_type: "mobile",
  paid_at: "2026-10-01T09:30:00.000Z",
  created_at: "2026-10-01T09:29:00.000Z"
};

test("une facture reprend le paiement lui-même : pack, montant, période achetée", () => {
  const invoice = buildOrganizationInvoice(order, {
    customerEmail: "owner@example.com",
    organizationName: "WiFi Zone",
    periodStart: "2026-10-05T00:00:00.000Z"
  });
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.amount, 60000);
  assert.equal(invoice.plan.name, "Ultra");
  assert.equal(invoice.router_limit, 10);
  assert.equal(invoice.max_devices, 3);
  assert.equal(invoice.period_start, "2026-10-05T00:00:00.000Z");
  assert.equal(invoice.period_end, "2027-10-05T00:00:00.000Z");
  assert.equal(invoice.payment.method_label, "Mobile Money");
  assert.equal(invoice.payment.phone_masked, "**** 9090");
  assert.equal(invoice.payment.reference, "IPAY-REF-1");
  assert.equal(invoice.customer.organization_name, "WiFi Zone");
  assert.equal(JSON.stringify(invoice).includes("22790909090"), false);
});

test("le numéro de facture est stable et ne dépend que du paiement", () => {
  assert.equal(invoiceNumber("order-ultra-1", order.paid_at), invoiceNumber("order-ultra-1", order.paid_at));
  assert.match(invoiceNumber("order-ultra-1", order.paid_at), /^FAC-202610-[0-9A-F]{6}$/);
  assert.notEqual(invoiceNumber("order-ultra-1", order.paid_at), invoiceNumber("order-ultra-2", order.paid_at));
});

test("postes illimités et numéro trop court sont présentés sans valeur inventée", () => {
  const invoice = buildOrganizationInvoice({ ...order, device_limit_mode: "unlimited", msisdn: "12" });
  assert.equal(invoice.max_devices, null);
  assert.equal(invoice.payment.phone_masked, "");
  assert.equal(maskPhone(null), "");
});
