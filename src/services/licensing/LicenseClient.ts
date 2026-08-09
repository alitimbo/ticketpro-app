import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../config/runtime";
import { decryptLocalSecret, encryptLocalSecret } from "../security/localSecrets";

export type LicensePlan = {
  billing_period: "custom" | "monthly" | "yearly";
  code: string;
  description: string;
  duration_days: number;
  id: string;
  is_active: boolean;
  is_recommended: boolean;
  is_reseller?: boolean;
  max_devices: number;
  name: string;
  price_cfa: number | null;
  router_limit: number;
};

export type LicenseApiState = {
  activation_id: string;
  days_remaining: number | null;
  device_count: number;
  duration_days: number;
  expires_at: string | null;
  license_id: string;
  max_devices: number;
  plan: LicensePlan;
  router_count: number;
  router_limit: number;
  status: "issued" | "active" | "expired" | "revoked";
  valid: boolean;
};

export type LicenseActivationResult = LicenseApiState & { activation_token: string };

export type LicenseVpnBootstrap = {
  address_pool: string;
  server_endpoint: string;
  server_port: number;
  server_public_key: string;
};

export type LicenseVpnPeerResult = {
  address_pool: string | null;
  assigned_address: string | null;
  public_key: string;
  replaced_public_keys?: string[];
  resource_id?: string;
  status: "active" | "revoked";
};

type DeviceIdentity = { device_id: string; install_id: string };

const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");
const fallbackIdentityKey = "ticketpro:license:device-identity";

export function isLicenseApiConfigured(): boolean {
  return Boolean(apiUrl);
}

export async function listLicensePlans(): Promise<LicensePlan[]> {
  const result = await getRequest<{ plans: LicensePlan[] }>("/v1/plans");
  return result.plans;
}

export async function getLicenseDeviceIdentity(): Promise<DeviceIdentity> {
  if (isTauriRuntime()) return invoke<DeviceIdentity>("license_get_device_identity");
  const stored = localStorage.getItem(fallbackIdentityKey);
  if (stored) return JSON.parse(stored) as DeviceIdentity;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const identity = { device_id: value, install_id: value.slice(0, 32) };
  localStorage.setItem(fallbackIdentityKey, JSON.stringify(identity));
  return identity;
}

export async function signLicenseDevicePayload(payload: string): Promise<string> {
  if (isTauriRuntime()) return invoke<string>("license_sign_device_payload", { payload });
  const identity = await getLicenseDeviceIdentity();
  const data = new TextEncoder().encode(`${identity.device_id}:${payload}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function protectLicenseToken(token: string): Promise<string> {
  if (isTauriRuntime()) return invoke<string>("license_protect_value", { value: token });
  return encryptLocalSecret(token);
}

export async function unprotectLicenseToken(value: string): Promise<string> {
  if (isTauriRuntime()) return invoke<string>("license_unprotect_value", { value });
  return decryptLocalSecret(value);
}

export async function activateLicense(input: { accountId: string; key: string; routerIds?: string[] }): Promise<LicenseActivationResult> {
  const identity = await getLicenseDeviceIdentity();
  const deviceProof = await signLicenseDevicePayload("ticketpro-license-device-v1");
  return request<LicenseActivationResult>("/v1/licenses/activate", {
    key: input.key.trim(),
    account_id: input.accountId,
    device_id: identity.device_id,
    device_proof: deviceProof,
    install_id: identity.install_id,
    router_ids: input.routerIds ?? []
  });
}

export async function validateLicense(input: {
  accountId: string;
  licenseId: string;
  activationToken: string;
  routerIds?: string[];
}): Promise<LicenseApiState> {
  const identity = await getLicenseDeviceIdentity();
  const deviceProof = await signLicenseDevicePayload("ticketpro-license-device-v1");
  return request<LicenseApiState>("/v1/licenses/validate", {
    license_id: input.licenseId,
    activation_token: input.activationToken,
    account_id: input.accountId,
    device_id: identity.device_id,
    device_proof: deviceProof,
    install_id: identity.install_id,
    router_ids: input.routerIds ?? []
  });
}

export async function bootstrapLicenseVpn(input: {
  accountId: string;
  activationToken: string;
  licenseId: string;
}): Promise<LicenseVpnBootstrap> {
  return request<LicenseVpnBootstrap>("/v1/vpn/bootstrap", {
    ...(await licensedDevicePayload(input)),
  });
}

export async function upsertLicenseVpnPeer(input: {
  accountId: string;
  activationToken: string;
  licenseId: string;
  name: string;
  peerType: "operator" | "router";
  publicKey: string;
}): Promise<LicenseVpnPeerResult> {
  return request<LicenseVpnPeerResult>("/v1/vpn/peers", {
    ...(await licensedDevicePayload(input)),
    action: "upsert",
    name: input.name,
    peer_type: input.peerType,
    public_key: input.publicKey
  });
}

export async function revokeLicenseVpnPeer(input: {
  accountId: string;
  activationToken: string;
  licenseId: string;
  peerType: "operator" | "router";
  publicKey: string;
}): Promise<LicenseVpnPeerResult> {
  return request<LicenseVpnPeerResult>("/v1/vpn/peers", {
    ...(await licensedDevicePayload(input)),
    action: "revoke",
    peer_type: input.peerType,
    public_key: input.publicKey
  });
}

async function licensedDevicePayload(input: {
  accountId: string;
  activationToken: string;
  licenseId: string;
}): Promise<Record<string, string>> {
  const identity = await getLicenseDeviceIdentity();
  return {
    account_id: input.accountId,
    activation_token: input.activationToken,
    device_id: identity.device_id,
    device_proof: await signLicenseDevicePayload("ticketpro-license-device-v1"),
    install_id: identity.install_id,
    license_id: input.licenseId
  };
}

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!apiUrl) throw new Error("L'API de licences n'est pas configurée (VITE_LICENSE_API_URL).");
  const response = await fetch(`${apiUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Erreur de licence (${response.status}).`);
  return payload;
}

async function getRequest<T>(path: string): Promise<T> {
  if (!apiUrl) throw new Error("L'API de licences n'est pas configurée (VITE_LICENSE_API_URL).");
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { accept: "application/json" },
    method: "GET"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Erreur de catalogue (${response.status}).`);
  return payload;
}
