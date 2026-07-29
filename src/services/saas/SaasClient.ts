import {
  protectLicenseToken,
  getLicenseDeviceIdentity,
  signLicenseDevicePayload,
  unprotectLicenseToken,
  type LicenseVpnBootstrap,
  type LicenseVpnPeerResult
} from "../licensing";
import type { InitiatedPaymentOrder, IpayPaymentType } from "../payments";
import type { Permission, UserRole } from "../../domain/auth";
import type { RouterAccessPolicy } from "../access/RouterAccessPolicyService";

const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");
const sessionStorageKey = "ticketpro:saas_session";

export type SaasSubscription = {
  id?: string;
  status: "active" | "expired" | "cancelled" | "none";
  is_active: boolean;
  router_limit: number;
  current_period_start: string | null;
  current_period_end: string | null;
  plan: {
    id: string;
    code: string;
    name: string;
    price_cfa: number;
  } | null;
};

export type SaasOrganizationUser = {
  id: string;
  membership_id: string;
  organization_id: string;
  email: string;
  name: string;
  phone: string | null;
  role: "owner" | "admin" | "member";
  app_role: UserRole;
  permissions: Permission[];
  router_access: {
    mode: "all" | "selected";
    router_ids: string[];
  };
  invitation_pending: boolean;
  status: "active" | "disabled";
  created_at: string;
  last_login_at: string | null;
};

export type SaasAuthResult = {
  session?: {
    token: string;
    expires_at: string;
    active_membership_id?: string;
  };
  user: SaasOrganizationUser;
  organization: {
    id: string;
    name: string;
    status: "pending_payment" | "active" | "suspended";
  };
  organizations: Array<{
    membership_id: string;
    organization_id: string;
    organization_name: string;
    app_role: UserRole;
    authority_role: "owner" | "member";
    is_current: boolean;
  }>;
  requires_organization_selection: boolean;
  subscription: SaasSubscription;
  access: {
    can_manage_billing: boolean;
    can_manage_team: boolean;
    can_manage_routers: boolean;
  };
};

export type SaasRouterAccessPolicy = {
  organization_id: string;
  policy: RouterAccessPolicy;
  revision: number;
  router_id: string;
  updated_at: string;
};

export class SaasRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SaasRequestError";
  }
}

export async function registerSaasAndInitiatePayment(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
  planId: string;
  msisdn: string;
  paymentType: IpayPaymentType;
}): Promise<InitiatedPaymentOrder> {
  return request("/v1/saas/register-and-pay", {
    organization_name: input.organizationName,
    name: input.name,
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    phone: input.phone,
    plan_id: input.planId,
    msisdn: input.msisdn,
    payment_type: input.paymentType
  });
}

export async function registerSaasTrial(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
}): Promise<SaasAuthResult> {
  const result = await request<SaasAuthResult>("/v1/saas/register-trial", {
    organization_name: input.organizationName,
    name: input.name,
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    phone: input.phone
  });
  if (!result.session) throw new Error("La session d'essai TicketPro n'a pas été créée.");
  await storeSaasSession(result.session.token);
  return result;
}

export async function migrateLegacyLicenseToSaas(input: {
  accountId: string;
  activationToken: string;
  licenseId: string;
  organizationName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
}): Promise<SaasAuthResult> {
  const identity = await getLicenseDeviceIdentity();
  const result = await request<SaasAuthResult>("/v1/saas/migrate-license", {
    license_id: input.licenseId,
    activation_token: input.activationToken,
    account_id: input.accountId,
    device_id: identity.device_id,
    device_proof: await signLicenseDevicePayload("ticketpro-license-device-v1"),
    install_id: identity.install_id,
    organization_name: input.organizationName,
    name: input.name,
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    phone: input.phone
  });
  if (!result.session) throw new Error("La session TicketPro n'a pas été créée.");
  await storeSaasSession(result.session.token);
  return result;
}

