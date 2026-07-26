import type { InitiatedPaymentOrder, IpayPaymentType } from "../payments";
import { protectLicenseToken, unprotectLicenseToken } from "../licensing";

export type ResellerOverview = {
  id: string;
  email: string;
  name: string;
  status: "active" | "expired" | "revoked";
  router_capacity: number;
  router_consumed: number;
  router_available: number;
  max_child_devices: number;
  max_child_duration_days: number;
  must_change_password: boolean;
  issued_at: string;
  expires_at: string | null;
};

export type ResellerLicense = {
  id: string;
  status: "issued" | "active" | "expired" | "revoked";
  plan_name: string;
  duration_days: number;
  router_limit: number;
  max_devices: number;
  label: string | null;
  issued_at: string;
  activation_deadline_at: string | null;
  activated_at: string | null;
  expires_at: string | null;
};

export type ResellerLoginResult = {
  session_token: string;
  expires_at: string;
  reseller: ResellerOverview;
};

const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");
const sessionStorageKey = "ticketpro:reseller_session";
export const appModeStorageKey = "ticketpro:app_mode";

export async function loginReseller(email: string, password: string): Promise<ResellerLoginResult> {
  const result = await post<ResellerLoginResult>("/v1/reseller/auth/login", { email, password });
  await saveResellerSession(result.session_token);
  localStorage.setItem(appModeStorageKey, "reseller");
  return result;
}

export async function changeResellerPassword(
  sessionToken: string,
  currentPassword: string,
  newPassword: string
): Promise<ResellerLoginResult> {
  const result = await post<ResellerLoginResult>(
    "/v1/reseller/auth/change-password",
    { current_password: currentPassword, new_password: newPassword },
    sessionToken
  );
  await saveResellerSession(result.session_token);
  return result;
}

export async function resetResellerPassword(input: {
  email: string;
  resetToken: string;
  newPassword: string;
}): Promise<void> {
  await post("/v1/reseller/auth/reset-password", {
    email: input.email,
    reset_token: input.resetToken,
    new_password: input.newPassword
  });
}

export async function getResellerOverview(sessionToken: string): Promise<ResellerOverview> {
  const result = await get<{ reseller: ResellerOverview }>("/v1/reseller/overview", sessionToken);
  return result.reseller;
}

export async function listResellerLicenses(sessionToken: string): Promise<ResellerLicense[]> {
  const result = await post<{ licenses: ResellerLicense[] }>(
    "/v1/reseller/licenses/list",
    {},
    sessionToken
  );
  return result.licenses;
}

export async function createResellerLicense(
  sessionToken: string,
  input: { label: string; routerLimit: number; maxDevices: number; durationDays: number }
): Promise<{ key: string; reseller: ResellerOverview }> {
  return post(
    "/v1/reseller/licenses",
    {
      label: input.label,
      router_limit: input.routerLimit,
      max_devices: input.maxDevices,
      duration_days: input.durationDays
    },
    sessionToken
  );
}

export async function initiateResellerPackPayment(
  sessionToken: string,
  input: { planId: string; msisdn: string; paymentType: IpayPaymentType }
): Promise<InitiatedPaymentOrder> {
  return post(
    "/v1/reseller/payments/orders",
    {
      plan_id: input.planId,
      msisdn: input.msisdn,
      payment_type: input.paymentType
    },
    sessionToken
  );
}

export async function registerResellerAndInitiatePayment(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  planId: string;
  msisdn: string;
  paymentType: IpayPaymentType;
}): Promise<InitiatedPaymentOrder> {
  return post("/v1/reseller/register-and-pay", {
    name: input.name,
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    plan_id: input.planId,
    msisdn: input.msisdn,
    payment_type: input.paymentType
  });
}

export async function readResellerSession(): Promise<string | null> {
  const encrypted = localStorage.getItem(sessionStorageKey);
  if (!encrypted) return null;
  try {
    return await unprotectLicenseToken(encrypted);
  } catch {
    clearResellerSession();
    return null;
  }
}

export async function logoutReseller(sessionToken?: string): Promise<void> {
  if (sessionToken) {
    await post("/v1/reseller/auth/logout", {}, sessionToken).catch(() => undefined);
  }
  clearResellerSession();
}

export function clearResellerSession(): void {
  localStorage.removeItem(sessionStorageKey);
  localStorage.removeItem(appModeStorageKey);
}

async function saveResellerSession(token: string): Promise<void> {
  localStorage.setItem(sessionStorageKey, await protectLicenseToken(token));
}

async function post<T>(
  pathname: string,
  body: Record<string, unknown>,
  bearerToken?: string
): Promise<T> {
  return request(pathname, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function get<T>(pathname: string, bearerToken: string): Promise<T> {
  return request(pathname, {
    method: "GET",
    headers: { authorization: `Bearer ${bearerToken}` }
  });
}

async function request<T>(pathname: string, init: RequestInit): Promise<T> {
  if (!apiUrl) throw new Error("L'API TicketPro n'est pas configurée (VITE_LICENSE_API_URL).");
  const response = await fetch(`${apiUrl}${pathname}`, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Erreur revendeur (${response.status}).`);
  return payload;
}
