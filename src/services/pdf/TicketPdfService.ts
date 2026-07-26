import type { CreateGeneratedFileInput } from "../../domain/database";

export type TicketPdfFormat = "a4" | "a5" | "thermal58" | "thermal80";

export type TicketPdfTemplate = "economy" | "premium" | "qr" | "simple";

export type TicketPdfTicket = {
  passwordSecretRef: string;
  username: string;
};

export type TicketPdfInput = {
  accountId: string;
  batchId: string;
  createdByProfile: string;
  createdByProfileId: string;
  dataLimitLabel: string | null;
  durationLabel: string;
  fileName: string;
  format: TicketPdfFormat;
  generatedAt: string;
  planName: string;
  priceLabel?: string | null;
  qrCodeEnabled: boolean;
  routerId: string;
  supportPhone?: string | null;
  template: TicketPdfTemplate;
  tickets: TicketPdfTicket[];
  zoneName: string;
};

type PageSize = {
  height: number;
  width: number;
};

type TicketGrid = {
  columns: number;
  margin: number;
  rows: number;
};

const pageSizes: Record<TicketPdfFormat, PageSize> = {
  a4: { height: 841.89, width: 595.28 },
  a5: { height: 595.28, width: 419.53 },
  thermal58: { height: 155.91, width: 164.41 },
  thermal80: { height: 170.08, width: 226.77 }
};

const grids: Record<TicketPdfFormat, TicketGrid> = {
  a4: { columns: 5, margin: 36, rows: 8 },
  a5: { columns: 2, margin: 24, rows: 5 },
  thermal58: { columns: 1, margin: 8, rows: 1 },
  thermal80: { columns: 1, margin: 10, rows: 1 }
};

export function buildGeneratedTicketPdfRecord(input: TicketPdfInput): CreateGeneratedFileInput {
  return {
    account_id: input.accountId,
    batch_id: input.batchId,
    created_by_profile: input.createdByProfile,
    created_by_profile_id: input.createdByProfileId,
    file_name: input.fileName,
    file_path: `files/${input.fileName}`,
    format: "pdf",
    id: `${input.batchId}-pdf`,
    router_id: input.routerId,
    sync_status: "local",
    type: "tickets_pdf"
  };
}

export function generateTicketPdf(input: TicketPdfInput): Uint8Array {
  const writer = new PdfWriter();
  const pageSize = pageSizes[input.format];
  const grid = grids[input.format];
  const perPage = grid.columns * grid.rows;
  const chunks = chunk(input.tickets, perPage);

  chunks.forEach((tickets, pageIndex) => {
    const page = new PdfPage(pageSize);
    drawTicketPage(page, input, tickets, pageIndex * perPage, grid);
    writer.addPage(page);
  });

  return writer.toBytes();
}

export function resolveTicketPdfPassword(ticket: TicketPdfTicket): string {
  const expectedRef = `/${ticket.username}/password`;
  return ticket.passwordSecretRef.endsWith(expectedRef) ? ticket.username : "******";
}

function drawTicketPage(
  page: PdfPage,
  input: TicketPdfInput,
  tickets: TicketPdfTicket[],
  offset: number,
  grid: TicketGrid
) {
  const availableWidth = page.size.width - grid.margin * 2;
  const availableHeight = page.size.height - grid.margin * 2;
  const cellWidth = availableWidth / grid.columns;
  const cellHeight = availableHeight / grid.rows;
  const isThermal = input.format === "thermal58" || input.format === "thermal80";

  tickets.forEach((ticket, index) => {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const x = grid.margin + column * cellWidth;
    const y = page.size.height - grid.margin - (row + 1) * cellHeight;

    drawTicket(page, {
      cellHeight,
      cellWidth,
      index: offset + index + 1,
      input,
      isThermal,
      ticket,
      x,
      y
    });
  });
}

