import { describe, expect, it } from "vitest";
import {
  buildGeneratedTicketPdfRecord,
  generateTicketPdf,
  resolveTicketPdfPassword,
  type TicketPdfInput
} from "./TicketPdfService";

describe("TicketPdfService", () => {
  it("génère un PDF A4 lisible avec 28 tickets par page", () => {
    const input = buildPdfInput(41);
    const pdf = generateTicketPdf(input);
    const text = new TextDecoder().decode(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(text).toContain("/Count 2");
    expect(text).toContain("(Zone Centre)");
    expect(text).toContain("(LOGIN)");
    expect(text).toContain("(123001)");
    expect(text).not.toContain("(MOT DE PASSE)");
    expect(text).toContain("(Portail wifi.ticketpro.local)");
    expect(text).toContain("(Contact +227 90 12 34 56)");
    expect(text).not.toContain("(Lot ");
  });

  it("prépare l'enregistrement generated_files du lot", () => {
    const input = buildPdfInput(1);
    const record = buildGeneratedTicketPdfRecord(input);

    expect(record).toMatchObject({
      batch_id: "batch-test",
      file_name: "tickets-batch-test.pdf",
      file_path: "files/tickets-batch-test.pdf",
      format: "a4",
      id: "batch-test-pdf",
      metadata_json: expect.stringContaining('"format":"a4"'),
      router_id: "routeur-demo",
      type: "tickets_pdf"
    });
  });

  it("ne révèle le mot de passe que si le secret correspond au code", () => {
    expect(
      resolveTicketPdfPassword({
        passwordSecretRef: "secret://routeur-demo/123456/password",
        username: "123456"
      })
    ).toBe("123456");
    expect(
      resolveTicketPdfPassword({
        passwordSecretRef: "secret://vault/ticket/password",
        username: "123456"
      })
    ).toBe("******");
  });

  it("inclut un véritable QR code et le mot de passe distinct dans le PDF", () => {
    const input = buildPdfInput(1);
    input.qrCodeEnabled = true;
    input.tickets[0].password = "847295";
    const text = new TextDecoder().decode(generateTicketPdf(input));
    const filledModules = text.match(/ re f/g) ?? [];

    expect(text).toContain("(MOT DE PASSE)");
    expect(text).toContain("(847295)");
    expect(filledModules.length).toBeGreaterThan(80);
  });
});

function buildPdfInput(quantity: number): TicketPdfInput {
  return {
    accountId: "account-douma-demo",
    batchId: "batch-test",
    createdByProfile: "operator",
    createdByProfileId: "account-douma-demo:internal-profile-operator",
    dataLimitLabel: "2 Go",
    durationLabel: "3 h",
    fileName: "tickets-batch-test.pdf",
    format: "a4",
    generatedAt: "2026-07-08T20:00:00.000Z",
    hotspotAddress: "wifi.ticketpro.local",
    ownerPhone: "+227 90 12 34 56",
    planName: "3h-2Go",
    priceLabel: "CFA200",
    qrCodeEnabled: false,
    routerId: "routeur-demo",
    template: "economy",
    tickets: Array.from({ length: quantity }, (_, index) => {
      const username = String(123001 + index);

      return {
        passwordSecretRef: `secret://routeur-demo/${username}/password`,
        username
      };
    }),
    zoneName: "Zone Centre"
  };
}
