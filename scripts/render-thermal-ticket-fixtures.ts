import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateTicketPdf, type TicketPdfFormat, type TicketPdfInput } from "../src/services/pdf";

const outputDirectory = resolve(process.cwd(), "tmp/pdfs");
mkdirSync(outputDirectory, { recursive: true });

for (const format of ["thermal58", "thermal80"] satisfies TicketPdfFormat[]) {
  const input: TicketPdfInput = {
    accountId: "qa-account",
    batchId: `qa-${format}`,
    createdByProfile: "admin",
    createdByProfileId: "qa-account:admin",
    dataLimitLabel: "Illimite",
    displaySettings: {
      showContact: true,
      showCreatedAt: false,
      showDataLimit: true,
      showDuration: true,
      showExpiresAt: true,
      showLogo: true,
      showPassword: true,
      showPrice: true,
      showQrCode: false,
      showInstructions: true,
      showUsername: true,
      showZoneName: true
    },
    durationLabel: "6 h",
    fileName: `ticketpro-${format}-qa.pdf`,
    format,
    generatedAt: "2026-08-03T18:00:00.000Z",
    hotspotAddress: "portail-zone-wifi-niamey.ticketpro.local",
    ownerPhone: "+227 93 10 06 26",
    planName: "Forfait 6 heures",
    priceLabel: "500 CFA",
    qrCodeEnabled: false,
    routerId: "qa-router",
    template: "economy",
    tickets: [{
      password: "847295",
      passwordSecretRef: "dpapi:fixture",
      username: "638472"
    }],
    zoneName: "WiFi Zone Grand Marche Niamey"
  };

  writeFileSync(resolve(outputDirectory, `ticketpro-${format}-qa.pdf`), generateTicketPdf(input));
}

console.log(outputDirectory);