export async function completeSaasRegistration(input: {
  orderId: string;
  orderToken: string;
}): Promise<SaasAuthResult> {
  const result = await request<SaasAuthResult>("/v1/saas/registration/complete", {
    order_id: input.orderId,
    order_token: input.orderToken
  });
  if (!result.session) throw new Error("La session TicketPro n'a pas été créée.");
  await storeSaasSession(result.session.token);
  return result;
}

export async function loginSaas(email: string, password: string): Promise<SaasAuthResult> {
  const result = await request<SaasAuthResult>("/v1/saas/auth/login", { email, password });
  if (!result.session) throw new Error("La session TicketPro n'a pas été créée.");
  await storeSaasSession(result.session.token);
  return result;
}

export async function requestSaasPasswordReset(email: string): Promise<{ accepted: boolean; message: string }> {
  return request("/v1/saas/auth/forgot-password", { email });
}

export async function resetSaasPassword(input: {
  resetToken: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: boolean; message: string }> {
  return request("/v1/saas/auth/reset-password", {
    reset_token: input.resetToken,
    new_password: input.newPassword,
    confirm_password: input.confirmPassword
  });
}

export async function inspectSaasInvitation(invitationToken: string): Promise<{
  valid: boolean;
  email: string;
  name: string;
  organization_name: string;
  requires_password: boolean;
  expires_at: string;
}> {
  return request("/v1/saas/invitations/inspect", { invitation_token: invitationToken });
}

export async function acceptSaasInvitation(input: {
  invitationToken: string;
  newPassword?: string;
  confirmPassword?: string;
}): Promise<{ ok: boolean; email: string; organization_name: string; message: string }> {
  return request("/v1/saas/invitations/accept", {
    invitation_token: input.invitationToken,
    new_password: input.newPassword,
    confirm_password: input.confirmPassword
  });
}

export async function switchSaasOrganization(membershipId: string): Promise<SaasAuthResult> {
  const token = await requireSessionToken();
  return request<SaasAuthResult>(
    "/v1/saas/auth/switch-organization",
    { membership_id: membershipId },
    token
  );
}

export async function listSaasTeam(): Promise<SaasOrganizationUser[]> {
  const token = await requireSessionToken();
  const result = await request<{ members: SaasOrganizationUser[] }>(
    "/v1/saas/team",
    undefined,
    token,
    "GET"
  );
  return result.members;
}

export async function createSaasTeamMember(input: {
  name: string;
  email: string;
  phone?: string;
  appRole: UserRole;
  routerAccessMode: "all" | "selected";
  routerIds: string[];
}): Promise<{ member: SaasOrganizationUser; message: string }> {
  const token = await requireSessionToken();
  return request("/v1/saas/team/members", {
    name: input.name,
    email: input.email,
    phone: input.phone,
    app_role: input.appRole,
    router_access_mode: input.routerAccessMode,
    router_ids: input.routerIds
  }, token);
}

export async function updateSaasTeamMember(input: {
  userId: string;
  name: string;
  appRole: UserRole;
  status: "active" | "disabled";
  routerAccessMode: "all" | "selected";
  routerIds: string[];
}): Promise<{ member: SaasOrganizationUser }> {
  const token = await requireSessionToken();
  return request("/v1/saas/team/members/update", {
    user_id: input.userId,
    name: input.name,
    app_role: input.appRole,
    status: input.status,
    router_access_mode: input.routerAccessMode,
    router_ids: input.routerIds
  }, token);
}

export async function resendSaasTeamInvitation(userId: string): Promise<{ ok: boolean; message: string }> {
  const token = await requireSessionToken();
  return request("/v1/saas/team/members/resend-invitation", { user_id: userId }, token);
}

export async function removeSaasTeamMember(userId: string): Promise<{ ok: boolean }> {
  const token = await requireSessionToken();
  return request("/v1/saas/team/members/remove", { user_id: userId }, token);
}

export async function getSaasAccount(): Promise<SaasAuthResult> {
  const token = await readSaasSession();
  if (!token) throw new Error("Session TicketPro absente.");
  return request<SaasAuthResult>("/v1/saas/auth/me", undefined, token, "GET");
}

export async function purchaseSaasSubscription(input: {
  planId: string;
  msisdn: string;
  paymentType: IpayPaymentType;
}): Promise<InitiatedPaymentOrder> {
  const token = await readSaasSession();
  if (!token) throw new Error("Reconnectez-vous pour gérer l'abonnement.");
  return request(
    "/v1/saas/subscriptions/purchase",
    {
      plan_id: input.planId,
      msisdn: input.msisdn,
      payment_type: input.paymentType
    },
    token
  );
}

export async function bootstrapSaasVpn(): Promise<LicenseVpnBootstrap> {
  const token = await requireSessionToken();
  return request("/v1/saas/vpn/bootstrap", {}, token);
}

export async function upsertSaasVpnPeer(input: {
  name: string;
  peerType: "operator" | "router";
  publicKey: string;
}): Promise<LicenseVpnPeerResult> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/vpn/peers",
    {
      action: "upsert",
      name: input.name,
      peer_type: input.peerType,
      public_key: input.publicKey
    },
    token
  );
}

