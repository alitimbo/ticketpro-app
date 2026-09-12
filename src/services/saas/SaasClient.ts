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
import { recordActiveVpsRequest } from "../performance/VoucherGenerationPerformance";

const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");
const sessionStorageKey = "ticketpro:saas_session";

export type SaasSubscription = {
  id?: string;
  status: "active" | "trial" | "grace_period" | "expired" | "cancelled" | "none";
  is_active: boolean;
  is_trial: boolean;
  router_limit: number;
  device_limit_mode: "limited" | "unlimited";
  max_devices: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  access_ends_at: string | null;
  grace_period_end: string | null;
  grace_days_remaining: number;
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

export type SaasRouterAccessPolicyHistoryEntry = {
  organization_id: string;
  policy: RouterAccessPolicy;
  revision: number;
  router_id: string;
  changed_by_user_id: string;
  changed_at: string;
};

export type SaasDevice = {
  id: string;
  installation_id: string;
  name: string;
  platform: "windows" | "macos" | "linux" | "unknown";
  os_version: string | null;
  app_version: string;
  status: "active" | "offline" | "stale" | "revoked";
  is_current: boolean;
  vpn: {
    gateway_id: string;
    assigned_address: string | null;
    key_version: number;
    config_version: number;
    desired_state: "enabled" | "disabled";
    applied_state: "enabled" | "disabled" | "pending" | "error";
    last_handshake_at: string | null;
    last_error_code: string | null;
  } | null;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type SaasDeviceRegistration = {
  active_device_count: number;
  device_access_scope?: "owner" | "collaborator";
  device: SaasDevice;
  device_limit_mode: "limited" | "unlimited";
  max_devices: number | null;
  vpn: {
    address: string;
    allowed_ips: string[];
    config_version: number;
    endpoint: string;
    gateway_id: string;
    gateway_public_key: string;
    persistent_keepalive: number;
    port: number;
  };
};

export type SaasDeviceInventory = {
  active_count: number;
  collaborator_device_count?: number;
  device_access_scope?: "owner" | "collaborator";
  devices: SaasDevice[];
  device_limit_mode: "limited" | "unlimited";
  max_devices: number | null;
};

export type SaasRouterRecoverySnapshot = {
  api_port: number;
  api_ssl_port: number;
  board_name: string | null;
  connection_mode: "agent_future" | "distant_ip" | "local" | "vpn";
  connections: Array<{
    host: string;
    mode: "agent_future" | "distant_ip" | "local" | "vpn";
    port: number;
    status: "active" | "inactive";
    use_ssl: boolean;
  }>;
  credential: string;
  decommission_status?: "active" | "cleanup_required" | "cleanup_verified" | "completed" | "pending";
  hotspot_address: string | null;
  id: string;
  label: string;
  last_seen_at: string | null;
  local_ip: string;
  model: string | null;
  name: string;
  notes: string | null;
  plans: Array<{
    created_at: string;
    created_by_profile_id: string | null;
    currency: string;
    data_limit_mb: number | null;
    download_limit: string | null;
    duration_minutes: number;
    id: string;
    last_synced_at: string | null;
    mikrotik_id: string | null;
    mikrotik_profile_name: string | null;
    name: string;
    price_hint: number | null;
    revision: number;
    shared_users: number;
    status: string;
    upload_limit: string | null;
    updated_at: string;
    updated_by_profile_id: string | null;
    validity_minutes: number | null;
    history?: Array<{
      action: "created" | "updated" | "deleted" | "restored" | "synchronized";
      actor_profile_id: string | null;
      created_at: string;
      currency: string;
      id: string;
      mikrotik_id: string | null;
      mikrotik_profile_name: string | null;
      name: string;
      plan_id: string;
      price_hint: number | null;
      revision: number;
      router_id: string;
      snapshot_json: string;
      source: string;
    }>;
  }>;
  routeros_version: string | null;
  serial_number: string | null;
  stable_identity: string;
  status: "active" | "offline" | "warning";
  updated_at?: string;
  username: string;
  vpn: {
    assigned_address: string;
    public_key: string;
    status: "active" | "draft" | "revoked";
  } | null;
};

export type SaasTicketBatchSnapshot = {
  code_length: number;
  created_at: string;
  created_by_email: string;
  created_by_name: string;
  created_by_user_id: string;
  currency: string;
  hotspot_server_name: string;
  id: string;
  operator_profile: string;
  plan_id: string;
  prefix: string | null;
  price_snapshot: number | null;
  quantity: number;
  status: string;
  sync_status: string;
  updated_at: string;
};

export type SaasTicketSnapshot = {
  activated_at: string | null;
  archived_at: string | null;
  batch_id: string;
  completed_at: string | null;
  created_at: string;
  created_by_email: string;
  created_by_name: string;
  created_by_role: string;
  created_by_user_id: string;
  data_remaining_bytes: number | null;
  data_limit_mb_snapshot?: number | null;
  deleted_at: string | null;
  downloaded_bytes: number;
  download_limit_snapshot?: string | null;
  duration_minutes_snapshot?: number | null;
  expires_at: string | null;
  exported_at: string | null;
  hotspot_server_name: string;
  id: string;
  ip_address: string | null;
  last_router_sync_at: string | null;
  mac_address: string | null;
  mikrotik_id: string | null;
  mikrotik_profile_name: string | null;
  password_is_username: boolean;
  plan_id: string;
  printed_count: number;
  remaining_seconds: number | null;
  router_deleted_at: string | null;
  status: string;
  shared_users_snapshot?: number | null;
  sync_status: string;
  updated_at: string;
  uploaded_bytes: number;
  upload_limit_snapshot?: string | null;
  uptime_seconds: number;
  validity_minutes_snapshot?: number | null;
  username: string;
};

export type SaasRouterTicketCatalog = {
  batches: SaasTicketBatchSnapshot[];
  router_id: string;
  tickets: SaasTicketSnapshot[];
};

export type SaasGeneratedFileSnapshot = {
  batch_id: string | null;
  created_at: string;
  created_by_email: string;
  created_by_name: string;
  created_by_role: string;
  created_by_user_id: string;
  deleted_at: string | null;
  file_name: string;
  format: string;
  id: string;
  metadata_json: string | null;
  print_archive_available?: boolean;
  router_id: string;
  sync_status: string;
  type: string;
  updated_at: string;
};

export type SaasTicketPrintArchivePayload = {
  batchId: string;
  currency?: string | null;
  dataLimitLabel: string | null;
  displaySettings?: import("../tickets/TicketDisplaySettingsService").TicketDisplaySettings;
  durationLabel: string;
  format: "a4" | "a5" | "thermal58" | "thermal80";
  hotspotAddress: string;
  ownerPhone: string;
  planName: string;
  priceLabel?: string | null;
  qrCodeEnabled: boolean;
  template: "economy" | "premium" | "qr" | "simple";
  tickets: Array<{ password: string; username: string }>;
  titleLabel: string;
  validityLabel: string;
  version: 1;
  zoneName: string;
};

export type SaasActivityLogSnapshot = {
  category: string;
  created_at: string;
  created_by_email: string;
  created_by_name: string;
  created_by_role: string;
  created_by_user_id: string;
  id: string;
  level: "critical" | "error" | "info" | "warning";
  router_id: string;
  technical_message: string | null;
  user_message: string;
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

export type SaasEmailVerification = {
  registration_token: string;
  email: string;
  expires_at: string;
  resend_after_seconds: number;
  verified: boolean;
  message?: string;
};

export async function startSaasEmailVerification(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
}): Promise<SaasEmailVerification> {
  return request("/v1/saas/registration/start", {
    organization_name: input.organizationName,
    name: input.name,
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    phone: input.phone
  });
}

export async function verifySaasEmail(input: {
  registrationToken: string;
  verificationCode: string;
}): Promise<SaasEmailVerification> {
  return request("/v1/saas/registration/verify-email", {
    registration_token: input.registrationToken,
    verification_code: input.verificationCode
  });
}

export async function resendSaasEmailVerificationCode(registrationToken: string): Promise<SaasEmailVerification> {
  return request("/v1/saas/registration/resend-code", { registration_token: registrationToken });
}

export async function registerSaasAndInitiatePayment(input: {
  registrationToken: string;
  planId: string;
  msisdn: string;
  paymentType: IpayPaymentType;
}): Promise<InitiatedPaymentOrder> {
  return request("/v1/saas/register-and-pay", {
    registration_token: input.registrationToken,
    plan_id: input.planId,
    msisdn: input.msisdn,
    payment_type: input.paymentType
  });
}

export async function registerSaasTrial(input: {
  registrationToken: string;
}): Promise<SaasAuthResult> {
  const result = await request<SaasAuthResult>("/v1/saas/register-trial", {
    registration_token: input.registrationToken
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
  const result = await request<SaasAuthResult>(
    "/v1/saas/auth/switch-organization",
    { membership_id: membershipId },
    token
  );
  if (!result.session) throw new Error("La session de l'organisation n'a pas pu être créée.");
  await storeSaasSession(result.session.token);
  return result;
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
}): Promise<{
  invitation_delivery: "sent" | "not_sent";
  member: SaasOrganizationUser;
  message: string;
}> {
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
  appRole: UserRole;
  status: "active" | "disabled";
  routerAccessMode: "all" | "selected";
  routerIds: string[];
}): Promise<{ member: SaasOrganizationUser }> {
  const token = await requireSessionToken();
  return request("/v1/saas/team/members/update", {
    user_id: input.userId,
    app_role: input.appRole,
    status: input.status,
    router_access_mode: input.routerAccessMode,
    router_ids: input.routerIds
  }, token);
}

export async function resendSaasTeamInvitation(userId: string): Promise<{
  invitation_delivery: "sent" | "not_sent";
  ok: boolean;
  message: string;
}> {
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

export async function updateSaasAccountProfile(input: {
  name: string;
  phone: string;
}): Promise<{ user: SaasOrganizationUser }> {
  const token = await requireSessionToken();
  return request("/v1/saas/account/profile", {
    name: input.name,
    phone: input.phone
  }, token);
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
  resourceId: string;
}): Promise<LicenseVpnPeerResult> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/vpn/peers",
    {
      action: "upsert",
      name: input.name,
      peer_type: input.peerType,
      public_key: input.publicKey,
      resource_id: input.resourceId
    },
    token
  );
}

