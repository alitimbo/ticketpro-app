export type RouterConnectionMode = "agent_future" | "distant_ip" | "local" | "vpn";

export type RouterErrorCode =
  | "api_disabled"
  | "authentication_failed"
  | "duplicate_user"
  | "hotspot_not_found"
  | "permission_denied"
  | "remote_not_configured"
  | "remote_unavailable"
  | "router_offline"
  | "timeout"
  | "vpn_required";

export type RouterSummary = {
  id: string;
  name: string;
  host: string;
  connectionMode: RouterConnectionMode;
  isReachable: boolean;
};

export type RouterConnectionTest = {
  ok: true;
  latencyMs: number;
  mode: RouterConnectionMode;
  checkedAt: string;
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
  isEnabled: boolean;
};

export type HotspotPlan = {
  id: string;
  name: string;
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
  status: "available" | "active" | "disabled" | "expired";
  comment: string | null;
  createdAt: string;
};

export type HotspotUserDraft = {
  username: string;
  passwordSecretRef: string;
  planId: string;
  comment?: string | null;
};

export type HotspotUsersBatchDraft = {
  planId: string;
  quantity: number;
  prefix?: string;
  codeLength?: number;
  createdByProfile?: string;
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