function drawTicket(
  page: PdfPage,
  {
    cellHeight,
    cellWidth,
    index,
    input,
    isThermal,
    ticket,
    x,
    y
  }: {
    cellHeight: number;
    cellWidth: number;
    index: number;
    input: TicketPdfInput;
    isThermal: boolean;
    ticket: TicketPdfTicket;
    x: number;
    y: number;
  }
) {
  const padding = isThermal ? 8 : 6;
  const centerX = x + cellWidth / 2;
  const top = y + cellHeight - padding;
  const password = resolveTicketPdfPassword(ticket);
  const showQr = input.qrCodeEnabled || input.template === "qr";
  const isEconomy = input.template === "economy";
  const isPremium = input.template === "premium";

  page.rect(x, y, cellWidth, cellHeight);

  if (isPremium) {
    page.fillRect(x, y + cellHeight - 5, cellWidth, 5, 0.72);
  }

  page.text(input.zoneName, centerX, top - 8, { align: "center", font: "bold", size: isThermal ? 11 : 7.6 });
  page.text(`#${index}`, centerX, top - (isThermal ? 21 : 18), { align: "center", size: isThermal ? 7 : 4.9 });

  const codeBoxY = top - (isThermal ? 49 : 31);
  page.rect(x + padding, codeBoxY, cellWidth - padding * 2, isThermal ? 22 : 16);
  if (!isEconomy) {
    drawSmallUserIcon(page, x + padding + 5, codeBoxY + (isThermal ? 6 : 4));
  }
  page.text(ticket.username, centerX + (isEconomy ? 0 : 5), codeBoxY + (isThermal ? 7 : 5), {
    align: "center",
    font: "bold",
    size: isThermal ? 14 : 9.6
  });

  const smallSize = isThermal ? 7.2 : 4.45;
  const lineGap = isThermal ? 10 : 5.9;
  let lineY = codeBoxY - (isThermal ? 12 : 7);
  page.text(input.planName, centerX, lineY, { align: "center", font: "bold", size: isThermal ? 10 : 6.2 });
  lineY -= lineGap;
  page.text(["Duree " + input.durationLabel, input.dataLimitLabel].filter(Boolean).join(" - "), centerX, lineY, {
    align: "center",
    size: smallSize
  });

  lineY -= lineGap;
  page.text(`Passe ${password}`, centerX, lineY, { align: "center", font: "bold", size: smallSize });

  if (input.priceLabel) {
    lineY -= lineGap;
    page.text(input.priceLabel, centerX, lineY, { align: "center", size: smallSize });
  }

  if (showQr && cellWidth > 85) {
    drawQrPattern(page, x + cellWidth - padding - 24, y + padding + 13, 19, `${ticket.username}:${password}`);
  }

  const footerSize = isThermal ? 6.2 : 3.9;
  page.text(formatPdfDate(input.generatedAt), centerX, y + padding + 18, { align: "center", size: footerSize });
  page.text(`Lot ${input.batchId}`, centerX, y + padding + 11, { align: "center", size: footerSize });

  if (input.supportPhone) {
    page.text(input.supportPhone, centerX, y + padding + 5, { align: "center", size: footerSize });
  } else {
    page.text("Conservez le ticket pendant le service", centerX, y + padding + 5, {
      align: "center",
      size: footerSize
    });
  }
}

function drawSmallUserIcon(page: PdfPage, x: number, y: number) {
  page.circle(x + 4, y + 6, 3);
  page.fillCircle(x + 4, y + 1, 4);
  page.fillCircle(x + 12, y + 3, 2.5);
  page.line(x + 11, y, x + 16, y);
}

function drawQrPattern(page: PdfPage, x: number, y: number, size: number, value: string) {
  const modules = 11;
  const moduleSize = size / modules;
  let seed = hash(value);

  page.rect(x, y, size, size);

  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      const finder =
        (row < 3 && column < 3) ||
        (row < 3 && column >= modules - 3) ||
        (row >= modules - 3 && column < 3);

      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;

      if (finder || seed % 3 === 0) {
        page.fillRect(x + column * moduleSize, y + row * moduleSize, moduleSize, moduleSize);
      }
    }
  }
}

