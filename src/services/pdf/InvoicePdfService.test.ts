import { describe, expect, it } from "vitest";
import { generateInvoicePdf, type InvoicePdfInput } from "./InvoicePdfService";

const input: InvoicePdfInput = {
  amountLabel: "60 000 FCFA",
  customerEmail: "owner@example.com",
  customerName: "Moussa Ali",
  description: "Abonnement TicketPro — Ultra",
  details: "10 routeurs · 3 postes · 1 an",
  invoiceNumber: "FAC-202610-A1B2C3",
  issuedAtLabel: "01/10/2026",
  organizationName: "WiFi Zone Niamey",
  paidAtLabel: "01/10/2026",
  paymentMethod: "Mobile Money (**** 9090)",
  paymentReference: "IPAY-REF-1",
  periodLabel: "Du 01/10/2026 au 01/10/2027"
};

describe("PDF de facture d'abonnement", () => {
  it("contient l'en-tête, le client, la ligne d'abonnement, le total et le paiement, accents compris", () => {
    const text = new TextDecoder("latin1").decode(generateInvoicePdf(input));

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/WinAnsiEncoding");
    for (const expected of [
      "TicketPro", "FACTURE", "FAC-202610-A1B2C3", "WiFi Zone Niamey", "owner@example.com",
      "60 000 FCFA", "Du 01/10/2026 au 01/10/2027", "IPAY-REF-1", "Mobile Money \\(**** 9090\\)"
    ]) {
      expect(text).toContain(expected);
    }
    // "PAYÉE" and "Total payé" keep their accent (WinAnsi É = \311, é = \351).
    expect(text).toContain("PAY\\311E");
    expect(text).toContain("Total pay\\351");
  });

  it("raccourcit un nom trop long au lieu de déborder sur la colonne voisine", () => {
    const text = new TextDecoder("latin1").decode(generateInvoicePdf({
      ...input,
      organizationName: "Organisation au nom vraiment très très long pour une seule ligne de facture"
    }));
    expect(text).toContain("...");
  });
});
