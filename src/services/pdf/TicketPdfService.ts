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
  if (isThermal) {
    drawThermalTicket(page, { cellHeight, cellWidth, index, input, ticket, x, y });
    return;
  }

  drawEconomyGridTicket(page, { cellHeight, cellWidth, index, input, ticket, x, y });
}

function drawEconomyGridTicket(
  page: PdfPage,
  {
    cellHeight,
    cellWidth,
    index,
    input,
    ticket,
    x,
    y
  }: {
    cellHeight: number;
    cellWidth: number;
    index: number;
    input: TicketPdfInput;
    ticket: TicketPdfTicket;
    x: number;
    y: number;
  }
) {
  const compact = input.format === "a4";
  const padding = compact ? 5 : 7;
  const contentWidth = cellWidth - padding * 2;
  const centerX = x + cellWidth / 2;
  const top = y + cellHeight;
  const settings = input.displaySettings;
  const password = resolveTicketPdfPassword(ticket);
  const singleCode = password === ticket.username;
  const showQr = (settings?.showQrCode ?? input.qrCodeEnabled) || input.template === "qr";
  const header = input.titleLabel || input.zoneName || "ACCES WIFI";
  const showTicketNumber = settings?.showTicketNumber !== false;
  const showPrice = settings?.showPrice !== false && Boolean(input.priceLabel);
  const showPlan = Boolean(settings?.showPlanName && input.planName);
  const showData = Boolean(settings?.showDataLimit && input.dataLimitLabel);
  const showCreatedAt = settings?.showCreatedAt === true;
  const showPortal = settings?.showInstructions !== false && Boolean(input.hotspotAddress);
  const showContact = Boolean(settings?.showContact && input.ownerPhone);
  const showNote = Boolean(settings?.showNote && settings.noteText);
  const showPoweredBy = settings?.showPoweredBy !== false;

  page.rect(x, y, cellWidth, cellHeight);

  page.text(header, centerX, top - (compact ? 12 : 15), {
    align: "center",
    font: "bold",
    size: fitTextSize(header, contentWidth, compact ? 7.4 : 9, compact ? 5 : 6)
  });
  if (showTicketNumber) {
    page.text(`#${String(index).padStart(2, "0")}`, centerX, top - (compact ? 20 : 25), {
      align: "center",
      size: compact ? 3.4 : 4.4
    });
  }
  if (showPlan) {
    page.text(input.planName, centerX, top - (compact ? 25 : 31), {
      align: "center",
      font: "bold",
      size: fitTextSize(input.planName, contentWidth, compact ? 3.8 : 5, compact ? 2.8 : 3.5)
    });
  }

  if (showQr) {
    drawEconomyQrBody(page, {
      cellHeight,
      cellWidth,
      compact,
      input,
      password,
      singleCode,
      ticket,
      x,
      y
    });
  } else {
    drawEconomyCodeBody(page, {
      cellHeight,
      cellWidth,
      compact,
      input,
      password,
      singleCode,
      ticket,
      x,
      y
    });
  }

  const footerLines: Array<{ bold?: boolean; text: string }> = [
    ...(!showQr && showPrice && input.priceLabel ? [{ bold: true, text: input.priceLabel }] : []),
    // Cette date décrit le document effectivement produit, y compris lors
    // d'une réimpression : elle n'est donc pas confondue avec la création du lot.
    { text: formatTicketPrintDate(input.printedAt) },
    ...(showData && input.dataLimitLabel ? [{ text: `Volume : ${input.dataLimitLabel}` }] : []),
    ...(showCreatedAt ? [{ text: `Cree le ${input.generatedAt.slice(0, 16).replace("T", " ")}` }] : []),
    ...(showPortal ? [{ text: `Portail : ${input.hotspotAddress}` }] : []),
    ...(showContact ? [{ text: `Contact : ${input.ownerPhone}` }] : []),
    ...(showNote && settings?.noteText ? [{ text: settings.noteText }] : [])
  ];
  const footerBottom = y + (showPoweredBy ? (compact ? 8 : 10) : compact ? 3 : 4);
  const footerTop = y + (showQr ? cellHeight * 0.29 : cellHeight * 0.24);
  const footerGap = Math.max(
    compact ? 3.4 : 4.2,
    Math.min(compact ? 5.8 : 7, (footerTop - footerBottom) / Math.max(1, footerLines.length))
  );
  const footerFontSize = footerLines.length > 3
    ? { maximum: compact ? 3 : 4, minimum: compact ? 2.3 : 3 }
    : { maximum: compact ? 3.7 : 4.8, minimum: compact ? 2.7 : 3.5 };
  let footerY = footerBottom + footerGap * Math.max(0, footerLines.length - 1);
  footerLines.forEach((line) => {
    page.text(line.text, centerX, footerY, {
      align: "center",
      font: line.bold ? "bold" : "regular",
      size: fitTextSize(line.text, contentWidth, footerFontSize.maximum, footerFontSize.minimum)
    });
    footerY -= footerGap;
  });

  if (showPoweredBy) {
    page.text("Propulse par TicketPro", centerX, y + (compact ? 3.6 : 4.8), {
      align: "center",
      font: "bold",
      size: compact ? 3.2 : 4
    });
  }
}

