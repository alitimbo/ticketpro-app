import { invoke } from "@tauri-apps/api/core";

const legacySecretPrefix = "encrypted:";
const protectedSecretPrefix = "dpapi:";
const localKeyStorageKey = "hotspot:local_secret_key";

export async function encryptLocalSecret(secret: string): Promise<string> {
  if (isTauriRuntime()) {
    const protectedValue = await invoke<string>("license_protect_value", { value: secret });
    return `${protectedSecretPrefix}${protectedValue}`;
  }

  return encryptLegacySecret(secret);
}

export async function decryptLocalSecret(value: string): Promise<string> {
  if (value.startsWith(protectedSecretPrefix)) {
    if (!isTauriRuntime()) {
      throw new Error("Ce secret protégé par Windows doit être lu depuis l'application TicketPro.");
    }
    return invoke<string>("license_unprotect_value", {
      value: value.slice(protectedSecretPrefix.length)
    });
  }

  if (value.startsWith(legacySecretPrefix) && value.includes(".")) {
    return decryptLegacySecret(value);
  }

  throw new Error("Secret local illisible.");
}

export function isEncryptedLocalSecret(value: string): boolean {
  return value.startsWith(protectedSecretPrefix) ||
    (value.startsWith(legacySecretPrefix) && value.includes("."));
}

async function encryptLegacySecret(secret: string): Promise<string> {
  const key = await getOrCreateLocalKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { iv: toArrayBuffer(iv), name: "AES-GCM" },
    key,
    toArrayBuffer(new TextEncoder().encode(secret))
  );

  return `${legacySecretPrefix}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptLegacySecret(value: string): Promise<string> {
  const payload = value.slice(legacySecretPrefix.length);
  const separatorIndex = payload.indexOf(".");
  if (separatorIndex <= 0) {
    throw new Error("Secret local illisible.");
  }
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

async function getOrCreateLocalKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(localKeyStorageKey);

  if (stored) {
    return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(stored)), "AES-GCM", false, ["decrypt", "encrypt"]);
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(localKeyStorageKey, bytesToBase64(rawKey));

  return crypto.subtle.importKey("raw", toArrayBuffer(rawKey), "AES-GCM", false, ["decrypt", "encrypt"]);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
