import { dataLimitMbToBytes } from "../tickets/VoucherQuota";

const MARKER = "# TICKETPRO-PLAN-QUOTA v1 ";

/** A script comment is supported on RouterOS user profiles; a `comment` field is not. */
export function writePlanQuotaMetadata(source: string, dataLimitMb: number | null): string {
  dataLimitMbToBytes(dataLimitMb);
  const preserved = source.split(/\r?\n/).filter(line => !line.trim().startsWith(MARKER)).join("\r\n").trim();
  return `${MARKER}${JSON.stringify({ dataLimitMb })}\r\n${preserved}`;
}

export function readPlanQuotaMetadata(source: string | undefined): { dataLimitMb: number | null } | null {
  const lines = (source ?? "").split(/\r?\n/).filter(line => line.trim().startsWith(MARKER));
  if (!lines.length) return null;
  try {
    if (lines.length !== 1) throw new Error();
    const parsed = JSON.parse(lines[0].trim().slice(MARKER.length));
    if (!parsed || (parsed.dataLimitMb !== null && typeof parsed.dataLimitMb !== "number")) throw new Error();
    dataLimitMbToBytes(parsed.dataLimitMb);
    return { dataLimitMb: parsed.dataLimitMb };
  } catch {
    throw new Error("Le quota du profil RouterOS est illisible. Vérifiez et enregistrez le plan avant de générer des tickets.");
  }
}
