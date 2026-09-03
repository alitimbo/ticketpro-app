export type RouterConnectionMode = "agent_future" | "distant_ip" | "local" | "vpn";

export type RouterErrorCode =
  | "api_disabled"
  | "authentication_failed"
  | "device_mode_flagged"
  | "device_mode_restricted"
  | "duplicate_user"
  | "hotspot_not_found"
  | "permission_denied"
  | "remote_not_configured"
  | "remote_unavailable"
  | "router_rejected"
  | "router_offline"
  | "timeout"
  | "vpn_required";

export type RouterSummary = {
  id: string;
  name: string;
  host: string;
  hotspotAddress?: string | null;
  connectionMode: RouterConnectionMode;
  isReachable: boolean;
};

export type RouterConnectionTest = {
  ok: true;
  latencyMs: number;
  mode: RouterConnectionMode;
  checkedAt: string;
};

export type RouterWireGuardConfig = {
  assignedAddress: string;
  interfaceName: string;
  privateKey?: string;
  serverAllowedIps: string;
  serverEndpoint: string;
  serverPort: number;
  serverPublicKey: string;
};

export type RouterWireGuardInstallation = {
  assignedAddress: string | null;
  interfaceName: string;
  publicKey: string;
  serverPublicKeys: string[];
};

export type RouterWireGuardPeerReference = {
  interfaceName: string;
  serverPublicKey: string;
};

export type RouterSystemInfo = {
  identity: string;
  model: string;
  boardName: string;
  serialNumber: string;
  routerOsVersion: string;
  architecture: string;
  uptime: string;
};

export type HotspotServer = {
  id: string;
  name: string;
  interfaceName: string;
  addressPool: string;
  profileName: string;
  /** DNS captif lu depuis le profil Hotspot RouterOS associé. */
  dnsName?: string;
  isEnabled: boolean;
};

export type HotspotDnsConfigurationResult = {
  action: "created" | "updated";
  dnsName: string;
  profileName: string;
  serverName: string | null;
};

export type HotspotPlan = {
  id: string;
  name: string;
  /** Devise commerciale TicketPro. RouterOS ne stocke pas cette valeur. */
  currency?: string;
  /** Identifiant interne `.id` du profil RouterOS lorsqu'il est connu. */
  mikrotikId?: string | null;
  durationMinutes: number;
  validityMinutes: number | null;
  dataLimitMb: number | null;
  downloadLimit: string | null;
  uploadLimit: string | null;
  sharedUsers: number;
  priceHint: number | null;
  profileName: string;
  status: "active" | "disabled";
};

export type HotspotPlanDraft = Omit<HotspotPlan, "id" | "status"> & {
  status?: HotspotPlan["status"];
};

export type HotspotUser = {
  id: string;
  username: string;
  passwordSecretRef: string;
  planId: string;
  profileName: string;
  status: "available" | "active" | "disabled" | "error" | "exhausted" | "expired";
  comment: string | null;
  createdAt: string;
  downloadedBytes?: number;
  uploadedBytes?: number;
  uptime?: string | null;
  limitUptime?: string | null;
  limitBytesTotal?: number | null;
  macAddress?: string | null;
  serverName?: string;
};

export type HotspotUserDraft = {
  username: string;
  passwordSecretRef: string;
  /** RouterOS profile id or profile name, never the local SQLite plan id. */
  planId: string;
  comment?: string | null;
  /** RouterOS limit-uptime value, for example 3h or 1d. */
  limitUptime?: string | null;
  /** RouterOS limit-bytes-total value in bytes. */
  limitBytesTotal?: number | null;
  /**
   * Wall-clock validity after the first successful login. TicketPro stores
   * this value in managed RouterOS metadata so expiry remains autonomous.
   */
  validityMinutes?: number | null;
  /** RouterOS Hotspot server name or `all`. */
  serverName?: string;
};

export type HotspotUserLimits = {
  limitUptime?: string | null;
  limitBytesTotal?: number | null;
};

export type RouterVoucherDecommissionProgress = {
  completed: number;
  phase: "inventory" | "removing" | "verifying";
  total: number;
};

export type RouterVoucherDecommissionReport = {
  cleanupVersion: 1;
  failedCount: number;
  remainingAuthorizationCount: number;
  remainingManagedUserCount: number;
  removedCount: number;
  requestedCount: number;
  verifiedAt: string;
};