function formatPdfDate(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function hash(value: string): number {
  return Array.from(value).reduce((result, character) => (result * 31 + character.charCodeAt(0)) & 0x7fffffff, 17);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks.length > 0 ? chunks : [[]];
}

type TextOptions = {
  align?: "center" | "left" | "right";
  font?: "bold" | "regular";
  size: number;
};

class PdfPage {
  private readonly commands: string[] = [];

  constructor(readonly size: PageSize) {}

  circle(x: number, y: number, radius: number) {
    this.fillCircle(x, y, radius);
  }

  fillCircle(x: number, y: number, radius: number) {
    this.commands.push(`${fixed(0)} g`);
    this.commands.push(`${fixed(x - radius)} ${fixed(y - radius)} ${fixed(radius * 2)} ${fixed(radius * 2)} re f`);
  }

  fillRect(x: number, y: number, width: number, height: number, gray = 0) {
    this.commands.push(`${fixed(gray)} g`);
    this.commands.push(`${fixed(x)} ${fixed(y)} ${fixed(width)} ${fixed(height)} re f`);
    this.commands.push("0 g");
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.commands.push(`${fixed(x1)} ${fixed(y1)} m ${fixed(x2)} ${fixed(y2)} l S`);
  }

  rect(x: number, y: number, width: number, height: number) {
    this.commands.push(`0.35 w ${fixed(x)} ${fixed(y)} ${fixed(width)} ${fixed(height)} re S`);
  }

  text(value: string, x: number, y: number, options: TextOptions) {
    const fontName = options.font === "bold" ? "F2" : "F1";
    const normalized = normalizePdfText(value);
    const width = estimateTextWidth(normalized, options.size, options.font === "bold");
    const resolvedX =
      options.align === "center" ? x - width / 2 : options.align === "right" ? x - width : x;

    this.commands.push(
      `BT /${fontName} ${fixed(options.size)} Tf 1 0 0 1 ${fixed(resolvedX)} ${fixed(y)} Tm (${escapePdfString(
        normalized
      )}) Tj ET`
    );
  }

  toContent(): string {
    return this.commands.join("\n");
  }

  toContentChunks(maxBytes = 12_000): string[] {
    const chunks: string[] = [];
    let current = "";

    this.commands.forEach((command) => {
      const next = current ? `${current}\n${command}` : command;

      if (byteLength(next) > maxBytes && current) {
        chunks.push(current);
        current = command;
        return;
      }

      current = next;
    });

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }
}

class PdfWriter {
  private readonly pages: PdfPage[] = [];

  addPage(page: PdfPage) {
    this.pages.push(page);
  }

  toBytes(): Uint8Array {
    const objects = new Map<number, string>();
    const pageIds: number[] = [];
    let nextId = 5;

    objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
    objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

    this.pages.forEach((page) => {
      const contentIds: number[] = [];
      const pageId = nextId;
      nextId += 1;

      page.toContentChunks().forEach((content) => {
        const contentId = nextId;
        const streamContent = `${content}\n`;
        nextId += 1;
        contentIds.push(contentId);
        objects.set(contentId, `<< /Length ${byteLength(streamContent)} >>\nstream\n${streamContent}endstream`);
      });
      objects.set(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(page.size.width)} ${fixed(
          page.size.height
        )}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents [${contentIds
          .map((id) => `${id} 0 R`)
          .join(" ")}] >>`
      );
      pageIds.push(pageId);
    });

    objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

    let output = "%PDF-1.4\n";
    const offsets = [0];
    const maxId = Math.max(...objects.keys());

    for (let id = 1; id <= maxId; id += 1) {
      const body = objects.get(id) ?? "<<>>";
      offsets[id] = byteLength(output);
      output += `${id} 0 obj\n${body}\nendobj\n`;
    }

    const xrefOffset = byteLength(output);
    output += `xref\n0 ${maxId + 1}\n`;
    output += "0000000000 65535 f \n";

    for (let id = 1; id <= maxId; id += 1) {
      output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }

    output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new TextEncoder().encode(output);
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function fixed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function normalizePdfText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function estimateTextWidth(value: string, size: number, isBold: boolean): number {
  return value.length * size * (isBold ? 0.58 : 0.52);
}
