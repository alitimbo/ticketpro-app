import type { CreateGeneratedFileInput } from "../../domain/database";
import QRCode from "qrcode";

export type TicketPdfFormat = "a4" | "a5" | "thermal58" | "thermal80";

export type TicketPdfTemplate = "economy" | "premium" | "qr" | "simple";

export type TicketPdfTicket = {
  password?: string;
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
  hotspotAddress: string;
  ownerPhone: string;
  planName: string;
  priceLabel?: string | null;
  qrCodeEnabled: boolean;
  routerId: string;
  template: TicketPdfTemplate;
  tickets: TicketPdfTicket[];
  zoneName: string;
};

export type TicketPdfArchiveMetadata = Pick<
  TicketPdfInput,
  | "dataLimitLabel"
  | "durationLabel"
  | "format"
  | "hotspotAddress"
  | "ownerPhone"
  | "planName"
  | "priceLabel"
  | "qrCodeEnabled"
  | "template"
  | "zoneName"
>;

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
  a4: { columns: 4, margin: 36, rows: 7 },
  a5: { columns: 2, margin: 24, rows: 4 },
  thermal58: { columns: 1, margin: 8, rows: 1 },
  thermal80: { columns: 1, margin: 10, rows: 1 }
};

export function buildGeneratedTicketPdfRecord(input: TicketPdfInput): CreateGeneratedFileInput {
  const metadata: TicketPdfArchiveMetadata = {
    dataLimitLabel: input.dataLimitLabel,
    durationLabel: input.durationLabel,
    format: input.format,
    hotspotAddress: input.hotspotAddress,
    ownerPhone: input.ownerPhone,
    planName: input.planName,
    priceLabel: input.priceLabel ?? null,
    qrCodeEnabled: input.qrCodeEnabled,
    template: input.template,
    zoneName: input.zoneName
  };

  return {
    account_id: input.accountId,
    batch_id: input.batchId,
    created_by_profile: input.createdByProfile,
    created_by_profile_id: input.createdByProfileId,
    file_name: input.fileName,
    file_path: `files/${input.fileName}`,
    format: input.format,
    id: `${input.batchId}-pdf`,
    metadata_json: JSON.stringify(metadata),
    router_id: input.routerId,
    sync_status: "local",
    type: "tickets_pdf"
  };
}

