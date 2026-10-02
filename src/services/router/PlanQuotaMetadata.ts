import { dataLimitMbToBytes } from "../tickets/VoucherQuota";

const MARKER = "# TICKETPRO-PLAN-QUOTA v1 ";

export type TicketProProfileMetadata = {
  dataLimitMb: number | null;
  durationMinutes?: number;
  validityMinutes?: number | null;
};

/** A script comment is supported on RouterOS user profiles; a `comment` field is not. */
export function writePlanQuotaMetadata(
  source: string,
  input: number | null | TicketProProfileMetadata
): string {
  const metadata = typeof input === "object" && input !== null ? input : { dataLimitMb: input };
  dataLimitMbToBytes(metadata.dataLimitMb);
  if (metadata.durationMinutes !== undefined && (!Number.isInteger(metadata.durationMinutes) || metadata.durationMinutes <= 0)) throw new Error("La durée TicketPro du profil est invalide.");
  if (metadata.validityMinutes !== undefined && metadata.validityMinutes !== null && (!Number.isInteger(metadata.validityMinutes) || metadata.validityMinutes <= 0)) throw new Error("La validité TicketPro du profil est invalide.");
  const preserved = source.split(/\r?\n/).filter(line => !line.trim().startsWith(MARKER)).join("\r\n").trim();
  return `${MARKER}${JSON.stringify(metadata)}\r\n${preserved}`;
}

export function readPlanQuotaMetadata(source: string | undefined): TicketProProfileMetadata | null {
  const lines = (source ?? "").split(/\r?\n/).filter(line => line.trim().startsWith(MARKER));
  if (!lines.length) return null;
  try {
    if (lines.length !== 1) throw new Error();
    const parsed = JSON.parse(lines[0].trim().slice(MARKER.length));
    if (!parsed || (parsed.dataLimitMb !== null && typeof parsed.dataLimitMb !== "number")) throw new Error();
    dataLimitMbToBytes(parsed.dataLimitMb);
    if (parsed.durationMinutes !== undefined && (!Number.isInteger(parsed.durationMinutes) || parsed.durationMinutes <= 0)) throw new Error();
    if (parsed.validityMinutes !== undefined && parsed.validityMinutes !== null && (!Number.isInteger(parsed.validityMinutes) || parsed.validityMinutes <= 0)) throw new Error();
    return {
      dataLimitMb: parsed.dataLimitMb,
      ...(parsed.durationMinutes === undefined ? {} : { durationMinutes: parsed.durationMinutes }),
      ...(parsed.validityMinutes === undefined ? {} : { validityMinutes: parsed.validityMinutes })
    };
  } catch {
    throw new Error("Le quota du profil RouterOS est illisible. Vérifiez et enregistrez le plan avant de générer des tickets.");
  }
}
