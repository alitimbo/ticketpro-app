import { describe, expect, it } from "vitest";
import { defaultTicketDisplaySettings } from "../tickets/TicketDisplaySettingsService";
import type { TicketPdfInput } from "./TicketPdfService";
import {
  createTicketPrintArchivePayload,
  ticketPdfInputFromPrintArchive
} from "./TicketPrintArchive";

const pdfInput: TicketPdfInput = {
  accountId: "account-1",
  batchId: "batch-1",
  createdByProfile: "operator",
  createdByProfileId: "profile-1",
  currency: "CFA",
  dataLimitLabel: "500 Mo",
  displaySettings: defaultTicketDisplaySettings,
  durationLabel: "1 h",
  fileName: "routeur-plan-100-cfa.pdf",
  format: "a4",
  generatedAt: "2026-08-30T10:00:00.000Z",
  hotspotAddress: "wifi.example.test",
  ownerPhone: "+22790000000",
  planName: "Plan 1 heure",
  priceLabel: "100 CFA",
  qrCodeEnabled: false,
  routerId: "router-1",
  template: "economy",
  tickets: [{
    password: "mot-de-passe-distinct",
    passwordSecretRef: "dpapi://local-only",
    username: "482793"
  }],
  titleLabel: "WiFi Zone",
  validityLabel: "3 j",
  zoneName: "WiFi Zone"
};

describe("TicketPrintArchive", () => {
  it("conserve uniquement les données canoniques nécessaires à une régénération", () => {
    const archive = createTicketPrintArchivePayload(pdfInput);

    expect(archive).toMatchObject({
      batchId: "batch-1",
      durationLabel: "1 h",
      validityLabel: "3 j",
      version: 1
    });
    expect(archive.tickets).toEqual([{
      password: "mot-de-passe-distinct",
      username: "482793"
    }]);
    expect(JSON.stringify(archive)).not.toContain("dpapi://");
    expect(JSON.stringify(archive)).not.toContain("account-1");
  });

  it("reconstruit une entrée PDF complète sur un autre poste", () => {
    const archive = createTicketPrintArchivePayload(pdfInput);
    const restored = ticketPdfInputFromPrintArchive(archive, {
      accountId: "account-other-pc",
      batchId: "batch-1",
      createdByProfile: "admin",
      createdByProfileId: "profile-other-pc",
      fileName: "reimpression.pdf",
      routerId: "router-local-other-pc"
    });

    expect(restored.accountId).toBe("account-other-pc");
    expect(restored.routerId).toBe("router-local-other-pc");
    expect(restored.tickets[0]).toMatchObject({
      password: "mot-de-passe-distinct",
      username: "482793"
    });
    expect(restored.validityLabel).toBe("3 j");
  });

  it("refuse une archive affectée à un autre lot", () => {
    expect(() => ticketPdfInputFromPrintArchive(
      createTicketPrintArchivePayload(pdfInput),
      {
        accountId: "account-1",
        batchId: "batch-other",
        createdByProfile: "admin",
        createdByProfileId: "profile-1",
        fileName: "x.pdf",
        routerId: "router-1"
      }
    )).toThrow(/lot demandé/i);
  });
});