export async function revokeSaasVpnPeer(input: {
  peerType: "operator" | "router";
  publicKey: string;
}): Promise<LicenseVpnPeerResult> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/vpn/peers",
    {
      action: "revoke",
      peer_type: input.peerType,
      public_key: input.publicKey
    },
    token
  );
}

export async function getSaasRouterAccessPolicy(
  routerId: string
): Promise<SaasRouterAccessPolicy | null> {
  const token = await requireSessionToken();
  const result = await request<{ policy: SaasRouterAccessPolicy | null }>(
    `/v1/saas/router-access-policy?router_id=${encodeURIComponent(routerId)}`,
    undefined,
    token,
    "GET"
  );
  return result.policy;
}

export async function syncSaasRouterAccessPolicy(input: {
  baseRevision: number;
  policy: RouterAccessPolicy;
  routerId: string;
}): Promise<SaasRouterAccessPolicy> {
  const token = await requireSessionToken();
  const result = await request<{ policy: SaasRouterAccessPolicy }>(
    "/v1/saas/router-access-policy",
    {
      base_revision: input.baseRevision,
      policy: input.policy,
      router_id: input.routerId
    },
    token
  );
  return result.policy;
}

export async function logoutSaas(): Promise<void> {
  const token = await readSaasSession();
  try {
    if (token) await request("/v1/saas/auth/logout", {}, token);
  } finally {
    localStorage.removeItem(sessionStorageKey);
  }
}

export async function storeSaasSession(token: string): Promise<void> {
  localStorage.setItem(sessionStorageKey, await protectLicenseToken(token));
}

export async function readSaasSession(): Promise<string | null> {
  const protectedToken = localStorage.getItem(sessionStorageKey);
  if (!protectedToken) return null;
  try {
    return await unprotectLicenseToken(protectedToken);
  } catch {
    localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

async function requireSessionToken(): Promise<string> {
  const token = await readSaasSession();
  if (!token) throw new Error("Reconnectez-vous à TicketPro.");
  return token;
}

async function request<T>(
  pathname: string,
  body?: Record<string, unknown>,
  bearerToken?: string,
  method: "GET" | "POST" = "POST"
): Promise<T> {
  if (!apiUrl) throw new Error("L'API TicketPro n'est pas configurée.");
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    details?: Record<string, unknown>;
    error?: string;
  };
  if (!response.ok) {
    throw new SaasRequestError(
      payload.error ?? `Erreur TicketPro (${response.status}).`,
      response.status,
      payload.details
    );
  }
  return payload;
}