function drawEconomyCodeBody(
  page: PdfPage,
  {
    cellHeight,
    cellWidth,
    compact,
    input,
    password,
    singleCode,
    ticket,
    x,
    y
  }: {
    cellHeight: number;
    cellWidth: number;
    compact: boolean;
    input: TicketPdfInput;
    password: string;
    singleCode: boolean;
    ticket: TicketPdfTicket;
    x: number;
    y: number;
  }
) {
  const settings = input.displaySettings;
  const padding = compact ? 8 : 10;
  const bandX = x + padding;
  const bandWidth = cellWidth - padding * 2;
  const bandTop = y + cellHeight * (settings?.showPlanName ? 0.69 : 0.72);
  const iconColumnWidth = compact ? 12 : 16;
  const iconX = bandX + iconColumnWidth / 2;
  let credentialsBottom: number;

  if (singleCode) {
    const bandHeight = cellHeight * 0.2;
    const bandBottom = bandTop - bandHeight;
    const valueCenterX = bandX + iconColumnWidth + (bandWidth - iconColumnWidth) / 2;
    page.rect(bandX, bandBottom, bandWidth, bandHeight);
    drawUserOutlineIcon(page, iconX, bandBottom + bandHeight / 2, compact ? 5.5 : 7.5);
    page.text(ticket.username, valueCenterX, bandBottom + bandHeight * 0.32, {
      align: "center",
      font: "bold",
      size: fitTextSize(ticket.username, bandWidth - iconColumnWidth - 12, compact ? 10.5 : 14, compact ? 6.3 : 8)
    });
    credentialsBottom = bandBottom;
  } else {
    // A4 conserve 40 vouchers par page : les deux cadres restent donc compacts
    // afin de laisser une zone lisible pour durée, validité et informations.
    const frameGap = compact ? 2 : 3.2;
    const frameHeight = compact ? 7.4 : 13;
    const passwordBottom = bandTop - frameHeight * 2 - frameGap;
    const loginBottom = passwordBottom + frameHeight + frameGap;
    drawCredentialFrame(page, {
      compact,
      height: frameHeight,
      icon: "user",
      label: "LOGIN",
      value: ticket.username,
      width: bandWidth,
      x: bandX,
      y: loginBottom
    });
    drawCredentialFrame(page, {
      compact,
      height: frameHeight,
      icon: "lock",
      label: "MOT DE PASSE",
      value: password,
      width: bandWidth,
      x: bandX,
      y: passwordBottom
    });
    credentialsBottom = passwordBottom;
  }

  const metricTop = credentialsBottom - (compact ? 5 : 7);
  const metrics = [
    { label: "DUREE", value: input.durationLabel },
    { label: "VALIDITE", value: input.validityLabel }
  ];
  const metricWidth = (cellWidth - padding * 2) / metrics.length;
  metrics.forEach((metric, index) => {
    const metricX = x + padding + metricWidth * (index + 0.5);
    if (index > 0) {
      const separatorX = x + padding + metricWidth * index;
      page.line(separatorX, metricTop - (compact ? 2 : 3), separatorX, metricTop - (compact ? 18 : 23));
    }
    page.text(metric.label, metricX, metricTop - (compact ? 5 : 6.5), {
      align: "center",
      font: "bold",
      size: compact ? 2.6 : 3.5
    });
    page.text(metric.value, metricX, metricTop - (compact ? 15 : 20), {
      align: "center",
      font: "bold",
      size: fitTextSize(metric.value, metricWidth - 5, compact ? 6.1 : 8, compact ? 3.8 : 5)
    });
  });
}

