import { describe, expect, it } from "vitest";
import { LocalPrintService, type LocalPrinter, type PrintTicketInput } from "./LocalPrintService";

const ticket: PrintTicketInput = {
  batchId: "batch-1",
  code: "123456",
  dataLimitLabel: "2 Go",
  durationLabel: "3 h",
  id: "ticket-1",
  passwordLabel: "123456",
  planName: "3h-2Go",
  zoneName: "Routeur démo"
};

const printers: LocalPrinter[] = [
  {
    id: "thermal",
    isDefault: true,
    name: "Thermique 80",
    paperFormats: ["thermal80"],
    status: "available"
  }
];

describe("LocalPrintService", () => {
  it("prépare un aperçu thermique lisible", () => {
    const service = new LocalPrintService();
    const preview = service.buildPreview([ticket], {
      economical: true,
      format: "thermal80",
      printerId: "thermal"
    });

    expect(preview.paperWidthLabel).toBe("80 mm");
    expect(preview.lines).toContain("Code : 123456");
    expect(preview.lines).not.toContain("3h-2Go");
  });

  it("prépare une impression et retourne les tickets imprimés", async () => {
    const service = new LocalPrintService();
    const result = await service.printBatch({
      printers,
      settings: { economical: false, format: "thermal80", printerId: "thermal" },
      tickets: [ticket]
    });

    expect(result.ok).toBe(true);
    expect(result.printedTicketIds).toEqual(["ticket-1"]);
    expect(result.historyEntry.status).toBe("printed");
  });

  it("ne bloque pas si aucune imprimante compatible n'est disponible", async () => {
    const service = new LocalPrintService();
    const result = await service.printTicket({
      printers: [{ ...printers[0], status: "missing" }],
      settings: { economical: false, format: "thermal80", printerId: "thermal" },
      ticket
    });

    expect(result.ok).toBe(false);
    expect(result.printedTicketIds).toEqual([]);
    expect(result.userMessage).toContain("export PDF");
  });

  it("utilise l'impression native quand un PDF persistant est fourni", async () => {
    const printed: string[] = [];
    const service = new LocalPrintService({
      listPrinters: async () => [{ id: "windows:Thermique 80", is_default: true, name: "Thermique 80", status: "available" }],
      printFile: async (path, printerName) => {
        printed.push(`${path}:${printerName}`);
      }
    });
    const detected = await service.detectPrinters();
    const result = await service.printBatch({
      filePath: "files/tickets-batch-1.pdf",
      printers: detected,
      settings: { economical: false, format: "thermal80", printerId: detected[0].id },
      tickets: [ticket]
    });

    expect(printed).toEqual(["files/tickets-batch-1.pdf:Thermique 80"]);
    expect(result.ok).toBe(true);
    expect(result.historyEntry.status).toBe("printed");
  });

  it("retourne un échec quand Windows refuse l'envoi", async () => {
    const service = new LocalPrintService({
      listPrinters: async () => [{ id: "windows:Thermique 80", is_default: true, name: "Thermique 80", status: "available" }],
      printFile: async () => {
        throw new Error("spooler indisponible");
      }
    });
    const detected = await service.detectPrinters();
    const result = await service.printBatch({
      filePath: "files/tickets-batch-1.pdf",
      printers: detected,
      settings: { economical: false, format: "thermal80", printerId: detected[0].id },
      tickets: [ticket]
    });

    expect(result.ok).toBe(false);
    expect(result.historyEntry.status).toBe("failed");
  });
});
