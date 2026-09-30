import type { HotspotUser } from "../../domain/router";

/** TicketPro uses binary units: 1 Go = 1024 Mo, 1 Mo = 1048576 bytes. */
export function dataLimitMbToBytes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const bytes = Math.round(value * 1024 * 1024);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("Le volume doit être positif et représentable en octets. Laissez le champ vide pour un volume illimité.");
  }
  return bytes;
}

export function voucherQuotaMatches(user: Pick<HotspotUser, "limitBytesTotal">, expectedBytes: number | null | undefined): boolean {
  if (expectedBytes === undefined) return true;
  return (user.limitBytesTotal ?? 0) === (expectedBytes ?? 0);
}
