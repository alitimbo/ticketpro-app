import type { TauriFileService } from "../files";

export type PrintPaperFormat = "a4" | "thermal58" | "thermal80";

export type PrinterStatus = "available" | "missing" | "unknown";

export type LocalPrinter = {
  id: string;
  isDefault: boolean;
  name: string;
  paperFormats: PrintPaperFormat[];
  status: PrinterStatus;
};

export type PrintTicketInput = {
  batchId: string;
  code: string;
  dataLimitLabel: string | null;
  durationLabel: string;
  id: string;
  passwordLabel: string;
  planName: string;
  zoneName: string;
};

export type PrintSettings = {
  economical: boolean;
  format: PrintPaperFormat;
  printerId: string;
};

export type PrintPreview = {
  formatLabel: string;
  lines: string[];
  paperWidthLabel: string;
  ticketCount: number;
};

export type PrintHistoryEntry = {
  createdAt: string;
  format: PrintPaperFormat;
  id: string;
  mode: "batch" | "single" | "test";
  printerName: string;
  status: "failed" | "prepared" | "printed";
  ticketCount: number;
  userMessage: string;
};

export type PrintResult = {
  historyEntry: PrintHistoryEntry;
  ok: boolean;
  printedTicketIds: string[];
  userMessage: string;
};

export class LocalPrintService {
  constructor(private readonly nativeFileService?: Pick<TauriFileService, "listPrinters" | "printFile">) {}

  async detectPrinters(): Promise<LocalPrinter[]> {
    if (this.nativeFileService) {
      try {
        const systemPrinters = await this.nativeFileService.listPrinters();

        return systemPrinters.map((printer) => ({
          id: printer.id,
          isDefault: printer.is_default,
          name: printer.name,
          paperFormats: ["a4", "thermal58", "thermal80"],
          status: printer.status === "available" ? "available" : "unknown"
        }));
      } catch {
        return [];
      }
    }

    const hasBrowserPrint = typeof window !== "undefined" && typeof window.print === "function";

    return [
      {
        id: "pdf-export",
        isDefault: true,
        name: "Export PDF",
        paperFormats: ["a4", "thermal58", "thermal80"],
        status: "available"
      },
      {
        id: "thermal-80-demo",
        isDefault: false,
        name: "Thermique 80 mm",
        paperFormats: ["thermal80"],
        status: hasBrowserPrint ? "unknown" : "missing"
      },
      {
        id: "thermal-58-demo",
        isDefault: false,
        name: "Thermique 58 mm",
        paperFormats: ["thermal58"],
        status: hasBrowserPrint ? "unknown" : "missing"
      }
    ];
  }

  getDefaultPrinter(printers: LocalPrinter[]): LocalPrinter | null {
    return printers.find((printer) => printer.isDefault && printer.status !== "missing") ?? printers.find((printer) => printer.status !== "missing") ?? null;
  }

  buildPreview(tickets: PrintTicketInput[], settings: PrintSettings): PrintPreview {
    const firstTicket = tickets[0] ?? null;

    return {
      formatLabel: printFormatLabel(settings.format),
      lines: firstTicket
        ? buildTicketPreviewLines(firstTicket, settings)
        : ["Aucun ticket sélectionné.", "L’export PDF reste disponible."],
      paperWidthLabel: settings.format === "thermal58" ? "58 mm" : settings.format === "thermal80" ? "80 mm" : "A4",
      ticketCount: tickets.length
    };
  }

  async printBatch(input: {
    printers: LocalPrinter[];
    settings: PrintSettings;
    tickets: PrintTicketInput[];
    filePath?: string;
  }): Promise<PrintResult> {
    return this.preparePrint({
      filePath: input.filePath,
      mode: "batch",
      printers: input.printers,
      settings: input.settings,
      tickets: input.tickets
    });
  }

  async printTicket(input: {
    printers: LocalPrinter[];
    settings: PrintSettings;
    ticket: PrintTicketInput;
  }): Promise<PrintResult> {
    return this.preparePrint({
      mode: "single",
      printers: input.printers,
      settings: input.settings,
      tickets: [input.ticket]
    });
  }

  async testPrinter(input: { printers: LocalPrinter[]; settings: PrintSettings }): Promise<PrintResult> {
    return this.preparePrint({
      mode: "test",
      printers: input.printers,
      settings: input.settings,
      tickets: []
    });
  }