export async function revokeSaasVpnPeer(input: {
  peerType: "operator" | "router";
  publicKey: string;
  resourceId: string;
}): Promise<LicenseVpnPeerResult> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/vpn/peers",
    {
      action: "revoke",
      peer_type: input.peerType,
      public_key: input.publicKey,
      resource_id: input.resourceId
    },
    token
  );
}

export async function registerSaasDevice(input: {
  installationId: string;
  publicKey: string;
  name: string;
  platform: "windows" | "macos" | "linux";
  osVersion?: string;
  appVersion: string;
  replacementDeviceId?: string;
}): Promise<SaasDeviceRegistration> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/devices/register",
    {
      installation_id: input.installationId,
      public_key: input.publicKey,
      name: input.name,
      platform: input.platform,
      os_version: input.osVersion,
      app_version: input.appVersion,
      replacement_device_id: input.replacementDeviceId
    },
    token
  );
}

export async function heartbeatSaasDevice(input: {
  installationId: string;
  appVersion: string;
}): Promise<{ ok: boolean; device_id: string; status: SaasDevice["status"]; vpn_access: boolean }> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/devices/heartbeat",
    {
      installation_id: input.installationId,
      app_version: input.appVersion
    },
    token
  );
}

export async function listSaasDevices(): Promise<SaasDevice[]> {
  return (await getSaasDeviceInventory()).devices;
}

