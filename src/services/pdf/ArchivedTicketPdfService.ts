import type {
  AccountRecord,
  GeneratedFileRecord,
  HotspotPlanRecord,
  RouterRecord,
  TicketBatchRecord,
  TicketRecord
} from "../../domain/database";
import { resolveTicketPasswordValue } from "../tickets";
import { defaultTicketDisplaySettings } from "../tickets/TicketDisplaySettingsService";
import {
  formatTicketValidityLabel,
  generateTicketPdf,
  parseTicketPdfArchiveMetadata,
  type TicketPdfFormat,
  type TicketPdfInput
} from "./TicketPdfService";

export type RegeneratedTicketPdf = {
  bytes: Uint8Array;
  format: TicketPdfFormat;
  input: TicketPdfInput;
  ticketCount: number;
};

export async function regenerateArchivedTicketPdf(input: {
  account: AccountRecord;
  batch: TicketBatchRecord;
  file: GeneratedFileRecord;
  plan: HotspotPlanRecord;
  router: RouterRecord;
  tickets: TicketRecord[];
}): Promise<RegeneratedTicketPdf> {
  assertArchiveOwnership(input);
  if (input.tickets.length === 0) {
    throw new Error("Ce lot ne contient aucun ticket à remettre dans le PDF.");
  }

  const metadata = parseTicketPdfArchiveMetadata(input.file.metadata_json);
  const ownerPhone = metadata?.ownerPhone.trim() || input.account.phone?.trim();
  const hotspotAddress = metadata?.hotspotAddress.trim() || input.router.hotspot_address?.trim();

  if (!hotspotAddress) {
    throw new Error("Renseignez l'adresse Hotspot du routeur avant de régénérer le PDF.");
  }

  const tickets = await Promise.all(
    input.tickets.map(async (ticket) => ({
      password: await resolveTicketPasswordValue({
        passwordSecretRef: ticket.password_encrypted,
        username: ticket.username
      }),
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    }))
  );
  const pdfInput = applyArchivedTicketTimingSnapshots({
    input: {
      accountId: input.account.id,
      batchId: input.batch.id,
      createdByProfile: input.file.created_by_profile,
      createdByProfileId: input.file.created_by_profile_id,
      currency: metadata?.currency ?? (input.batch.currency?.trim() || "CFA"),
      dataLimitLabel: metadata?.dataLimitLabel ?? formatDataLimit(input.plan.data_limit_mb),
      displaySettings: metadata?.displaySettings ?? {
        ...defaultTicketDisplaySettings,
        showContact: Boolean(ownerPhone)
      },
      durationLabel: metadata?.durationLabel?.trim() || formatDuration(input.plan.duration_minutes),
      fileName: input.file.file_name,
      format: metadata?.format ?? normalizeArchivedFormat(input.file.format),
      generatedAt: new Date().toISOString(),
      hotspotAddress,
      ownerPhone: ownerPhone ?? "",
      planName: metadata?.planName ?? input.plan.name,
      priceLabel:
        metadata?.priceLabel ??
        ((input.batch.price_snapshot ?? input.plan.price_hint) === null
          ? null
          : `${(input.batch.price_snapshot ?? input.plan.price_hint)!.toLocaleString("fr-FR")} ${input.batch.currency?.trim() || "CFA"}`),
      qrCodeEnabled: metadata?.qrCodeEnabled ?? false,
      routerId: input.router.id,
      template: metadata?.template === "qr" ? "economy" : metadata?.template ?? "economy",
      tickets,
      titleLabel: metadata?.titleLabel ?? metadata?.zoneName ?? input.router.name,
      validityLabel: metadata?.validityLabel?.trim()
        || formatDuration(input.plan.validity_minutes ?? input.plan.duration_minutes),
      zoneName: metadata?.zoneName ?? input.router.name
    },
    plan: input.plan,
    tickets: input.tickets
  });

  return {
    bytes: generateTicketPdf(pdfInput),
    format: pdfInput.format,
    input: pdfInput,
    ticketCount: tickets.length
  };
}

export function applyArchivedTicketTimingSnapshots(input: {
  input: TicketPdfInput;
  plan?: Pick<HotspotPlanRecord, "duration_minutes" | "validity_minutes"> | null;
  tickets: Array<Pick<TicketRecord, "duration_minutes_snapshot" | "validity_minutes_snapshot">>;
}): TicketPdfInput {
  const durationMinutes = firstPositiveSnapshot(
    input.tickets.map((ticket) => ticket.duration_minutes_snapshot)
  );
  const validityMinutes = firstPositiveSnapshot(
    input.tickets.map((ticket) => ticket.validity_minutes_snapshot)
  );
  const planDurationMinutes = positiveMinutes(input.plan?.duration_minutes);
  const planValidityMinutes = positiveMinutes(input.plan?.validity_minutes);
  const resolvedDuration = durationMinutes ?? planDurationMinutes;
  const resolvedValidity = validityMinutes ?? planValidityMinutes;

  return {
    ...input.input,
    durationLabel: resolvedDuration
      ? formatDuration(resolvedDuration)
      : input.input.durationLabel,
    validityLabel: resolvedValidity
      ? formatTicketValidityLabel(resolvedValidity)
      : input.input.validityLabel || input.input.durationLabel
  };
}

function assertArchiveOwnership(input: {
  account: AccountRecord;
  batch: TicketBatchRecord;
  file: GeneratedFileRecord;
  plan: HotspotPlanRecord;
  router: RouterRecord;
  tickets: TicketRecord[];
}) {
  if (
    input.file.account_id !== input.account.id ||
    input.batch.account_id !== input.account.id ||
    input.router.account_id !== input.account.id ||
    input.file.batch_id !== input.batch.id ||
    input.file.router_id !== input.router.id ||
    input.batch.router_id !== input.router.id ||
    input.batch.plan_id !== input.plan.id ||
    input.tickets.some(
      (ticket) =>
        ticket.account_id !== input.account.id ||
        ticket.batch_id !== input.batch.id ||
        ticket.router_id !== input.router.id
    )
  ) {
    throw new Error("Les données de ce fichier ne correspondent pas au compte actif.");
  }
}

function normalizeArchivedFormat(value: string): TicketPdfFormat {
  return ["a4", "a5", "thermal58", "thermal80"].includes(value)
    ? (value as TicketPdfFormat)
    : "a4";
}

function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function formatDataLimit(megabytes: number | null): string | null {
  if (megabytes === null) return null;
  if (megabytes >= 1024 && megabytes % 1024 === 0) return `${megabytes / 1024} Go`;
  return `${megabytes} Mo`;
}

function firstPositiveSnapshot(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    const normalized = positiveMinutes(value);
    if (normalized) return normalized;
  }
  return null;
}

function positiveMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}
