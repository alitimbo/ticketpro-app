import { dataLimitMbToBytes } from "../tickets/VoucherQuota";

const MARKER = "# TICKETPRO-PLAN-QUOTA v1 ";
/** First token of the on-login line that enforces the plan quota on RouterOS. */
const ENFORCE_PREFIX = ":do { :local tpPlanQuotaId ";

/**
 * RouterOS line run at each login of the profile: a voucher that does not
 * carry the plan quota (created before the quota, or outside TicketPro)
 * receives it, so RouterOS limits it even while TicketPro is closed. RouterOS
 * fixes a session's limit when it opens, so that session is closed once and
 * the voucher reconnects under the quota (refused if already consumed).
 * A voucher that already has its own limit is never changed.
 */
export function buildPlanQuotaEnforcementLine(limitBytesTotal: number): string {
  if (!Number.isSafeInteger(limitBytesTotal) || limitBytesTotal <= 0) {
    throw new Error("Le quota du plan est invalide.");
  }
  return [
    `${ENFORCE_PREFIX}[/ip hotspot user find where name=$user];`,
    ":if ([:len $tpPlanQuotaId] > 0) do={",
    ":local tpPlanQuotaNow [:tonum [/ip hotspot user get $tpPlanQuotaId limit-bytes-total]];",
    ":if (([:typeof $tpPlanQuotaNow] != \"num\") || ($tpPlanQuotaNow = 0)) do={",
    `/ip hotspot user set $tpPlanQuotaId limit-bytes-total=${limitBytesTotal};`,
    ":log info (\"TicketPro: quota du plan applique a \" . $user);",
    "/ip hotspot active remove [find where user=$user]",
    "} } } on-error={ :log warning (\"TicketPro: quota du plan impossible pour \" . $user) }"
  ].join(" ");
}

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
  const preserved = source
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith(MARKER) && !line.trim().startsWith(ENFORCE_PREFIX))
    .join("\r\n")
    .trim();
  const limitBytesTotal = dataLimitMbToBytes(metadata.dataLimitMb);
  const enforcement = limitBytesTotal === null ? "" : `${buildPlanQuotaEnforcementLine(limitBytesTotal)}\r\n`;
  return `${MARKER}${JSON.stringify(metadata)}\r\n${enforcement}${preserved}`;
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