export async function getSaasDeviceInventory(): Promise<SaasDeviceInventory> {
  const token = await requireSessionToken();
  return request<SaasDeviceInventory>(
    "/v1/saas/devices",
    undefined,
    token,
    "GET"
  );
}

export async function rotateCurrentSaasDeviceKey(input: {
  installationId: string;
  previousPublicKey: string;
  publicKey: string;
}): Promise<SaasDeviceRegistration> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/devices/rotate-key",
    {
      installation_id: input.installationId,
      previous_public_key: input.previousPublicKey,
      public_key: input.publicKey
    },
    token
  );
}

export async function recoverCurrentSaasDevice(input: {
  installationId: string;
  previousPublicKey: string;
  publicKey: string;
  password: string;
}): Promise<SaasDeviceRegistration> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/devices/recover",
    {
      installation_id: input.installationId,
      previous_public_key: input.previousPublicKey,
      public_key: input.publicKey,
      password: input.password
    },
    token
  );
}

export async function revokeSaasDevice(deviceId: string): Promise<{
  ok: boolean;
  device_id: string;
  status: "revoked";
}> {
  const token = await requireSessionToken();
  return request("/v1/saas/devices/revoke", { device_id: deviceId }, token);
}

export async function rotateSaasVpnPeer(input: {
  name: string;
  peerType: "operator" | "router";
  previousPublicKey: string;
  publicKey: string;
  resourceId: string;
}): Promise<LicenseVpnPeerResult> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/vpn/peers",
    {
      action: "rotate",
      name: input.name,
      peer_type: input.peerType,
      previous_public_key: input.previousPublicKey,
      public_key: input.publicKey,
      resource_id: input.resourceId
    },
    token
  );
}

