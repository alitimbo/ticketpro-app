export type InternationalPhoneResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

const INTERNATIONAL_PHONE_MESSAGE =
  "Saisissez le numéro avec l'indicatif du pays, par exemple +227 88 99 99 00.";

/**
 * Normalise un numéro de contact vers le format E.164.
 *
 * Les séparateurs visuels sont acceptés. Pour simplifier la saisie au Niger,
 * un numéro local de huit chiffres est automatiquement préfixé par +227.
 */
export function normalizeInternationalPhone(
  input: string | null | undefined,
  options: { required?: boolean } = {}
): InternationalPhoneResult {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return options.required
      ? { ok: false, message: "Saisissez un numéro de téléphone." }
      : { ok: true, value: "" };
  }

  if (raw.length > 64 || /[^\d+().\-\s]/.test(raw)) {
    return { ok: false, message: INTERNATIONAL_PHONE_MESSAGE };
  }

  const compact = raw.replace(/[().\-\s]/g, "");
  const plusCount = (compact.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !compact.startsWith("+"))) {
    return { ok: false, message: INTERNATIONAL_PHONE_MESSAGE };
  }

  let normalized: string;
  if (compact.startsWith("+")) {
    normalized = compact;
  } else if (compact.startsWith("00")) {
    normalized = `+${compact.slice(2)}`;
  } else if (/^\d{8}$/.test(compact)) {
    normalized = `+227${compact}`;
  } else if (/^227\d{8}$/.test(compact)) {
    normalized = `+${compact}`;
  } else {
    return { ok: false, message: INTERNATIONAL_PHONE_MESSAGE };
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return { ok: false, message: INTERNATIONAL_PHONE_MESSAGE };
  }

  return { ok: true, value: normalized };
}

export function formatInternationalPhone(value: string): string {
  const normalized = normalizeInternationalPhone(value);
  if (!normalized.ok || !normalized.value) return value.trim();
  const niger = normalized.value.match(/^\+227(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return niger
    ? `+227 ${niger[1]} ${niger[2]} ${niger[3]} ${niger[4]}`
    : normalized.value;
}