  private async preparePrint(input: {
    filePath?: string;
    mode: PrintHistoryEntry["mode"];
    printers: LocalPrinter[];
    settings: PrintSettings;
    tickets: PrintTicketInput[];
  }): Promise<PrintResult> {
    const printer = input.printers.find((item) => item.id === input.settings.printerId) ?? this.getDefaultPrinter(input.printers);
    const canPrint = Boolean(printer && printer.status !== "missing" && printer.paperFormats.includes(input.settings.format));
    const ticketCount = input.mode === "test" ? 1 : input.tickets.length;
    const userMessage = canPrint
      ? input.mode === "test"
        ? "Test imprimante préparé."
        : `${ticketCount} ticket(s) préparé(s) pour impression.`
      : "Aucune imprimante compatible détectée. L’export PDF reste disponible.";

    if (this.nativeFileService && input.mode === "test") {
      const nativeMessage = canPrint
        ? `Imprimante ${printer?.name} détectée. Un lot PDF sera envoyé directement à Windows.`
        : "Aucune imprimante Windows compatible détectée.";

      return {
        historyEntry: {
          createdAt: new Date().toISOString(),
          format: input.settings.format,
          id: `print-${Date.now()}`,
          mode: input.mode,
          printerName: printer?.name ?? "Aucune imprimante",
          status: canPrint ? "prepared" : "failed",
          ticketCount,
          userMessage: nativeMessage
        },
        ok: canPrint,
        printedTicketIds: [],
        userMessage: nativeMessage
      };
    }

    if (this.nativeFileService && input.mode === "batch" && canPrint && input.filePath) {
      try {
        await this.nativeFileService.printFile(input.filePath, printer?.name ?? "");

        return {
          historyEntry: {
            createdAt: new Date().toISOString(),
            format: input.settings.format,
            id: `print-${Date.now()}`,
            mode: input.mode,
            printerName: printer?.name ?? "Aucune imprimante",
            status: "printed",
            ticketCount,
            userMessage: `${ticketCount} ticket(s) envoyé(s) à ${printer?.name}.`
          },
          ok: true,
          printedTicketIds: input.tickets.map((ticket) => ticket.id),
          userMessage: `${ticketCount} ticket(s) envoyé(s) à ${printer?.name}.`
        };
      } catch {
        return {
          historyEntry: {
            createdAt: new Date().toISOString(),
            format: input.settings.format,
            id: `print-${Date.now()}`,
            mode: input.mode,
            printerName: printer?.name ?? "Aucune imprimante",
            status: "failed",
            ticketCount,
            userMessage: "Windows n'a pas pu envoyer le PDF à l'imprimante."
          },
          ok: false,
          printedTicketIds: [],
          userMessage: "Windows n'a pas pu envoyer le PDF à l'imprimante."
        };
      }
    }

    return {
      historyEntry: {
        createdAt: new Date().toISOString(),
        format: input.settings.format,
        id: `print-${Date.now()}`,
        mode: input.mode,
        printerName: printer?.name ?? "Aucune imprimante",
        status: canPrint ? "printed" : "prepared",
        ticketCount,
        userMessage
      },
      ok: canPrint,
      printedTicketIds: canPrint && input.mode !== "test" ? input.tickets.map((ticket) => ticket.id) : [],
      userMessage
    };
  }
}

export function printFormatLabel(format: PrintPaperFormat): string {
  const labels: Record<PrintPaperFormat, string> = {
    a4: "A4",
    thermal58: "58 mm",
    thermal80: "80 mm"
  };

  return labels[format];
}

export function printerStatusLabel(status: PrinterStatus): string {
  const labels: Record<PrinterStatus, string> = {
    available: "Disponible",
    missing: "Introuvable",
    unknown: "À vérifier"
  };

  return labels[status];
}

function buildTicketPreviewLines(ticket: PrintTicketInput, settings: PrintSettings): string[] {
  const lines = [
    ticket.zoneName,
    ticket.planName,
    `Code : ${ticket.code}`,
    `Passe : ${ticket.passwordLabel}`,
    `Durée : ${ticket.durationLabel}`,
    ticket.dataLimitLabel ? `Volume : ${ticket.dataLimitLabel}` : "Volume : illimité",
    `Lot : ${ticket.batchId}`
  ];

  return settings.economical ? lines.filter((_, index) => index !== 1) : lines;
}
