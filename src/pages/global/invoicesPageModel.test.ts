import { afterEach, describe, expect, it } from "vitest";
import {
  cancelInvoice,
  createManualInvoice,
  getInvoiceDetail,
  invoiceStatusBadge,
  invoiceStatusLabel,
  listInvoices,
  markInvoicePaid
} from "./invoicesPageModel";

describe("invoicesPageModel", () => {
  afterEach(() => {
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:billing_invoices");
  });

  it("liste les factures d'abonnement logiciel par défaut", () => {
    const invoices = listInvoices();

    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      amountCfa: 1500,
      invoiceNumber: "FAC-2026-0001",
      packName: "Pack 1 routeur",
      routerLimit: 1
    });
  });

  it("crée une facture manuelle en brouillon", () => {
    const invoices = createManualInvoice(new Date("2026-07-10T10:00:00.000Z"));

    expect(invoices[0]).toMatchObject({
      amountCfa: 1500,
      packName: "Pack 1 routeur",
      status: "draft"
    });
    expect(invoices[0].invoiceNumber).toContain("FAC-20260710");
  });

  it("marque une facture payée puis expose son détail", () => {
    markInvoicePaid("invoice-demo-001", "2026-07-12T00:00:00.000Z");

    const detail = getInvoiceDetail("invoice-demo-001");

    expect(detail?.invoice.status).toBe("paid");
    expect(detail?.invoice.paidAt).toBe("2026-07-12T00:00:00.000Z");
    expect(detail?.accountEmail).toBe("doumacorporation@gmail.com");
    expect(invoiceStatusLabel("paid")).toBe("Payée");
    expect(invoiceStatusBadge("paid")).toBe("success");
  });

  it("annule une facture non payée", () => {
    cancelInvoice("invoice-demo-001");

    expect(getInvoiceDetail("invoice-demo-001")?.invoice.status).toBe("cancelled");
  });
});
