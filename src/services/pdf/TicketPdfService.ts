import type { CreateGeneratedFileInput } from "../../domain/database";
import QRCode from "qrcode";
import type { TicketDisplaySettings } from "../tickets/TicketDisplaySettingsService";

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
  currency?: string;
  dataLimitLabel: string | null;
  durationLabel: string;
  fileName: string;
  format: TicketPdfFormat;
  generatedAt: string;
  hotspotAddress: string;
  ownerPhone: string;
  planName: string;
  /** Moment réel où cette version du PDF a été produite (création ou réimpression). */
  printedAt?: string;
  previewMode?: "single-ticket";
  priceLabel?: string | null;
  qrCodeEnabled: boolean;
  routerId: string;
  template: TicketPdfTemplate;
  tickets: TicketPdfTicket[];
  titleLabel: string;
  validityLabel: string;
  zoneName: string;
  displaySettings?: TicketDisplaySettings;
};

export type TicketPdfArchiveMetadata = Pick<
  TicketPdfInput,
  | "dataLimitLabel"
  | "currency"
  | "durationLabel"
  | "format"
  | "hotspotAddress"
  | "ownerPhone"
  | "planName"
  | "priceLabel"
  | "qrCodeEnabled"
  | "template"
  | "titleLabel"
  | "validityLabel"
  | "zoneName"
  | "displaySettings"
>;

export function buildTicketPdfFileName(input: {
  batchId: string;
  currency?: string;
  generatedAt?: Date;
  planName: string;
  price: number | null;
  quantity: number;
  routerName: string;
}): string {
  const generatedAt = input.generatedAt ?? new Date();
  const timestamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const batchSuffix = sanitizeFileSegment(input.batchId.replace(/^batch-/, "")).slice(0, 8) || "lot";
  const currency = sanitizeFileSegment(input.currency?.trim().slice(0, 12) || "CFA") || "CFA";
  const price = input.price === null
    ? `prix-non-defini-${currency}`
    : `${Math.max(0, Math.round(input.price))}${currency}`;

  return [
    sanitizeFileSegment(input.routerName) || "Routeur",
    sanitizeFileSegment(input.planName) || "Plan",
    price,
    `${Math.max(1, Math.round(input.quantity))}tickets`,
    timestamp,
    batchSuffix
  ].join("-") + ".pdf";
}

export function formatTicketValidityLabel(minutes: number): string {
  const normalizedMinutes = Math.max(0, Math.round(minutes));
  if (normalizedMinutes >= 1440 && normalizedMinutes % 1440 === 0) {
    const days = normalizedMinutes / 1440;
    return `${days}${days === 1 ? "Jr" : "Jrs"}`;
  }
  if (normalizedMinutes >= 60 && normalizedMinutes % 60 === 0) {
    return `${normalizedMinutes / 60}H`;
  }
  return `${normalizedMinutes}Min`;
}

export function normalizeTicketValidityLabel(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^(\d+)\s*(min(?:ute)?s?|m|h|hr|heure?s?|j|jr|jrs|jour?s?)$/i);
  if (!match) return normalized;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("j")) return `${amount}${amount === 1 ? "Jr" : "Jrs"}`;
  if (unit === "h" || unit === "hr" || unit.startsWith("heure")) return `${amount}H`;
  return `${amount}Min`;
}

function sanitizeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 48);
}

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
  a4: { columns: 5, margin: 18, rows: 8 },
  a5: { columns: 2, margin: 24, rows: 4 },
  thermal58: { columns: 1, margin: 8, rows: 1 },
  thermal80: { columns: 1, margin: 10, rows: 1 }
};

