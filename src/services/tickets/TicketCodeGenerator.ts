export type TicketCodeAlphabet = "numeric" | "readable";

export type ExistingTicketLike = string | { username: string };

export type TicketCodeGeneratorInput = {
  alphabet?: TicketCodeAlphabet;
  codeLength: number;
  excludeAmbiguous?: boolean;
  existingTickets?: ExistingTicketLike[];
  prefix?: string;
  quantity: number;
  routerId: string;
  usernameEqualsPassword?: boolean;
};

export type GeneratedTicketCode = {
  passwordSecretRef: string;
  username: string;
};

export type TicketCodeGeneratorResult = {
  codes: GeneratedTicketCode[];
  collisionCount: number;
  prefix: string;
};

export type TicketCodeGeneratorOptions = {
  randomInt?: (maxExclusive: number) => number;
};

const AMBIGUOUS_CHARACTERS = new Set(["0", "O", "I", "1", "L"]);
const NUMERIC_ALPHABET = "0123456789";
const READABLE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class TicketCodeGenerator {
  private readonly randomInt: (maxExclusive: number) => number;

  constructor(options: TicketCodeGeneratorOptions = {}) {
    this.randomInt = options.randomInt ?? secureRandomInt;
  }

  generate(input: TicketCodeGeneratorInput): TicketCodeGeneratorResult {
    const alphabet = buildAlphabet(input.alphabet ?? "numeric", Boolean(input.excludeAmbiguous));
    const prefix = normalizeTicketPrefix(input.prefix ?? "");
    const quantity = input.quantity;
    const usernameEqualsPassword = input.usernameEqualsPassword ?? true;
    const existing = new Set((input.existingTickets ?? []).map(getExistingUsername).map(normalizeCodeKey));
    const generated = new Set<string>();
    const codes: GeneratedTicketCode[] = [];
    let collisionCount = 0;
    let attemptCount = 0;
    const maxAttempts = Math.max(quantity * 100, 1000);

    validateInput({ ...input, quantity }, alphabet, existing, prefix);

    while (codes.length < quantity) {
      if (attemptCount > maxAttempts) {
        throw new TicketCodeGeneratorError("Impossible de générer assez de codes uniques.");
      }

      const candidate = `${prefix}${createRandomCode(input.codeLength, alphabet, this.randomInt)}`;
      const codePart = candidate.slice(prefix.length);
      const candidateKey = normalizeCodeKey(candidate);

      attemptCount += 1;

      if (isWeakCode(codePart, alphabet)) {
        continue;
      }

      if (existing.has(candidateKey) || generated.has(candidateKey)) {
        collisionCount += 1;
        continue;
      }

      generated.add(candidateKey);
      codes.push({
        passwordSecretRef: usernameEqualsPassword
          ? secretRefForTicket(input.routerId, candidate)
          : secretRefForTicket(input.routerId, `${candidate}-password`),
        username: candidate
      });
    }

    return { codes, collisionCount, prefix };
  }
}

export function normalizeTicketPrefix(prefix: string): string {
  return prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function secretRefForTicket(routerId: string, username: string): string {
  return `secret://${routerId}/${username}/password`;
}

function validateInput(
  input: TicketCodeGeneratorInput,
  alphabet: string,
  existingCodes: Set<string>,
  prefix: string
): void {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new TicketCodeGeneratorError("La quantité doit être supérieure à zéro.");
  }

  if (!Number.isInteger(input.codeLength) || input.codeLength < 3 || input.codeLength > 12) {
    throw new TicketCodeGeneratorError("La longueur du code doit être comprise entre 3 et 12.");
  }

  const existingCount = Array.from(existingCodes).filter(
    (code) =>
      code.startsWith(prefix) &&
      code.length === prefix.length + input.codeLength &&
      isCodePartInAlphabet(code.slice(prefix.length), alphabet)
  ).length;
  const capacity = alphabet.length ** input.codeLength;

  if (input.quantity + existingCount > capacity) {
    throw new TicketCodeGeneratorError("Pas assez de codes disponibles avec cette longueur.");
  }
}

function buildAlphabet(mode: TicketCodeAlphabet, excludeAmbiguous: boolean): string {
  const alphabet = mode === "numeric" ? NUMERIC_ALPHABET : READABLE_ALPHABET;
  const readableAlphabet = excludeAmbiguous
    ? Array.from(alphabet)
        .filter((character) => !AMBIGUOUS_CHARACTERS.has(character))
        .join("")
    : alphabet;

  if (!readableAlphabet) {
    throw new TicketCodeGeneratorError("Aucun caractère disponible pour générer les codes.");
  }

  return readableAlphabet;
}

function createRandomCode(length: number, alphabet: string, randomInt: (maxExclusive: number) => number): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

function getExistingUsername(ticket: ExistingTicketLike): string {
  return typeof ticket === "string" ? ticket : ticket.username;
}

function normalizeCodeKey(value: string): string {
  return value.trim().toUpperCase();
}

function isCodePartInAlphabet(value: string, alphabet: string): boolean {
  return Array.from(value).every((character) => alphabet.includes(character));
}

function isWeakCode(value: string, alphabet: string): boolean {
  const characters = Array.from(value);

  if (new Set(characters).size === 1) {
    return true;
  }

  if (hasLongRepeatedRun(characters)) {
    return true;
  }

  if (isSequential(characters, alphabet, 1) || isSequential(characters, alphabet, -1)) {
    return true;
  }

  if (characters.length % 2 === 0) {
    const half = characters.length / 2;
    const firstHalf = characters.slice(0, half).join("");
    const secondHalf = characters.slice(half).join("");

    if (firstHalf === secondHalf) {
      return true;
    }
  }

  if (characters.length % 3 === 0) {
    const third = characters.length / 3;
    const chunk = characters.slice(0, third).join("");

    if (chunk.repeat(3) === value) {
      return true;
    }
  }

  return false;
}

function hasLongRepeatedRun(characters: string[]): boolean {
  let currentRun = 1;

  for (let index = 1; index < characters.length; index += 1) {
    currentRun = characters[index] === characters[index - 1] ? currentRun + 1 : 1;

    if (currentRun >= 3) {
      return true;
    }
  }

  return false;
}

function isSequential(characters: string[], alphabet: string, step: 1 | -1): boolean {
  if (characters.length < 3) {
    return false;
  }

  return characters.every((character, index) => {
    if (index === 0) {
      return true;
    }

    const previousIndex = alphabet.indexOf(characters[index - 1]);
    const currentIndex = alphabet.indexOf(character);
    return currentIndex - previousIndex === step;
  });
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) {
    throw new TicketCodeGeneratorError("Alphabet invalide.");
  }

  const cryptoApi = globalThis.crypto;

  if (!cryptoApi?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);

  do {
    cryptoApi.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return buffer[0] % maxExclusive;
}

export class TicketCodeGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketCodeGeneratorError";
  }
}