export type HotspotUsersBatchDraft = {
  planId: string;
  quantity: number;
  prefix?: string;
  codeLength?: number;
  createdByProfile?: string;
  limitUptime?: string | null;
  limitBytesTotal?: number | null;
  validityMinutes?: number | null;
  serverName?: string;
};

export type VoucherLifecycleEngineState = {
  clockReady: boolean;
  engineVersion: number;
  managedProfileCount: number;
  schedulerEnabled: boolean;
};

export type VoucherLifecycleEngineOptions = {
  /**
   * RouterOS user profiles that TicketPro is explicitly allowed to extend.
   * Profiles omitted from this list are always left unchanged. An omitted or
   * empty list deliberately means "do not touch user profiles".
   */
  managedProfileNames?: readonly string[];
};

export type RouterManagedResourceKind =
  | "firewall_rule"
  | "hotspot_dns"
  | "hotspot_profile_extension"
  | "hotspot_user_profile_extension"
  | "ip_binding"
  | "management_account"
  | "management_service"
  | "ntp_configuration"
  | "voucher_scheduler"
  | "voucher_script"
  | "wireguard_address"
  | "wireguard_interface"
  | "wireguard_peer"
  | "wireguard_route";

export type RouterManagedResourceOwnership = "external" | "shared" | "ticketpro";
export type RouterManagedResourceState = "drift" | "duplicate" | "missing" | "present";

export type RouterManagedResourceObservation = {
  /** Stable, secret-free identifier used by reconciliation and diagnostics. */
  key: string;
  kind: RouterManagedResourceKind;
  matchCount: number;
  ownership: RouterManagedResourceOwnership;
  state: RouterManagedResourceState;
  /** Only non-sensitive RouterOS values may be exposed here. */
  attributes: Record<string, boolean | number | string | null>;
};

export type RouterManagedResourceInspectionOptions = {
  authorizedManagementCidrs?: readonly string[];
  managementUsername?: string | null;
  managedHotspotProfileNames?: readonly string[];
  wireguardInterfaceName?: string | null;
};

export type RouterManagedResourceManifest = {
  capturedAt: string;
  desired: {
    authorizedManagementCidrs: string[];
    managementUsername: string | null;
    managedHotspotProfileNames: string[];
    wireguardInterfaceName: string | null;
  };
  resources: RouterManagedResourceObservation[];
  routerOsVersion: string;
  schemaVersion: 1;
  warnings: string[];
};

export type RouterManagementAccountConfig = {
  /** Allows adoption only after an explicit user confirmation. */
  adoptExisting?: boolean;
  groupName?: string;
  password: string;
  username: string;
};

export type RouterManagementAccountResult = {
  action: "created" | "updated";
  groupName: string;
  username: string;
};

export type RouterManagementServicePolicy = {
  authorizedCidrs: readonly string[];
  /** Must be set only after API access was tested through one authorized CIDR. */
  currentPathConfirmed: boolean;
  /** Disabled by default so preparing an account cannot cut unrelated access. */
  disableUnusedServices?: boolean;
};

export type RouterManagementServicePolicyResult = {
  disabledServices: string[];
  restrictedServices: string[];
};

export type ActiveHotspotUser = {
  id: string;
  username: string;
  ipAddress: string;
  macAddress: string;
  uptime: string;
  sessionTimeLeft: string;
  downloadedBytes: number;
  uploadedBytes: number;
};

export type HotspotBypassBinding = {
  address: string;
  comment: string;
  id: string;
  macAddress: string;
};

export type HotspotIpBindingMutationResult = {
  outcome: "already_present" | "created" | "not_found" | "removed" | "updated";
};

export type HotspotAntiTetheringConfig = {
  blockIpv4Ttl: boolean;
  blockIpv6: boolean;
  enabled: boolean;
};

export type HotspotAntiTetheringState = {
  blockIpv4Ttl: boolean;
  blockIpv6: boolean;
  managedRuleCount: number;
};

export type RouterHealth = {
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  uptime: string;
  temperatureCelsius: number | null;
  activeClientsCount: number;
};

export type InterfaceTraffic = {
  interfaceName: string;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
  isRunning: boolean;
};

export type RouterDateTime = {
  date: string;
  time: string;
  timeZone: string;
};

export type TicketDraft = {
  codeLength?: number;
  planId: string;
  prefix?: string;
  quantity: number;
};

export type CreatedTicket = {
  id: string;
  username: string;
  passwordSecretRef: string;
  planId: string;
  createdAt: string;
};