function drawCredentialFrame(
  page: PdfPage,
  {
    compact,
    height,
    icon,
    label,
    value,
    width,
    x,
    y
  }: {
    compact: boolean;
    height: number;
    icon: "lock" | "user";
    label: string;
    value: string;
    width: number;
    x: number;
    y: number;
  }
) {
  const iconColumnWidth = compact ? 10 : 14;
  const iconX = x + iconColumnWidth / 2;
  const valueX = x + iconColumnWidth + 2;
  const valueWidth = width - iconColumnWidth - 5;

  page.rect(x, y, width, height);
  if (icon === "user") {
    drawUserOutlineIcon(page, iconX, y + height / 2, compact ? 4.4 : 5.8);
  } else {
    drawLockOutlineIcon(page, iconX, y + height / 2, compact ? 4.2 : 5.6);
  }
  page.text(label, valueX, y + height * (compact ? 0.59 : 0.62), {
    font: "bold",
    size: compact ? 2.25 : 3
  });
  page.text(value, x + width - 2, y + height * (compact ? 0.2 : 0.18), {
    align: "right",
    font: "bold",
    size: fitTextSize(value, valueWidth, compact ? 5.8 : 7.6, compact ? 3.8 : 4.9)
  });
}

function drawEconomyQrBody(
  page: PdfPage,
  {
    cellHeight,
    cellWidth,
    compact,
    input,
    password,
    singleCode,
    ticket,
    x,
    y
  }: {
    cellHeight: number;
    cellWidth: number;
    compact: boolean;
    input: TicketPdfInput;
    password: string;
    singleCode: boolean;
    ticket: TicketPdfTicket;
    x: number;
    y: number;
  }
) {
  const settings = input.displaySettings;
  const mainTop = y + cellHeight * (settings?.showPlanName ? 0.69 : 0.72);
  const qrSize = Math.min(cellWidth * 0.31, cellHeight * 0.31);
  const qrX = x + (compact ? 6 : 8);
  const qrY = y + cellHeight * 0.35;
  const detailsX = qrX + qrSize + (compact ? 5 : 7);
  const detailsWidth = x + cellWidth - (compact ? 6 : 8) - detailsX;
  const detailsCenterX = detailsX + detailsWidth / 2;

  drawQrPattern(page, qrX, qrY, qrSize, ticketQrValue(ticket));
  page.text("Scannez pour vous connecter", qrX + qrSize / 2, qrY - (compact ? 4 : 5), {
    align: "center",
    size: fitTextSize("Scannez pour vous connecter", qrSize + 5, compact ? 2.2 : 3, compact ? 1.8 : 2.3)
  });

  drawUserOutlineIcon(page, detailsX + (compact ? 4 : 5), mainTop - (compact ? 5 : 7), compact ? 5 : 7);
  page.text("LOGIN", detailsX + (compact ? 11 : 14), mainTop - (compact ? 5.5 : 7), {
    font: "bold",
    size: compact ? 2.8 : 3.7
  });
  page.text(ticket.username, detailsCenterX, mainTop - (compact ? 17 : 22), {
    align: "center",
    font: "bold",
    size: fitTextSize(ticket.username, detailsWidth, compact ? 8.2 : 11, compact ? 5.2 : 7)
  });

  let detailY = mainTop - (compact ? 27 : 35);
  if (!singleCode) {
    const passwordFrameHeight = compact ? 10 : 13;
    const passwordFrameBottom = detailY - passwordFrameHeight * 0.65;
    drawCredentialFrame(page, {
      compact,
      height: passwordFrameHeight,
      icon: "lock",
      label: "MOT DE PASSE",
      value: password,
      width: detailsWidth,
      x: detailsX,
      y: passwordFrameBottom
    });
    detailY = passwordFrameBottom - (compact ? 5 : 7);
  }
  if (settings?.showPrice !== false && input.priceLabel) {
    page.text(input.priceLabel, detailsCenterX, detailY, {
      align: "center",
      font: "bold",
      size: fitTextSize(input.priceLabel, detailsWidth, compact ? 5.7 : 7.5, compact ? 3.8 : 5)
    });
    detailY -= compact ? 10 : 13;
  }
  const durationValidity = `${input.durationLabel} | VALIDE ${input.validityLabel}`;
  page.text(durationValidity, detailsCenterX, detailY, {
    align: "center",
    font: "bold",
    size: fitTextSize(durationValidity, detailsWidth, compact ? 3.4 : 4.5, compact ? 2.4 : 3.2)
  });
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

function drawThermalTicket(
  page: PdfPage,
  {
    cellHeight,
    cellWidth,
    index,
    input,
    ticket,
    x,
    y
  }: {
    cellHeight: number;
    cellWidth: number;
    index: number;
    input: TicketPdfInput;
    ticket: TicketPdfTicket;
    x: number;
    y: number;
  }
) {
  const is58 = input.format === "thermal58";
  const padding = is58 ? 8 : 10;
  const contentWidth = cellWidth - padding * 2;
  const centerX = x + cellWidth / 2;
  const password = resolveTicketPdfPassword(ticket);
  const settings = input.displaySettings;
  const showUsername = true;
  const isSingleCode = password === ticket.username;
  const showQr = (settings?.showQrCode ?? input.qrCodeEnabled) || input.template === "qr";
  const header = input.titleLabel || input.zoneName || "ACCES WIFI";
  const headerLines = wrapPdfText(header, contentWidth, is58 ? 9 : 10, true, 2);
  const portalLines = settings?.showInstructions === false || !input.hotspotAddress
    ? []
    : wrapPdfText(`Portail : ${input.hotspotAddress}`, contentWidth, is58 ? 6.6 : 7.2, true, 3);
  const contactLines = !settings?.showContact || !input.ownerPhone
    ? []
    : wrapPdfText(`Contact : ${input.ownerPhone}`, contentWidth, is58 ? 6.2 : 6.8, false, 2);
  const detailLines = [
    `Duree : ${input.durationLabel}`,
    `Validite : ${input.validityLabel}`,
    formatTicketPrintDate(input.printedAt),
    settings?.showDataLimit ? input.dataLimitLabel : null,
    input.priceLabel && settings?.showPrice !== false ? input.priceLabel : null,
    settings?.showCreatedAt ? `Cree le ${input.generatedAt.slice(0, 10)}` : null,
    settings?.showNote ? settings.noteText : null
  ].filter((line): line is string => Boolean(line));

  page.rect(x, y, cellWidth, cellHeight);
  if (input.template === "premium") {
    page.fillRect(x, y + cellHeight - 3, cellWidth, 3, 0.72);
  }

  let cursor = y + cellHeight - padding;
  headerLines.forEach((line) => {
    cursor -= is58 ? 9 : 10;
    page.text(line, centerX, cursor, { align: "center", font: "bold", size: is58 ? 9 : 10 });
  });
  if (settings?.showTicketNumber !== false) {
    page.text(`#${String(index).padStart(2, "0")}`, x + cellWidth - padding, y + cellHeight - padding, {
      align: "right",
      size: is58 ? 5 : 5.5
    });
  }
  cursor -= 5;

  const credentialHeight = isSingleCode ? (is58 ? 34 : 38) : (is58 ? 50 : 54);
  const credentialBottom = cursor - credentialHeight;
  if (isSingleCode) {
    page.rect(x + padding, credentialBottom, contentWidth, credentialHeight);
    page.text("LOGIN", centerX, cursor - 10, { align: "center", font: "bold", size: is58 ? 6.2 : 6.8 });
    page.text(showUsername ? ticket.username : "", centerX, cursor - 27, {
      align: "center",
      font: "bold",
      size: fitTextSize(ticket.username, contentWidth - 10, is58 ? 14 : 16, is58 ? 9 : 10)
    });
  } else {
    const frameGap = is58 ? 4 : 5;
    const frameHeight = (credentialHeight - frameGap) / 2;
    const loginBottom = credentialBottom + frameHeight + frameGap;
    drawThermalCredentialFrame(page, {
      height: frameHeight,
      label: "LOGIN",
      value: showUsername ? ticket.username : "",
      width: contentWidth,
      x: x + padding,
      y: loginBottom,
      valueSize: is58 ? 11 : 13
    });
    drawThermalCredentialFrame(page, {
      height: frameHeight,
      label: "MOT DE PASSE",
      value: password,
      width: contentWidth,
      x: x + padding,
      y: credentialBottom,
      valueSize: is58 ? 11 : 13
    });
  }
  cursor = credentialBottom - 7;

  if (settings?.showPlanName) {
    page.text(input.planName, centerX, cursor, {
      align: "center",
      font: "bold",
      size: fitTextSize(input.planName, contentWidth, is58 ? 8.5 : 9.5, is58 ? 6.5 : 7)
    });
  } else {
    cursor += is58 ? 9 : 10;
  }
  detailLines.forEach((line) => {
    cursor -= is58 ? 8.5 : 9;
    page.text(line, centerX, cursor, {
      align: "center",
      font: line === input.priceLabel ? "bold" : "regular",
      size: fitTextSize(line, contentWidth, is58 ? 6.5 : 7.2, is58 ? 5.4 : 5.8)
    });
  });

  if (showQr) {
    const qrSize = is58 ? 48 : 58;
    cursor -= qrSize + 7;
    drawQrPattern(page, centerX - qrSize / 2, cursor, qrSize, ticketQrValue(ticket));
  }

  cursor -= 7;
  page.line(x + padding, cursor, x + cellWidth - padding, cursor);
  portalLines.forEach((line) => {
    cursor -= is58 ? 8 : 8.5;
    page.text(line, centerX, cursor, { align: "center", font: "bold", size: is58 ? 6.6 : 7.2 });
  });
  contactLines.forEach((line) => {
    cursor -= is58 ? 7.5 : 8;
    page.text(line, centerX, cursor, { align: "center", size: is58 ? 6.2 : 6.8 });
  });
  if (settings?.showPoweredBy !== false) {
    cursor -= is58 ? 6.5 : 7;
    page.text("Propulse par TicketPro", centerX, cursor, { align: "center", size: is58 ? 4.8 : 5.2 });
  }
}

function formatTicketPrintDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function drawThermalCredentialFrame(
  page: PdfPage,
  {
    height,
    label,
    value,
    valueSize,
    width,
    x,
    y
  }: {
    height: number;
    label: string;
    value: string;
    valueSize: number;
    width: number;
    x: number;
    y: number;
  }
) {
  page.rect(x, y, width, height);
  page.text(label, x + width / 2, y + height * 0.62, {
    align: "center",
    font: "bold",
    size: 5.8
  });
  page.text(value, x + width / 2, y + height * 0.17, {
    align: "center",
    font: "bold",
    size: fitTextSize(value, width - 10, valueSize, 8)
  });
}

function isThermalFormat(format: TicketPdfFormat): boolean {
  return format === "thermal58" || format === "thermal80";
}

function getThermalPageSize(input: TicketPdfInput, ticket?: TicketPdfTicket): PageSize {
  const width = pageSizes[input.format].width;
  if (!ticket) return { height: input.format === "thermal58" ? 120 : 128, width };
  const is58 = input.format === "thermal58";
  const settings = input.displaySettings;
  const contentWidth = width - grids[input.format].margin * 2 - (is58 ? 16 : 20);
  const password = resolveTicketPdfPassword(ticket);
  const header = input.titleLabel || input.zoneName || "ACCES WIFI";
  const headerCount = wrapPdfText(header, contentWidth, is58 ? 9 : 10, true, 2).length;
  const portalCount = settings?.showInstructions === false || !input.hotspotAddress
    ? 0
    : wrapPdfText(`Portail : ${input.hotspotAddress}`, contentWidth, is58 ? 6.6 : 7.2, true, 3).length;
  const contactCount = !settings?.showContact || !input.ownerPhone
    ? 0
    : wrapPdfText(`Contact : ${input.ownerPhone}`, contentWidth, is58 ? 6.2 : 6.8, false, 2).length;
  const detailCount = [
    "duration",
    "validity",
    "printed",
    settings?.showDataLimit && input.dataLimitLabel ? "data" : null,
    input.priceLabel && settings?.showPrice !== false ? "price" : null,
    settings?.showCreatedAt ? "created" : null,
    settings?.showNote ? "note" : null
  ].filter(Boolean).length;
  const singleCode = password === ticket.username;
  const showQr = (settings?.showQrCode ?? input.qrCodeEnabled) || input.template === "qr";
  const height = (is58 ? 16 : 20)
    + headerCount * (is58 ? 9 : 10)
    + 5
    + (singleCode ? (is58 ? 34 : 38) : (is58 ? 50 : 54))
    + 7
    + (settings?.showPlanName ? (is58 ? 9 : 10) : 0)
    + detailCount * (is58 ? 8.5 : 9)
    + (showQr ? (is58 ? 55 : 65) : 0)
    + 7
    + portalCount * (is58 ? 8 : 8.5)
    + contactCount * (is58 ? 7.5 : 8)
    + (settings?.showPoweredBy === false ? 0 : is58 ? 6.5 : 7)
    + 5;
  return { height: Math.max(is58 ? 122 : 132, Math.ceil(height)), width };
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
