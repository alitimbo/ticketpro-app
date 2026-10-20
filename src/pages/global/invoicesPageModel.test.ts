import { describe, expect, it } from "vitest";
import type { SaasInvoice } from "../../services/saas";
import {
  describeInvoiceSubscription,
  formatInvoiceAmount,
  formatInvoicePeriod,
  formatSubscriptionDuration,
  invoicePdfFileName,
  invoicePdfInput,
  invoiceStatusBadge,
  invoiceStatusLabel
} from "./invoicesPageModel";

export const ultraInvoice: SaasInvoice = {
  amount: 60000,
  currency: "XOF",
  customer: { email: "owner@example.com", name: "Moussa Ali", organization_name: "WiFi Zone Niamey" },
  device_limit_mode: "limited",
  duration_days: 365,
  id: "order-1",
  invoice_number: "FAC-202610-A1B2C3",
  issued_at: "2026-10-01T09:30:00.000Z",
  max_devices: 3,
  paid_at: "2026-10-01T09:30:00.000Z",
  payment: { method: "mobile", method_label: "Mobile Money", phone_masked: "**** 9090", reference: "IPAY-REF-1" },
  period_end: "2027-10-01T09:30:00.000Z",
  period_start: "2026-10-01T09:30:00.000Z",
  plan: { code: "ULTRA-1Y", name: "Ultra" },
  router_limit: 10,
  status: "paid"
};

describe("factures des abonnements payés", () => {
  it("présente le montant, la durée, la période et le contenu de l'abonnement", () => {
    expect(formatInvoiceAmount(60000, "XOF").replace(/\s/g, " ")).toBe("60 000 FCFA");
    expect([7, 30, 90, 365, 730].map(formatSubscriptionDuration)).toEqual(["7 jours", "1 mois", "3 mois", "1 an", "2 ans"]);
    expect(formatInvoicePeriod(ultraInvoice)).toBe("Du 01/10/2026 au 01/10/2027");
    expect(describeInvoiceSubscription(ultraInvoice)).toBe("10 routeurs · 3 postes · 1 an");
    expect(describeInvoiceSubscription({ ...ultraInvoice, device_limit_mode: "unlimited", max_devices: null, router_limit: 1 }))
      .toBe("1 routeur · postes illimités · 1 an");
    expect(invoicePdfFileName(ultraInvoice)).toBe("Facture-TicketPro-FAC-202610-A1B2C3.pdf");
  });

  it("prépare le PDF avec le paiement et un numéro masqué", () => {
    expect(invoicePdfInput(ultraInvoice)).toMatchObject({
      description: "Abonnement TicketPro — Ultra",
      details: "10 routeurs · 3 postes · 1 an",
      invoiceNumber: "FAC-202610-A1B2C3",
      organizationName: "WiFi Zone Niamey",
      paymentMethod: "Mobile Money (**** 9090)",
      paymentReference: "IPAY-REF-1",
      periodLabel: "Du 01/10/2026 au 01/10/2027"
    });
  });

  it("garde les libellés de statut des outils d'administration", () => {
    expect(invoiceStatusLabel("paid")).toBe("Payée");
    expect(invoiceStatusBadge("paid")).toBe("success");
  });
});