export function buildGeneratedTicketPdfRecord(input: TicketPdfInput): CreateGeneratedFileInput {
  const metadata: TicketPdfArchiveMetadata = {
    dataLimitLabel: input.dataLimitLabel,
    currency: input.currency?.trim() || input.displaySettings?.currency?.trim() || "CFA",
    durationLabel: input.durationLabel,
    format: input.format,
    hotspotAddress: input.hotspotAddress,
    ownerPhone: input.ownerPhone,
    planName: input.planName,
    priceLabel: input.priceLabel ?? null,
    qrCodeEnabled: input.qrCodeEnabled,
    template: input.template,
    titleLabel: input.titleLabel,
    validityLabel: normalizeTicketValidityLabel(input.validityLabel),
    zoneName: input.zoneName,
    displaySettings: input.displaySettings
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
      currency: typeof parsed.currency === "string" ? parsed.currency : parsed.displaySettings?.currency ?? "CFA",
      durationLabel: parsed.durationLabel,
      format: parsed.format as TicketPdfFormat,
      hotspotAddress: parsed.hotspotAddress,
      ownerPhone: parsed.ownerPhone,
      planName: parsed.planName,
      priceLabel: typeof parsed.priceLabel === "string" ? parsed.priceLabel : null,
      qrCodeEnabled: parsed.qrCodeEnabled === true,
      template: parsed.template as TicketPdfTemplate,
      titleLabel: typeof parsed.titleLabel === "string" ? parsed.titleLabel : parsed.zoneName,
      // Older TicketPro files did not persist validity separately. Keep the
      // field empty so regeneration can recover it from immutable ticket
      // snapshots instead of silently copying the usage duration.
      validityLabel: typeof parsed.validityLabel === "string" ? parsed.validityLabel : "",
      zoneName: parsed.zoneName,
      displaySettings: parsed.displaySettings
    };
  } catch {
    return null;
  }
}

