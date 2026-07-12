export type UserRole = "admin" | "operator" | "agent" | "guest";

export type Permission =
  | "global.home"
  | "global.routers"
  | "global.routers.select"
  | "global.routers.manage"
  | "global.routers.add"
  | "global.routers.edit"
  | "global.routers.delete"
  | "global.subscription"
  | "global.invoices"
  | "global.settings"
  | "global.settings.profiles"
  | "router.home"
  | "router.plans.read"
  | "router.plans.write"
  | "router.tickets.read"
  | "router.tickets.generate"
  | "router.tickets.own"
  | "router.tickets.reprint"
  | "router.tickets.disable"
  | "router.tickets.delete"
  | "router.tickets.sync"
  | "router.tickets.revealPassword"
  | "router.files.read"
  | "router.files.own"
  | "router.report.read"
  | "router.report.own"
  | "router.clients.read"
  | "router.clients.disconnect"
  | "router.network.read"
  | "router.logs.read"
  | "router.logs.clean"
  | "router.settings"
  | "router.settings.manage";

export type UserProfile = {
  role: UserRole;
  label: string;
  description: string;
};

export type MainAccountStatus = "active" | "expired" | "suspended" | "trial";

export type MainAccountRecord = {
  companyName: string;
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  passwordHash: string;
  phone: string;
  status: MainAccountStatus;
  updatedAt: string;
};

export type MainAccountSession = {
  accountId: string;
  companyLabel: string;
  createdAt: number;
  email: string;
  expiresAt: number;
  lastActivityAt: number;
};

export type AuthSession = {
  account_id: string;
  account_email: string;
  internal_profile_id: string;
  internal_profile_role: UserRole;
  internal_profile_label: string;
  permissions: Permission[];
  created_at: number;
  last_activity_at: number;
  expires_at: number;
};