export type SaasVpnPeer = {
  assigned_address: string | null;
  connection_status: "connected" | "disconnected" | "revoked" | "configuration_error";
  last_handshake_at: string | null;
  name: string;
  peer_type: "operator" | "router";
  public_key: string;
  resource_id: string;
  revoked_at: string | null;
  status: "active" | "revoked";
};

export async function listSaasVpnPeers(): Promise<SaasVpnPeer[]> {
  const token = await requireSessionToken();
  const result = await request<{ peers: SaasVpnPeer[] }>(
    "/v1/saas/vpn/peers",
    undefined,
    token,
    "GET"
  );
  return result.peers;
}

export async function listSaasVpnOperatorPeers(): Promise<SaasVpnPeer[]> {
  return (await listSaasVpnPeers()).filter((peer) => peer.peer_type === "operator");
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

export async function getSaasRouterAccessPolicyHistory(
  routerId: string
): Promise<SaasRouterAccessPolicyHistoryEntry[]> {
  const token = await requireSessionToken();
  const result = await request<{ history: SaasRouterAccessPolicyHistoryEntry[] }>(
    `/v1/saas/router-access-policy/history?router_id=${encodeURIComponent(routerId)}`,
    undefined,
    token,
    "GET"
  );
  return result.history;
}

export type SaasRouterRecoveryState = {
  organization_id?: string;
  routers: SaasRouterRecoverySnapshot[];
  retired?: Array<{ router_id: string; stable_identity: string; retired_at: string }>;
};

export async function getSaasRouterRecoveryState(signal?: AbortSignal): Promise<SaasRouterRecoveryState> {
  const token = await requireSessionToken();
  return request<SaasRouterRecoveryState>("/v1/saas/routers/recovery", undefined, token, "GET", signal);
}

export async function getSaasRouterRecoverySnapshots(): Promise<SaasRouterRecoverySnapshot[]> {
  const token = await requireSessionToken();
  const result = await request<{ routers: SaasRouterRecoverySnapshot[] }>(
    "/v1/saas/routers/recovery",
    undefined,
    token,
    "GET"
  );
  return result.routers;
}

export async function saveSaasRouterRecoverySnapshot(
  router: SaasRouterRecoverySnapshot
): Promise<SaasRouterRecoverySnapshot> {
  const token = await requireSessionToken();
  const result = await request<{ router: SaasRouterRecoverySnapshot }>(
    "/v1/saas/routers/snapshot",
    { router },
    token
  );
  return result.router;
}

export async function getSaasRouterTicketCatalog(routerId: string, purpose: "tickets" | "report" = "tickets", signal?: AbortSignal): Promise<SaasRouterTicketCatalog> {
  const token = await requireSessionToken();
  return request<SaasRouterTicketCatalog>(
    `/v1/saas/router-ticket-catalog?router_id=${encodeURIComponent(routerId)}&purpose=${purpose}`,
    undefined,
    token,
    "GET",
    signal
  );
}

export async function saveSaasRouterTicketCatalog(input: {
  batches: Array<Omit<SaasTicketBatchSnapshot,
    "created_by_email" | "created_by_name" | "created_by_user_id" | "operator_profile">>;
  router_id: string;
  tickets: Array<Omit<SaasTicketSnapshot,
    "created_by_email" | "created_by_name" | "created_by_role" | "created_by_user_id">>;
}): Promise<SaasRouterTicketCatalog> {
  const token = await requireSessionToken();
  return request<SaasRouterTicketCatalog>(
    "/v1/saas/router-ticket-catalog",
    input,
    token
  );
}

export async function getSaasRouterFiles(routerId: string): Promise<SaasGeneratedFileSnapshot[]> {
  const token = await requireSessionToken();
  const result = await request<{ files: SaasGeneratedFileSnapshot[] }>(
    `/v1/saas/router-files?router_id=${encodeURIComponent(routerId)}`,
    undefined,
    token,
    "GET"
  );
  return result.files;
}

export async function saveSaasRouterFiles(input: {
  files: Array<Omit<SaasGeneratedFileSnapshot,
    "created_by_email" | "created_by_name" | "created_by_role" | "created_by_user_id" | "router_id">>;
  router_id: string;
}): Promise<SaasGeneratedFileSnapshot[]> {
  const token = await requireSessionToken();
  const result = await request<{ files: SaasGeneratedFileSnapshot[] }>(
    "/v1/saas/router-files",
    input,
    token
  );
  return result.files;
}

export async function saveSaasTicketPrintArchive(input: {
  archive: SaasTicketPrintArchivePayload;
  file_id: string;
  router_id: string;
}): Promise<{ available: boolean; updated_at: string; version: number }> {
  const token = await requireSessionToken();
  return request(
    "/v1/saas/router-file-print-archive",
    input,
    token
  );
}

export async function getSaasTicketPrintArchive(
  routerId: string,
  fileId: string
): Promise<SaasTicketPrintArchivePayload> {
  const token = await requireSessionToken();
  const result = await request<{ archive: SaasTicketPrintArchivePayload }>(
    `/v1/saas/router-file-print-archive?router_id=${encodeURIComponent(routerId)}&file_id=${encodeURIComponent(fileId)}`,
    undefined,
    token,
    "GET"
  );
  return result.archive;
}

export async function getSaasRouterActivityLogs(routerId: string): Promise<SaasActivityLogSnapshot[]> {
  const token = await requireSessionToken();
  const result = await request<{ logs: SaasActivityLogSnapshot[] }>(
    `/v1/saas/router-activity-logs?router_id=${encodeURIComponent(routerId)}`,
    undefined,
    token,
    "GET"
  );
  return result.logs;
}

export async function saveSaasRouterActivityLogs(input: {
  logs: Array<Omit<SaasActivityLogSnapshot,
    "created_by_email" | "created_by_name" | "created_by_role" | "created_by_user_id" | "router_id">>;
  router_id: string;
}): Promise<void> {
  const token = await requireSessionToken();
  await request("/v1/saas/router-activity-logs", input, token);
}

export async function cleanSaasRouterActivityLogs(routerId: string, before: string): Promise<number> {
  const token = await requireSessionToken();
  const result = await request<{ removed: number }>(
    "/v1/saas/router-activity-logs/clean",
    { before, router_id: routerId },
    token
  );
  return result.removed;
}

export type SaasRouterRemovalResult = {
  already_removed: boolean;
  ok: true;
  revoked_vpn_peer_count: number;
  router_id: string;
  vpn_revocation_confirmed: boolean;
};

export type SaasRouterDecommissionPreparation = {
  already_removed: boolean;
  decommission_status: "active" | "cleanup_required" | "cleanup_verified" | "completed" | "pending";
  ok: true;
  requires_router_cleanup: boolean;
  router_id: string;
};

export type SaasRouterDecommissionCleanupReport = {
  cleanup_version: 1;
  failed_count: number;
  remaining_authorization_count: number;
  remaining_managed_user_count: number;
  removed_count: number;
  requested_count: number;
  verified_at: string;
};

export async function removeSaasRouterRecoverySnapshot(
  routerId: string
): Promise<SaasRouterRemovalResult> {
  const token = await requireSessionToken();
  return request<SaasRouterRemovalResult>(
    "/v1/saas/routers/remove",
    { router_id: routerId },
    token
  );
}

export async function prepareSaasRouterDecommission(
  routerId: string
): Promise<SaasRouterDecommissionPreparation> {
  const token = await requireSessionToken();
  return request<SaasRouterDecommissionPreparation>(
    "/v1/saas/routers/remove/prepare",
    { router_id: routerId },
    token
  );
}

export async function reportSaasRouterDecommissionFailure(
  routerId: string,
  errorCode = "ROUTEROS_CLEANUP_FAILED"
): Promise<void> {
  const token = await requireSessionToken();
  await request(
    "/v1/saas/routers/remove/failure",
    { error_code: errorCode, router_id: routerId },
    token
  );
}

export async function completeSaasRouterDecommission(
  routerId: string,
  cleanupReport?: SaasRouterDecommissionCleanupReport
): Promise<SaasRouterRemovalResult> {
  const token = await requireSessionToken();
  return request<SaasRouterRemovalResult>(
    "/v1/saas/routers/remove/complete",
    {
      ...(cleanupReport ? { cleanup_report: cleanupReport } : {}),
      router_id: routerId
    },
    token
  );
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
  method: "GET" | "POST" = "POST",
  signal?: AbortSignal
): Promise<T> {
  if (!apiUrl) throw new Error("L'API TicketPro n'est pas configurée.");
  recordActiveVpsRequest();
  const response = await fetch(`${apiUrl}${pathname}`, {
    signal,
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

