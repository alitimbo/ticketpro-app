import { describe, expect, it } from "vitest";
import { generateInvoicePdf } from "./InvoicePdfService";

describe("InvoicePdfService", () => {
  it("génère un PDF simple de facture logiciel", () => {
    const pdf = generateInvoicePdf({
      accountEmail: "doumacorporation@gmail.com",
      accountName: "Douma Corporation",
      amountLabel: "1 500 CFA",
      dueAtLabel: "01/08/2026",
      invoiceNumber: "FAC-2026-0001",
      issuedAtLabel: "01/07/2026",
      notes: "Facture abonnement logiciel.",
      packName: "Pack 1 routeur",
      paidAtLabel: "Non renseignée",
      periodLabel: "01/07/2026 au 01/08/2026",
      routerLimit: 1,
      statusLabel: "Émise"
    });
    const text = new TextDecoder().decode(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Facture abonnement logiciel");
    expect(text).toContain("FAC-2026-0001");
    expect(text).toContain("Douma Corporation");
    expect(text).toContain("Pack 1 routeur");
    expect(text).toContain("Paiement en ligne");
  });
});