export function generateTicketPdf(input: TicketPdfInput): Uint8Array {
  input = {
    ...input,
    printedAt: input.printedAt ?? new Date().toISOString(),
    validityLabel: normalizeTicketValidityLabel(input.validityLabel)
  };
  const writer = new PdfWriter();
  const isSingleTicketPreview = input.previewMode === "single-ticket";
  const grid = isSingleTicketPreview ? singleTicketPreviewGrid : grids[input.format];
  const perPage = grid.columns * grid.rows;
  const chunks = chunk(isSingleTicketPreview ? input.tickets.slice(0, 1) : input.tickets, perPage);

  chunks.forEach((tickets, pageIndex) => {
    const pageSize = isSingleTicketPreview
      ? getSingleTicketPreviewPageSize(input.format)
      : isThermalFormat(input.format)
      ? getThermalPageSize(input, tickets[0])
      : pageSizes[input.format];
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

const singleTicketPreviewGrid: TicketGrid = { columns: 1, margin: 1, rows: 1 };

function getSingleTicketPreviewPageSize(format: TicketPdfFormat): PageSize {
  const pageSize = pageSizes[format];
  const sourceGrid = grids[format];
  const ticketGap = isThermalFormat(format) ? 0 : 5;
  const cellWidth = (
    pageSize.width
    - sourceGrid.margin * 2
    - ticketGap * (sourceGrid.columns - 1)
  ) / sourceGrid.columns;
  const cellHeight = (
    pageSize.height
    - sourceGrid.margin * 2
    - ticketGap * (sourceGrid.rows - 1)
  ) / sourceGrid.rows;

  return {
    height: cellHeight + singleTicketPreviewGrid.margin * 2,
    width: cellWidth + singleTicketPreviewGrid.margin * 2
  };
}

export function ticketQrValue(ticket: TicketPdfTicket): string {
  return ticket.username;
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
  const layout = isThermal
    ? layoutTicket(input, ticket, index, cellWidth, thermalUnit(input.format), null)
    : fitTicketLayout(input, ticket, index, cellWidth, cellHeight);
  page.rect(x, y, cellWidth, cellHeight);
  if (isThermal && input.template === "premium") {
    page.fillRect(x, y + cellHeight - 3, cellWidth, 3, 0.72);
  }
  layout.draw(page, x, y, cellHeight);
}

/**
 * One layout for every format. Blocks are stacked from the top (identity,
 * access codes, plan terms) and from the bottom (portal, contact, note,
 * dates, signature): they can never overlap. Sizes derive from a unit `u`
 * (1 u = 1 % of a grid cell height) so that the free space of a ticket is
 * used to print larger text instead of being left empty.
 */
type TicketLayout = {
  draw: (page: PdfPage, x: number, y: number, height: number) => void;
  naturalHeight: number;
};

type LayoutBlock = {
  draw: (page: PdfPage, x: number, top: number) => void;
  height: number;
};

const minimumGridUnit = 0.62;

function fitTicketLayout(
  input: TicketPdfInput,
  ticket: TicketPdfTicket,
  index: number,
  width: number,
  height: number
): TicketLayout {
  // Grid cells have a fixed size: start from the size the cell allows, then
  // shrink only as much as needed for every enabled information to fit.
  // A ticket with few enabled lines may grow up to 40 % larger; the width
  // still caps every text through fitTextSize.
  let unit = Math.min(height / 100, width / 95) * 1.4;
  let layout = layoutTicket(input, ticket, index, width, unit, height);
  for (let attempt = 0; attempt < 8 && layout.naturalHeight > height && unit > minimumGridUnit; attempt += 1) {
    unit = Math.max(minimumGridUnit, unit * Math.sqrt(height / layout.naturalHeight) * 0.98);
    layout = layoutTicket(input, ticket, index, width, unit, height);
  }
  return layout;
}

function thermalUnit(format: TicketPdfFormat): number {
  return format === "thermal58" ? 1.42 : 1.6;
}

function layoutTicket(
  input: TicketPdfInput,
  ticket: TicketPdfTicket,
  index: number,
  width: number,
  u: number,
  fixedHeight: number | null
): TicketLayout {
  const settings = input.displaySettings;
  const isThermal = isThermalFormat(input.format);
  const padding = Math.max(4, 4.5 * u);
  const contentWidth = width - padding * 2;
  const password = resolveTicketPdfPassword(ticket);
  const singleCode = password === ticket.username;
  const showQr = (settings?.showQrCode ?? input.qrCodeEnabled) || input.template === "qr";
  const header = input.titleLabel || input.zoneName || "ACCÈS WIFI";
  const showTicketNumber = settings?.showTicketNumber !== false;
  const showPlan = Boolean(settings?.showPlanName && input.planName);
  const showPrice = settings?.showPrice !== false && Boolean(input.priceLabel);
  const showData = Boolean(settings?.showDataLimit && input.dataLimitLabel);
  const showPortal = settings?.showInstructions !== false && Boolean(input.hotspotAddress);
  const showContact = Boolean(settings?.showContact && input.ownerPhone);
  const showNote = Boolean(settings?.showNote && settings.noteText?.trim());
  const showPoweredBy = settings?.showPoweredBy !== false;
  const top: LayoutBlock[] = [];
  const bottom: LayoutBlock[] = [];

  // Title, with the ticket number in the corner so it costs no line.
  const numberSize = 4.6 * u;
  const numberLabel = `#${String(index).padStart(2, "0")}`;
  const headerWidth = contentWidth - (showTicketNumber ? 2 * (textWidth(numberLabel, numberSize, false) + 2) : 0);
  const headerSize = fitTextSize(header, headerWidth, 9 * u, Math.min(6 * u, 7.5));
  const headerLines = wrapPdfText(header, headerWidth, headerSize, true, 2);
  top.push({
    draw: (page, x, blockTop) => {
      headerLines.forEach((line, lineIndex) => {
        page.text(line, x + width / 2, blockTop - headerSize * (0.95 + lineIndex * 1.12), {
          align: "center", font: "bold", size: headerSize
        });
      });
      if (showTicketNumber) {
        page.text(numberLabel, x + width - padding, blockTop - numberSize * 0.9, { align: "right", size: numberSize });
      }
    },
    height: headerSize * (0.25 + headerLines.length * 1.12)
  });
  if (showPlan) {
    const planSize = fitTextSize(input.planName, contentWidth, 6 * u, 4.4 * u);
    top.push({
      draw: (page, x, blockTop) => page.text(input.planName, x + width / 2, blockTop - planSize * 0.95, {
        align: "center", font: "bold", size: planSize
      }),
      height: planSize * 1.35
    });
  }
  top.push(spacer(2.2 * u));

  // Access codes: what the customer types must be the largest text.
  const codeBlock = showQr
    ? qrAccessBlock({ contentWidth, isThermal, padding, password, singleCode, ticket, u, width })
    : accessCodeBlock({ contentWidth, padding, password, singleCode, ticket, u });
  top.push(codeBlock);
  top.push(spacer(2.6 * u));

  // Plan terms in one row of columns, always aligned.
  const metrics = [
    { label: "DURÉE", value: input.durationLabel },
    { label: "VALIDITÉ", value: input.validityLabel },
    ...(showData && input.dataLimitLabel ? [{ label: "VOLUME", value: input.dataLimitLabel }] : []),
    ...(showPrice && input.priceLabel ? [{ label: "PRIX", value: input.priceLabel }] : [])
  ];
  const metricLabelSize = 3.9 * u;
  const metricWidth = contentWidth / metrics.length;
  const metricValueSize = Math.min(...metrics.map((metric) =>
    fitTextSize(metric.value, metricWidth - 4.5 * u, 7.6 * u, 4.4 * u)
  ));
  top.push({
    draw: (page, x, blockTop) => {
      metrics.forEach((metric, metricIndex) => {
        const centerX = x + padding + metricWidth * (metricIndex + 0.5);
        if (metricIndex > 0) {
          const separatorX = x + padding + metricWidth * metricIndex;
          page.line(separatorX, blockTop - 0.6 * u, separatorX, blockTop - metricLabelSize - metricValueSize * 1.5);
        }
        page.text(metric.label, centerX, blockTop - metricLabelSize * 0.95, {
          align: "center", font: "bold", size: fitTextSize(metric.label, metricWidth - 4.5 * u, metricLabelSize, 2.8 * u)
        });
        page.text(metric.value, centerX, blockTop - metricLabelSize * 1.3 - metricValueSize * 0.95, {
          align: "center", font: "bold", size: metricValueSize
        });
      });
    },
    height: metricLabelSize * 1.3 + metricValueSize * 1.3
  });

  // Footer, from the bottom: signature, dates, note, contact, portal.
  if (showPoweredBy) {
    const poweredSize = 3.7 * u;
    bottom.push({
      draw: (page, x, blockTop) => page.text("Propulsé par TicketPro", x + width / 2, blockTop - poweredSize * 0.95, {
        align: "center", size: poweredSize
      }),
      height: poweredSize * 1.3
    });
  }
  const printed = formatTicketPrintDate(input.printedAt);
  const created = settings?.showCreatedAt === true ? formatTicketPrintDate(input.generatedAt) : "";
  const footerLines: Array<{ bold: boolean; text: string }> = [
    ...(showPortal ? [{ bold: true, text: `Portail : ${input.hotspotAddress}` }] : []),
    ...(showContact ? [{ bold: false, text: `Contact : ${input.ownerPhone}` }] : []),
    ...(showNote ? [{ bold: false, text: settings!.noteText.trim() }] : []),
    ...(created ? [{ bold: false, text: `Créé le ${created}` }] : []),
    { bold: false, text: `Imprimé le ${printed}` }
  ];
  const footerSize = Math.min(...footerLines.map((line) =>
    fitTextSize(line.text, contentWidth, 4.9 * u, 4.1 * u)
  ));
  const footerWrapped = footerLines.flatMap((line) =>
    wrapPdfText(line.text, contentWidth, footerSize, line.bold, isThermal ? 3 : 2).map((text) => ({ bold: line.bold, text }))
  );
  bottom.push({
    draw: (page, x, blockTop) => {
      footerWrapped.forEach((line, lineIndex) => {
        page.text(line.text, x + width / 2, blockTop - footerSize * (0.95 + lineIndex * 1.25), {
          align: "center", font: line.bold ? "bold" : "regular", size: footerSize
        });
      });
    },
    height: footerSize * (0.3 + footerWrapped.length * 1.25)
  });
  if (isThermal) {
    bottom.push({
      draw: (page, x, blockTop) => page.line(x + padding, blockTop - 1.2 * u, x + width - padding, blockTop - 1.2 * u),
      height: 2.8 * u
    });
  }

  const sum = (blocks: LayoutBlock[]) => blocks.reduce((total, block) => total + block.height, 0);
  const naturalHeight = padding * 1.4 + sum(top) + 2 * u + sum(bottom);
  return {
    draw: (page, x, y, height) => {
      // Extra space of a fixed grid cell goes between the groups, so the
      // ticket fills its cell without stretching any text.
      const extra = fixedHeight === null ? 0 : Math.max(0, height - naturalHeight);
      const groupGap = extra / 3;
      let cursor = y + height - padding * 0.7 - (fixedHeight === null ? 0 : groupGap * 0.5);
      top.forEach((block) => {
        block.draw(page, x, cursor);
        cursor -= block.height + (block.height < 3 * u ? groupGap * 0.5 : 0);
      });
      let bottomCursor = y + padding * 0.7;
      bottom.forEach((block) => {
        bottomCursor += block.height;
        block.draw(page, x, bottomCursor);
      });
    },
    naturalHeight
  };
}

function spacer(height: number): LayoutBlock {
  return { draw: () => undefined, height };
}

function accessCodeBlock({
  contentWidth,
  padding,
  password,
  singleCode,
  ticket,
  u
}: {
  contentWidth: number;
  padding: number;
  password: string;
  singleCode: boolean;
  ticket: TicketPdfTicket;
  u: number;
}): LayoutBlock {
  const labelSize = 3.9 * u;
  if (singleCode) {
    // One code: label on the left, the code itself as large as possible.
    const labelWidth = textWidth("CODE", labelSize, true) + 9 * u;
    const valueSize = fitTextSize(ticket.username, contentWidth - labelWidth - 4 * u, 12 * u, 8 * u);
    const frameHeight = valueSize * 1.15 + 2.4 * u;
    return {
      draw: (page, x, blockTop) => {
        const frameX = x + padding;
        const frameBottom = blockTop - frameHeight;
        const middle = frameBottom + frameHeight / 2;
        page.rect(frameX, frameBottom, contentWidth, frameHeight);
        drawUserOutlineIcon(page, frameX + 3.6 * u, middle, 4.6 * u);
        page.text("CODE", frameX + 7 * u, middle - labelSize * 0.35, { font: "bold", size: labelSize });
        page.text(ticket.username, frameX + labelWidth + (contentWidth - labelWidth) / 2, middle - valueSize * 0.36, {
          align: "center", font: "bold", size: valueSize
        });
      },
      height: frameHeight
    };
  }
  // Login and password side by side: same weight, larger digits.
  const gap = 2.4 * u;
  const frameWidth = (contentWidth - gap) / 2;
  const valueSize = Math.min(
    fitTextSize(ticket.username, frameWidth - 7 * u, 10.5 * u, 6 * u),
    fitTextSize(password, frameWidth - 7 * u, 10.5 * u, 6 * u)
  );
  const frameHeight = labelSize * 1.45 + valueSize * 1.15 + 1.6 * u;
  return {
    draw: (page, x, blockTop) => {
      const frameBottom = blockTop - frameHeight;
      [
        { icon: "user" as const, label: "LOGIN", value: ticket.username },
        { icon: "lock" as const, label: "MOT DE PASSE", value: password }
      ].forEach((frame, frameIndex) => {
        const frameX = x + padding + frameIndex * (frameWidth + gap);
        page.rect(frameX, frameBottom, frameWidth, frameHeight);
        const labelY = blockTop - labelSize * 1.25;
        if (frame.icon === "user") {
          drawUserOutlineIcon(page, frameX + 3.2 * u, labelY + labelSize * 0.32, 4.2 * u);
        } else {
          drawLockOutlineIcon(page, frameX + 3.2 * u, labelY + labelSize * 0.32, 4.2 * u);
        }
        page.text(frame.label, frameX + 6.2 * u, labelY, {
          font: "bold", size: fitTextSize(frame.label, frameWidth - 7.5 * u, labelSize, 2.8 * u)
        });
        page.text(frame.value, frameX + frameWidth / 2, frameBottom + 1.5 * u + valueSize * 0.1, {
          align: "center", font: "bold", size: valueSize
        });
      });
    },
    height: frameHeight
  };
}

function qrAccessBlock({
  contentWidth,
  isThermal,
  padding,
  password,
  singleCode,
  ticket,
  u,
  width
}: {
  contentWidth: number;
  isThermal: boolean;
  padding: number;
  password: string;
  singleCode: boolean;
  ticket: TicketPdfTicket;
  u: number;
  width: number;
}): LayoutBlock {
  const captionSize = 3.4 * u;
  const labelSize = 3.7 * u;
  if (isThermal) {
    // A narrow roll prints the QR code centered, codes underneath.
    const codes = accessCodeBlock({ contentWidth, padding, password, singleCode, ticket, u });
    const qrSize = Math.min(contentWidth * 0.62, 46 * u);
    return {
      draw: (page, x, blockTop) => {
        drawQrPattern(page, x + (width - qrSize) / 2, blockTop - qrSize, qrSize, ticketQrValue(ticket));
        page.text("Scannez pour vous connecter", x + width / 2, blockTop - qrSize - captionSize * 1.1, {
          align: "center", size: captionSize
        });
        codes.draw(page, x, blockTop - qrSize - captionSize * 1.6);
      },
      height: qrSize + captionSize * 1.6 + codes.height
    };
  }
  const qrSize = Math.min(contentWidth * 0.4, 38 * u);
  const detailsX = qrSize + 3 * u;
  const detailsWidth = contentWidth - detailsX;
  const values = singleCode
    ? [{ label: "CODE", value: ticket.username }]
    : [{ label: "LOGIN", value: ticket.username }, { label: "MOT DE PASSE", value: password }];
  const valueSize = Math.min(...values.map((item) => fitTextSize(item.value, detailsWidth - 2.5 * u, singleCode ? 11 * u : 9 * u, 5.5 * u)));
  const frameHeight = labelSize * 1.35 + valueSize * 1.15 + 1.2 * u;
  const framesHeight = values.length * frameHeight + (values.length - 1) * 1.6 * u;
  const height = Math.max(qrSize + captionSize * 1.5, framesHeight);
  return {
    draw: (page, x, blockTop) => {
      const qrX = x + padding;
      drawQrPattern(page, qrX, blockTop - qrSize, qrSize, ticketQrValue(ticket));
      page.text("Scannez-moi", qrX + qrSize / 2, blockTop - qrSize - captionSize * 1.1, {
        align: "center", size: fitTextSize("Scannez-moi", qrSize, captionSize, 2.6 * u)
      });
      let frameTop = blockTop - (height - framesHeight) / 2;
      values.forEach((item) => {
        const frameX = x + padding + detailsX;
        page.rect(frameX, frameTop - frameHeight, detailsWidth, frameHeight);
        page.text(item.label, frameX + detailsWidth / 2, frameTop - labelSize * 1.2, {
          align: "center", font: "bold", size: fitTextSize(item.label, detailsWidth - 2 * u, labelSize, 2.8 * u)
        });
        page.text(item.value, frameX + detailsWidth / 2, frameTop - frameHeight + 1.2 * u + valueSize * 0.1, {
          align: "center", font: "bold", size: valueSize
        });
        frameTop -= frameHeight + 1.6 * u;
      });
    },
    height
  };
}

function drawUserOutlineIcon(page: PdfPage, centerX: number, centerY: number, size: number) {
  const headRadius = size * 0.2;
  const headY = centerY + size * 0.22;
  const shoulderY = centerY - size * 0.3;
  page.strokeCircle(centerX, headY, headRadius);
  page.line(centerX - size * 0.36, shoulderY, centerX - size * 0.28, centerY - size * 0.08);
  page.line(centerX - size * 0.28, centerY - size * 0.08, centerX, centerY);
  page.line(centerX, centerY, centerX + size * 0.28, centerY - size * 0.08);
  page.line(centerX + size * 0.28, centerY - size * 0.08, centerX + size * 0.36, shoulderY);
}

function drawLockOutlineIcon(page: PdfPage, centerX: number, centerY: number, size: number) {
  const bodyWidth = size * 0.62;
  const bodyHeight = size * 0.46;
  const bodyX = centerX - bodyWidth / 2;
  const bodyY = centerY - size * 0.34;
  const shackleHalfWidth = size * 0.2;
  const shackleTop = centerY + size * 0.34;
  const shackleBottom = bodyY + bodyHeight;
  page.rect(bodyX, bodyY, bodyWidth, bodyHeight);
  page.line(centerX - shackleHalfWidth, shackleBottom, centerX - shackleHalfWidth, shackleTop - size * 0.09);
  page.line(centerX - shackleHalfWidth, shackleTop - size * 0.09, centerX - size * 0.1, shackleTop);
  page.line(centerX - size * 0.1, shackleTop, centerX + size * 0.1, shackleTop);
  page.line(centerX + size * 0.1, shackleTop, centerX + shackleHalfWidth, shackleTop - size * 0.09);
  page.line(centerX + shackleHalfWidth, shackleTop - size * 0.09, centerX + shackleHalfWidth, shackleBottom);
  page.fillCircle(centerX, bodyY + bodyHeight * 0.48, Math.max(0.35, size * 0.055));
}

function formatTicketPrintDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isThermalFormat(format: TicketPdfFormat): boolean {
  return format === "thermal58" || format === "thermal80";
}

function getThermalPageSize(input: TicketPdfInput, ticket?: TicketPdfTicket): PageSize {
  const width = pageSizes[input.format].width;
  const margin = grids[input.format].margin;
  const minimum = input.format === "thermal58" ? 80 : 90;
  if (!ticket) return { height: minimum, width };
  const layout = layoutTicket(input, ticket, 1, width - margin * 2, thermalUnit(input.format), null);
  return { height: Math.max(minimum, Math.ceil(layout.naturalHeight + margin * 2)), width };
}

function wrapPdfText(value: string, maxWidth: number, size: number, bold: boolean, maxLines: number): string[] {
  const normalized = normalizePdfText(value);
  if (!normalized) return [];
  const lines: string[] = [];
  let remaining = normalized;

  while (remaining && estimateTextWidth(remaining, size, bold) > maxWidth) {
    let fittingLength = 1;
    while (
      fittingLength < remaining.length
      && estimateTextWidth(remaining.slice(0, fittingLength + 1), size, bold) <= maxWidth
    ) {
      fittingLength += 1;
    }
    const fittingSlice = remaining.slice(0, fittingLength);
    const preferredBreak = Math.max(
      fittingSlice.lastIndexOf(" "),
      fittingSlice.lastIndexOf("-"),
      fittingSlice.lastIndexOf("/"),
      fittingSlice.lastIndexOf(".")
    );
    const breakAt = preferredBreak >= Math.floor(fittingLength * 0.45)
      ? preferredBreak + 1
      : fittingLength;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, maxLines);
  let last = `${visible[maxLines - 1]}...`;
  while (last.length > 3 && estimateTextWidth(last, size, bold) > maxWidth) {
    last = `${last.slice(0, -4)}...`;
  }
  visible[maxLines - 1] = last;
  return visible;
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

  strokeCircle(x: number, y: number, radius: number) {
    const control = radius * 0.55228475;
    this.commands.push(
      `0.35 w ${fixed(x + radius)} ${fixed(y)} m `
      + `${fixed(x + radius)} ${fixed(y + control)} ${fixed(x + control)} ${fixed(y + radius)} ${fixed(x)} ${fixed(y + radius)} c `
      + `${fixed(x - control)} ${fixed(y + radius)} ${fixed(x - radius)} ${fixed(y + control)} ${fixed(x - radius)} ${fixed(y)} c `
      + `${fixed(x - radius)} ${fixed(y - control)} ${fixed(x - control)} ${fixed(y - radius)} ${fixed(x)} ${fixed(y - radius)} c `
      + `${fixed(x + control)} ${fixed(y - radius)} ${fixed(x + radius)} ${fixed(y - control)} ${fixed(x + radius)} ${fixed(y)} c S`
    );
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
    objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

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
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // WinAnsi bytes above 126 are written as octal escapes: the file stays
    // ASCII while é, à, ç… keep their glyph.
    .replace(/[\x80-\xFF]/g, (character) => `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

function fixed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Text is written with the standard Helvetica fonts in WinAnsiEncoding, so
 * French accents (é, è, à, ç…) print as such. Characters outside Latin-1 are
 * replaced by their closest equivalent or removed.
 */
function normalizePdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\u2026/g, "...")
    .split("")
    .map((character) => character.charCodeAt(0) <= 0xff
      ? character
      : character.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .join("")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .trim();
}

// Helvetica and Helvetica-Bold advance widths (Adobe AFM, 1/1000 em) for
// ASCII 32-126. Accented letters use the width of their base letter.
const helveticaWidths = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const helveticaBoldWidths = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function characterWidth(character: string, isBold: boolean): number {
  const code = character.charCodeAt(0);
  const table = isBold ? helveticaBoldWidths : helveticaWidths;
  if (code >= 32 && code <= 126) return table[code - 32];
  const base = character.normalize("NFD").charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32];
  return 556;
}

function estimateTextWidth(value: string, size: number, isBold: boolean): number {
  let total = 0;
  for (const character of value) total += characterWidth(character, isBold);
  return (total * size) / 1000;
}

function textWidth(value: string, size: number, isBold: boolean): number {
  return estimateTextWidth(normalizePdfText(value), size, isBold);
}

function fitTextSize(value: string, maxWidth: number, preferredSize: number, minimumSize: number): number {
  const estimatedAtPreferred = estimateTextWidth(normalizePdfText(value), preferredSize, true);
  if (estimatedAtPreferred <= maxWidth) {
    return preferredSize;
  }

  return Math.max(minimumSize, preferredSize * (maxWidth / estimatedAtPreferred));
}
