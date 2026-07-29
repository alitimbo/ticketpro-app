import { describe, expect, it } from "vitest";
import { generateReportPdf } from "./ReportPdfService";

describe("ReportPdfService", () => {
  it("génère un PDF ouvrable avec les lignes du rapport", () => {
    const pdf = generateReportPdf({
      generatedAt: "2026-07-16 10:00",
      rows: Array.from({ length: 29 }, (_, index) => ({
          code: "ABC123",
          createdAt: "2026-07-16",
          operator: "Opérateur",
          plan: "3 heures",
          priceLabel: "200 CFA",
          router: "Routeur principal",
          status: index === 0 ? "disponible" : "activé"
        })),
      summary: Array.from({ length: 9 }, (_, index) => `Résumé ${index + 1}`),
      title: "Rapport TicketPro"
    });

    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Rapport TicketPro");
    expect(text).toContain("ABC123");
    expect(text).toContain("(Profil)");
    expect(text).toContain("(Operateur)");
    expect(text).toContain("(200 CFA)");
    expect(text).toContain("/Count 2");
    expect(text).toContain("(Resume 9)");
  });
});
