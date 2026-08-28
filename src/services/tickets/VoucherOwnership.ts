const BATCH_COMMENT_PREFIX = "TicketProBatch:";
const BATCH_FIELD = "batch=";

export function buildVoucherBatchOwnershipComment(batchId: string): string {
  return `${BATCH_COMMENT_PREFIX}${voucherBatchToken(batchId)}`;
}

export function extractVoucherBatchOwnershipSuffix(comment: string | null | undefined): string {
  const token = extractVoucherBatchToken(comment);
  return token ? `${BATCH_FIELD}${token};` : "";
}

export function voucherBelongsToBatch(
  comment: string | null | undefined,
  batchId: string
): boolean {
  return extractVoucherBatchToken(comment) === voucherBatchToken(batchId);
}

export function voucherBatchToken(batchId: string): string {
  return batchId.trim().replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64);
}

function extractVoucherBatchToken(comment: string | null | undefined): string | null {
  const value = comment?.trim() ?? "";
  const legacyIndex = value.indexOf(BATCH_COMMENT_PREFIX);
  if (legacyIndex >= 0) {
    const token = value.slice(legacyIndex + BATCH_COMMENT_PREFIX.length).match(/^[A-Za-z0-9_-]{1,64}/)?.[0];
    if (token) return token;
  }
  const fieldIndex = value.indexOf(BATCH_FIELD);
  if (fieldIndex < 0) return null;
  return value.slice(fieldIndex + BATCH_FIELD.length).match(/^[A-Za-z0-9_-]{1,64}(?=;)/)?.[0] ?? null;
}
