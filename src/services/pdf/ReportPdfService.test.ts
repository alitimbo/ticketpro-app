import { describe, expect, it } from "vitest";
import { generateReportPdf } from "./ReportPdfService";

describe("ReportPdfService", () => {
  it("génère un PDF ouvrable avec les lignes du rapport", () => {
    const pdf = generateReportPdf({
      generatedAt: "2026-07-16 10:00",
      rows: [
        {
          code: "ABC123",
          createdAt: "2026-07-16",
          operator: "Opérateur",
          plan: "3 heures",
          priceLabel: "200 CFA",
          router: "Routeur principal",
          status: "disponible"
        }
      ],
      summary: ["Tickets créés: 1"],
      title: "Rapport TicketPro"
    });

    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Rapport TicketPro");
    expect(text).toContain("ABC123");
  });
});
