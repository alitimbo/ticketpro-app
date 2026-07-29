export type StoredTechnicalMessage = {
  action: string | null;
  code: string | null;
  detail: string | null;
};

type StructuredTechnicalMessage = {
  action: string;
  code?: string | null;
  detail?: string | null;
  version: 1;
};

export function serializeTechnicalMessage(input: {
  action: string;
  code?: string | null;
  detail?: string | null;
}): string {
  const payload: StructuredTechnicalMessage = {
    action: input.action,
    code: input.code ?? null,
    detail: input.detail ? redactTechnicalMessage(input.detail) : null,
    version: 1
  };

  return JSON.stringify(payload);
}

export function parseTechnicalMessage(value: string | null): StoredTechnicalMessage {
  if (!value) {
    return { action: null, code: null, detail: null };
  }

  try {
    const parsed = JSON.parse(value) as Partial<StructuredTechnicalMessage>;
    if (parsed.version === 1 && typeof parsed.action === "string") {
      return {
        action: sanitizeLabel(parsed.action),
        code: typeof parsed.code === "string" ? sanitizeLabel(parsed.code) : null,
        detail: typeof parsed.detail === "string" ? redactTechnicalMessage(parsed.detail) : null
      };
    }
  } catch {
    // Legacy logs were stored as either an action or "code: detail".
  }

  const legacyError = value.match(/^([a-z][a-z0-9_.-]*):\s+(.+)$/i);
  if (legacyError) {
    const code = legacyError[1].trim();
    const detail = legacyError[2].trim();
    return {
      action: null,
      code: code || null,
      detail: detail ? redactTechnicalMessage(detail) : null
    };
  }

  const trimmed = value.trim();
  return /^[a-z][a-z0-9_.-]*$/i.test(trimmed)
    ? { action: trimmed, code: null, detail: null }
    : {
        action: null,
        code: null,
        detail: trimmed ? redactTechnicalMessage(trimmed) : null
      };
}

export function redactTechnicalMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [MASQUÉ]")
    .replace(
      /\b(password|passwd|secret|token|authorization|private[-_ ]?key)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[MASQUÉ]"
    )
    .replace(/:\/\/([^:/\s]+):([^@\s]+)@/g, "://$1:[MASQUÉ]@")
    .slice(0, 1000);
}

function sanitizeLabel(value: string): string | null {
  const sanitized = redactTechnicalMessage(value).trim().slice(0, 120);
  return sanitized || null;
}
