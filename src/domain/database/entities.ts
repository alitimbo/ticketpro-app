export type SyncStatus = "local" | "pending" | "synced" | "conflict";

export type RouterConnectionMode = "agent_future" | "distant_ip" | "local" | "vpn";

export type RouterStatus = "active" | "offline" | "error" | "warning";

export type AccountStatus = "active" | "expired" | "suspended" | "trial";

export type InternalProfileRole = "admin" | "agent" | "guest" | "operator";

export type BillingPeriod = "monthly" | "yearly";

export type AccountSubscriptionStatus = "active" | "cancelled" | "expired" | "suspended" | "trial";

export type PaymentStatus = "manual" | "paid" | "pending" | "unpaid";

export type BillingInvoiceStatus = "cancelled" | "draft" | "issued" | "overdue" | "paid";

export type AccountRecord = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  company_name: string | null;
  phone: string | null;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type InternalProfileRecord = {
  id: string;
  account_id: string;
  role: InternalProfileRole;
  display_name: string;
  password_hash: string;
  is_enabled: number;
  permissions_json: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type SubscriptionPlanRecord = {
  id: string;
  name: string;
  router_limit: number;
  price_cfa: number | null;
  price_per_router_cfa: number | null;
  billing_period: BillingPeriod;
  description: string | null;
  is_recommended: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type AccountSubscriptionRecord = {
  id: string;
  account_id: string;
  subscription_plan_id: string;
  status: AccountSubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  router_limit_snapshot: number;
  price_cfa_snapshot: number | null;
  price_per_router_cfa_snapshot: number | null;
  payment_status: PaymentStatus;
  created_at: string;
  updated_at: string;
};

export type BillingInvoiceRecord = {
  id: string;
  account_id: string;
  subscription_id: string | null;
  invoice_number: string;
  amount_cfa: number;
  status: BillingInvoiceStatus;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RouterRecord = {
  id: string;
  account_id: string;
  zone_id: string | null;
  name: string;
  label: string;
  model: string | null;
  board_name: string | null;
  serial_number: string | null;
  routeros_version: string | null;
  local_ip: string;
  api_port: number;
  api_ssl_port: number;
  username: string;
  encrypted_password: string;
  connection_mode: RouterConnectionMode;
  status: RouterStatus;
  last_seen_at: string | null;
  subscription_counted: number;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type HotspotPlanRecord = {
  id: string;
  router_id: string;
  name: string;
  duration_minutes: number;
  validity_minutes: number | null;
  data_limit_mb: number | null;
  download_limit: string | null;
  upload_limit: string | null;
  shared_users: number;
  price_hint: number | null;
  mikrotik_profile_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type TicketBatchRecord = {
  id: string;
  account_id: string;
  router_id: string;
  plan_id: string;
  operator_profile: string;
  quantity: number;
  prefix: string | null;
  code_length: number;
  status: string;
  generated_file_id: string | null;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type TicketRecord = {
  id: string;
  account_id: string;
  batch_id: string;
  router_id: string;
  plan_id: string;
  username: string;
  password_encrypted: string;
  status: string;
  mac_address: string | null;
  ip_address: string | null;
  activated_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
  printed_count: number;
  downloaded_bytes: number;
  uploaded_bytes: number;
  mikrotik_id: string | null;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type GeneratedFileRecord = {
  id: string;
  account_id: string;
  router_id: string;
  batch_id: string | null;
  type: string;
  file_name: string;
  file_path: string;
  format: string;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type CreateRouterInput = Omit<
  RouterRecord,
  "created_at" | "deleted_at" | "subscription_counted" | "sync_status" | "updated_at"
> &
  Partial<
    Pick<
      RouterRecord,
      "created_at" | "deleted_at" | "subscription_counted" | "sync_status" | "updated_at"
    >
  >;

export type CreateAccountInput = Omit<AccountRecord, "created_at" | "updated_at" | "last_login_at"> &
  Partial<Pick<AccountRecord, "created_at" | "updated_at" | "last_login_at">>;

export type CreateInternalProfileInput = Omit<InternalProfileRecord, "created_at" | "updated_at" | "last_used_at"> &
  Partial<Pick<InternalProfileRecord, "created_at" | "updated_at" | "last_used_at">>;

export type CreateSubscriptionPlanInput = Omit<SubscriptionPlanRecord, "created_at" | "updated_at"> &
  Partial<Pick<SubscriptionPlanRecord, "created_at" | "updated_at">>;

export type CreateAccountSubscriptionInput = Omit<AccountSubscriptionRecord, "created_at" | "updated_at"> &
  Partial<Pick<AccountSubscriptionRecord, "created_at" | "updated_at">>;

export type CreateBillingInvoiceInput = Omit<BillingInvoiceRecord, "created_at" | "updated_at"> &
  Partial<Pick<BillingInvoiceRecord, "created_at" | "updated_at">>;

export type CreateHotspotPlanInput = Omit<
  HotspotPlanRecord,
  "created_at" | "updated_at" | "deleted_at" | "sync_status"
> &
  Partial<Pick<HotspotPlanRecord, "created_at" | "updated_at" | "deleted_at" | "sync_status">>;

export type CreateTicketBatchInput = Omit<
  TicketBatchRecord,
  "created_at" | "updated_at" | "deleted_at" | "sync_status"
> &
  Partial<
    Pick<
      TicketBatchRecord,
      "created_at" | "updated_at" | "deleted_at" | "sync_status"
    >
  >;

export type CreateTicketInput = Omit<
  TicketRecord,
  "created_at" | "updated_at" | "sync_status"
> &
  Partial<Pick<TicketRecord, "created_at" | "updated_at" | "sync_status">>;

export type CreateGeneratedFileInput = Omit<
  GeneratedFileRecord,
  "created_at" | "updated_at" | "deleted_at" | "sync_status"
> &
  Partial<
    Pick<
      GeneratedFileRecord,
      "created_at" | "updated_at" | "deleted_at" | "sync_status"
    >
  >;