export function parseTicketPdfArchiveMetadata(value: string | null | undefined): TicketPdfArchiveMetadata | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<TicketPdfArchiveMetadata>;
    if (
      !["a4", "a5", "thermal58", "thermal80"].includes(parsed.format ?? "") ||
      !["economy", "premium", "qr", "simple"].includes(parsed.template ?? "") ||
      typeof parsed.durationLabel !== "string" ||
      typeof parsed.hotspotAddress !== "string" ||
      typeof parsed.ownerPhone !== "string" ||
      typeof parsed.planName !== "string" ||
      typeof parsed.zoneName !== "string"
    ) {
      return null;
    }

    return {
      dataLimitLabel: typeof parsed.dataLimitLabel === "string" ? parsed.dataLimitLabel : null,
      durationLabel: parsed.durationLabel,
      format: parsed.format as TicketPdfFormat,
      hotspotAddress: parsed.hotspotAddress,
      ownerPhone: parsed.ownerPhone,
      planName: parsed.planName,
      priceLabel: typeof parsed.priceLabel === "string" ? parsed.priceLabel : null,
      qrCodeEnabled: parsed.qrCodeEnabled === true,
      template: parsed.template as TicketPdfTemplate,
      zoneName: parsed.zoneName
    };
  } catch {
    return null;
  }
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
  if (ticket.password) {
    return ticket.password;
  }
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
  const isThermal = input.format === "thermal58" || input.format === "thermal80";
  const ticketGap = isThermal ? 0 : 5;
  const cellWidth = (availableWidth - ticketGap * (grid.columns - 1)) / grid.columns;
  const cellHeight = (availableHeight - ticketGap * (grid.rows - 1)) / grid.rows;

  tickets.forEach((ticket, index) => {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const x = grid.margin + column * (cellWidth + ticketGap);
    const y = page.size.height - grid.margin - (row + 1) * cellHeight - row * ticketGap;

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
  const isSingleCode = password === ticket.username;
  const showQr = input.qrCodeEnabled || input.template === "qr";
  const isPremium = input.template === "premium";

  page.rect(x, y, cellWidth, cellHeight);

  if (isPremium) {
    page.fillRect(x, y + cellHeight - 4, cellWidth, 4, 0.72);
  }

  const contentWidth = cellWidth - padding * 2;
  const titleSize = fitTextSize(input.zoneName, contentWidth, isThermal ? 11 : 8.4, isThermal ? 8 : 6);
  page.text(input.zoneName, centerX, top - 8, { align: "center", font: "bold", size: titleSize });
  page.text(`TICKET ${index}`, centerX, top - (isThermal ? 20 : 17), {
    align: "center",
    size: isThermal ? 6.4 : 4.2
  });

  const credentialTop = top - (isThermal ? 27 : 21);
  const credentialHeight = isSingleCode ? (isThermal ? 34 : 25) : (isThermal ? 58 : 38);
  const credentialBottom = credentialTop - credentialHeight;
  const credentialX = x + padding;
  page.rect(credentialX, credentialBottom, contentWidth, credentialHeight);

  const credentialLabelSize = isThermal ? 6.2 : 4.2;
  if (isSingleCode) {
    page.text("LOGIN", centerX, credentialTop - (isThermal ? 10 : 8), {
      align: "center",
      font: "bold",
      size: credentialLabelSize
    });
    page.text(ticket.username, centerX, credentialTop - (isThermal ? 27 : 21), {
      align: "center",
      font: "bold",
      size: fitTextSize(ticket.username, contentWidth - 8, isThermal ? 15 : 11, isThermal ? 9 : 7)
    });
  } else {
    const dividerY = credentialTop - credentialHeight / 2;
    page.line(credentialX, dividerY, credentialX + contentWidth, dividerY);
    page.text("LOGIN", centerX, credentialTop - (isThermal ? 8 : 6), {
      align: "center",
      font: "bold",
      size: credentialLabelSize
    });
    page.text(ticket.username, centerX, credentialTop - (isThermal ? 21 : 16), {
      align: "center",
      font: "bold",
      size: fitTextSize(ticket.username, contentWidth - 8, isThermal ? 12 : 8.5, isThermal ? 8 : 5.8)
    });
    page.text("MOT DE PASSE", centerX, dividerY - (isThermal ? 9 : 7), {
      align: "center",
      font: "bold",
      size: credentialLabelSize
    });
    page.text(password, centerX, dividerY - (isThermal ? 23 : 17), {
      align: "center",
      font: "bold",
      size: fitTextSize(password, contentWidth - 8, isThermal ? 12 : 8.5, isThermal ? 8 : 5.8)
    });
  }

  const smallSize = isThermal ? 7 : 4.5;
  const lineGap = isThermal ? 10 : 6.2;
  let lineY = credentialBottom - (isThermal ? 11 : 8);
  page.text(input.planName, centerX, lineY, {
    align: "center",
    font: "bold",
    size: fitTextSize(input.planName, contentWidth, isThermal ? 10 : 6.6, isThermal ? 7 : 4.5)
  });
  lineY -= lineGap;
  const allowanceLabel = [`Duree ${input.durationLabel}`, input.dataLimitLabel].filter(Boolean).join(" - ");
  page.text(allowanceLabel, centerX, lineY, {
    align: "center",
    size: fitTextSize(allowanceLabel, contentWidth, smallSize, isThermal ? 5.2 : 3.5)
  });

  if (input.priceLabel) {
    lineY -= lineGap;
    page.text(input.priceLabel, centerX, lineY, { align: "center", font: "bold", size: smallSize });
  }

  const qrSize = isThermal ? 42 : 28;
  if (showQr && cellWidth > 85) {
    drawQrPattern(
      page,
      x + cellWidth - padding - qrSize,
      y + padding,
      qrSize,
      `${ticket.username}:${password}`
    );
  }

  const footerSize = isThermal ? 6.2 : 3.9;
  const footerCenterX = showQr
    ? x + padding + (cellWidth - padding * 3 - qrSize) / 2
    : centerX;
  const footerWidth = showQr ? cellWidth - padding * 3 - qrSize : cellWidth - padding * 2;
  const hotspotLabel = `Portail ${input.hotspotAddress}`;
  page.text(hotspotLabel, footerCenterX, y + padding + 8, {
    align: "center",
    font: "bold",
    size: fitTextSize(hotspotLabel, footerWidth, isThermal ? 7 : 4.6, isThermal ? 4.8 : 3.2)
  });
  const ownerPhoneLabel = `Contact ${input.ownerPhone}`;
  page.text(ownerPhoneLabel, footerCenterX, y + padding + 2, {
    align: "center",
    size: fitTextSize(ownerPhoneLabel, footerWidth, footerSize, isThermal ? 4.8 : 3.1)
  });
}

function drawQrPattern(page: PdfPage, x: number, y: number, size: number, value: string) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const quietZone = 2;
  const totalModules = qr.modules.size + quietZone * 2;
  const moduleSize = size / totalModules;

  page.fillRect(x, y, size, size, 1);

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column)) {
        page.fillRect(
          x + (column + quietZone) * moduleSize,
          y + (qr.modules.size - row - 1 + quietZone) * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }
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

function fitTextSize(value: string, maxWidth: number, preferredSize: number, minimumSize: number): number {
  const estimatedAtPreferred = estimateTextWidth(normalizePdfText(value), preferredSize, true);
  if (estimatedAtPreferred <= maxWidth) {
    return preferredSize;
  }

  return Math.max(minimumSize, preferredSize * (maxWidth / estimatedAtPreferred));
}
