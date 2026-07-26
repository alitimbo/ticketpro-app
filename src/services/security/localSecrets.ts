const secretPrefix = "encrypted:";
const localKeyStorageKey = "hotspot:local_secret_key";

export async function encryptLocalSecret(secret: string): Promise<string> {
  const key = await getOrCreateLocalKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { iv: toArrayBuffer(iv), name: "AES-GCM" },
    key,
    toArrayBuffer(new TextEncoder().encode(secret))
  );

  return `${secretPrefix}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptLocalSecret(value: string): Promise<string> {
  if (!isEncryptedLocalSecret(value)) {
    throw new Error("Secret local illisible.");
  }

  const payload = value.slice(secretPrefix.length);
  const separatorIndex = payload.indexOf(".");
  const iv = base64ToBytes(payload.slice(0, separatorIndex));
  const encrypted = base64ToBytes(payload.slice(separatorIndex + 1));
  const key = await getOrCreateLocalKey();
  const decrypted = await crypto.subtle.decrypt(
    { iv: toArrayBuffer(iv), name: "AES-GCM" },
    key,
    toArrayBuffer(encrypted)
  );

  return new TextDecoder().decode(decrypted);
}

export function isEncryptedLocalSecret(value: string): boolean {
  return value.startsWith(secretPrefix) && value.includes(".");
}

async function getOrCreateLocalKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(localKeyStorageKey);

  if (stored) {
    return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(stored)), "AES-GCM", false, ["decrypt", "encrypt"]);
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(localKeyStorageKey, bytesToBase64(rawKey));

  return crypto.subtle.importKey("raw", toArrayBuffer(rawKey), "AES-GCM", false, ["decrypt", "encrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
