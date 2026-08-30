import { normalizeTicketDisplaySettings, type TicketDisplaySettings } from "../tickets/TicketDisplaySettingsService";
import type {
  TicketPdfFormat,
  TicketPdfInput,
  TicketPdfTemplate
} from "./TicketPdfService";

export type TicketPrintArchivePayload = {
  batchId: string;
  currency?: string | null;
  dataLimitLabel: string | null;
  displaySettings?: TicketDisplaySettings;
  durationLabel: string;
  format: TicketPdfFormat;
  hotspotAddress: string;
  ownerPhone: string;
  planName: string;
  priceLabel?: string | null;
  qrCodeEnabled: boolean;
  template: TicketPdfTemplate;
  tickets: Array<{ password: string; username: string }>;
  titleLabel: string;
  validityLabel: string;
  version: 1;
  zoneName: string;
};

export type TicketPrintArchiveContext = {
  accountId: string;
  batchId: string;
  createdByProfile: string;
  createdByProfileId: string;
  fileName: string;
  generatedAt?: string;
  routerId: string;
};

export function createTicketPrintArchivePayload(input: TicketPdfInput): TicketPrintArchivePayload {
  if (input.tickets.length === 0 || input.tickets.length > 500) {
    throw new Error("L'archive d'impression doit contenir entre 1 et 500 vouchers.");
  }
  const usernames = new Set<string>();
  const tickets = input.tickets.map((ticket) => {
    const username = ticket.username.trim();
    const password = ticket.password;
    if (!username || password === undefined || password.length === 0) {
      throw new Error("Un voucher ne possède pas les données nécessaires à sa réimpression.");
    }
    if (usernames.has(username)) {
      throw new Error(`Le voucher ${username} apparaît plusieurs fois dans l'archive.`);
    }
    usernames.add(username);
    return { password, username };
  });

  return {
    batchId: input.batchId,
    currency: input.currency?.trim() || null,
    dataLimitLabel: input.dataLimitLabel,
    displaySettings: input.displaySettings,
    durationLabel: input.durationLabel,
    format: input.format,
    hotspotAddress: input.hotspotAddress,
    ownerPhone: input.ownerPhone,
    planName: input.planName,
    priceLabel: input.priceLabel ?? null,
    qrCodeEnabled: input.qrCodeEnabled,
    template: input.template,
    tickets,
    titleLabel: input.titleLabel,
    validityLabel: input.validityLabel,
    version: 1,
    zoneName: input.zoneName
  };
}

export function ticketPdfInputFromPrintArchive(
  rawArchive: TicketPrintArchivePayload,
  context: TicketPrintArchiveContext
): TicketPdfInput {
  const archive = normalizeTicketPrintArchivePayload(rawArchive);
  if (archive.batchId !== context.batchId) {
    throw new Error("L'archive d'impression ne correspond pas au lot demandé.");
  }
  return {
    accountId: context.accountId,
    batchId: context.batchId,
    createdByProfile: context.createdByProfile,
    createdByProfileId: context.createdByProfileId,
    currency: archive.currency ?? undefined,
    dataLimitLabel: archive.dataLimitLabel,
    displaySettings: archive.displaySettings,
    durationLabel: archive.durationLabel,
    fileName: context.fileName,
    format: archive.format,
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    hotspotAddress: archive.hotspotAddress,
    ownerPhone: archive.ownerPhone,
    planName: archive.planName,
    priceLabel: archive.priceLabel ?? null,
    qrCodeEnabled: archive.qrCodeEnabled,
    routerId: context.routerId,
    template: archive.template,
    tickets: archive.tickets.map((ticket) => ({
      password: ticket.password,
      passwordSecretRef: `archive://${context.batchId}/${encodeURIComponent(ticket.username)}/password`,
      username: ticket.username
    })),
    titleLabel: archive.titleLabel,
    validityLabel: archive.validityLabel,
    zoneName: archive.zoneName
  };
}

export function normalizeTicketPrintArchivePayload(value: TicketPrintArchivePayload): TicketPrintArchivePayload {
  if (!value || value.version !== 1 || !Array.isArray(value.tickets)) {
    throw new Error("Archive d'impression invalide.");
  }
  const formats: TicketPdfFormat[] = ["a4", "a5", "thermal58", "thermal80"];
  const templates: TicketPdfTemplate[] = ["economy", "premium", "qr", "simple"];
  if (!formats.includes(value.format) || !templates.includes(value.template)) {
    throw new Error("Format d'archive d'impression invalide.");
  }
  const normalized: TicketPrintArchivePayload = {
    batchId: requiredText(value.batchId, "lot", 240),
    currency: optionalText(value.currency, 12),
    dataLimitLabel: optionalText(value.dataLimitLabel, 80),
    displaySettings: value.displaySettings
      ? normalizeTicketDisplaySettings(value.displaySettings)
      : undefined,
    durationLabel: requiredText(value.durationLabel, "durée", 80),
    format: value.format,
    hotspotAddress: requiredText(value.hotspotAddress, "portail Hotspot", 255),
    ownerPhone: optionalText(value.ownerPhone, 40) ?? "",
    planName: requiredText(value.planName, "plan", 200),
    priceLabel: optionalText(value.priceLabel, 100),
    qrCodeEnabled: value.qrCodeEnabled === true,
    template: value.template,
    tickets: [],
    titleLabel: requiredText(value.titleLabel, "titre", 200),
    validityLabel: requiredText(value.validityLabel, "validité", 80),
    version: 1,
    zoneName: requiredText(value.zoneName, "zone", 200)
  };
  if (value.tickets.length < 1 || value.tickets.length > 500) {
    throw new Error("Nombre de vouchers archivé invalide.");
  }
  const usernames = new Set<string>();
  normalized.tickets = value.tickets.map((ticket) => {
    const username = requiredText(ticket?.username, "identifiant voucher", 128);
    const password = requiredPassword(ticket?.password);
    if (usernames.has(username)) throw new Error(`Voucher dupliqué dans l'archive : ${username}.`);
    usernames.add(username);
    return { password, username };
  });
  return normalized;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) throw new Error(`Champ ${label} invalide dans l'archive.`);
  return text;
}

function requiredPassword(value: unknown): string {
  const text = String(value ?? "");
  if (!text || text.length > 256) throw new Error("Mot de passe voucher invalide dans l'archive.");
  return text;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error("Champ trop long dans l'archive d'impression.");
  return text;
}
