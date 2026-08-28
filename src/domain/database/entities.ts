export type SyncStatus = "local" | "pending" | "synced" | "conflict";

export type SyncOutboxStatus =
  | "pending"
  | "processing"
  | "retry"
  | "succeeded"
  | "conflict"
  | "failed"
  | "cancelled";

export type SyncOutboxRecord = {
  id: string;
  account_id: string;
  router_id: string | null;
  operation_type: string;
  aggregate_type: string;
  aggregate_id: string;
  idempotency_key: string;
  correlation_id: string;
  payload_json: string;
  status: SyncOutboxStatus;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  last_attempt_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSyncOutboxInput = Omit<
  SyncOutboxRecord,
  | "attempt_count"
  | "completed_at"
  | "created_at"
  | "last_attempt_at"
  | "last_error_code"
  | "last_error_message"
  | "locked_at"
  | "max_attempts"
  | "next_attempt_at"
  | "priority"
  | "status"
  | "updated_at"
> & Partial<Pick<
  SyncOutboxRecord,
  "created_at" | "max_attempts" | "next_attempt_at" | "priority" | "status" | "updated_at"
>>;

export type RouterConnectionMode = "agent_future" | "distant_ip" | "local" | "vpn";

export type RouterStatus = "active" | "offline" | "error" | "warning";

export type AccountStatus = "active" | "expired" | "suspended" | "trial";

export type InternalProfileRole = "admin" | "agent" | "guest" | "operator";

export type BillingPeriod = "monthly" | "yearly";

export type AccountSubscriptionStatus = "active" | "cancelled" | "expired" | "suspended" | "trial";

export type PaymentStatus = "manual" | "paid" | "pending" | "unpaid";

export type BillingInvoiceStatus = "cancelled" | "draft" | "issued" | "overdue" | "paid";

export type VpnNetworkStatus = "active" | "draft" | "suspended";
export type VpnPeerStatus = "active" | "draft" | "revoked";
export type VpnPeerType = "operator" | "router";

export type LicenseStatus = "issued" | "active" | "expired" | "revoked";

export type LicenseStateRecord = {
  id: "current";
  account_id: string;
  license_id: string;
  activation_id: string | null;
  activation_token_encrypted: string;
  install_id: string;
  device_id: string;
  status: LicenseStatus;
  expires_at: string | null;
  duration_days: number;
  router_limit: number;
  router_count: number;
  max_devices: number;
  device_count: number;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_description: string | null;
  price_cfa: number | null;
  billing_period: string;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
};

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

export type VpnNetworkRecord = {
  id: string;
  account_id: string;
  name: string;
  server_endpoint: string;
  server_public_key: string;
  server_port: number;
  address_pool: string;
  provisioning_api_url: string;
  provisioning_api_token_encrypted: string | null;
  status: VpnNetworkStatus;
  created_at: string;
  updated_at: string;
};

export type VpnPeerRecord = {
  id: string;
  account_id: string;
  network_id: string;
  router_id: string | null;
  resource_id: string;
  peer_type: VpnPeerType;
  name: string;
  public_key: string;
  private_key_encrypted: string | null;
  assigned_address: string;
  allowed_ips: string;
  endpoint_address: string | null;
  endpoint_port: number | null;
  status: VpnPeerStatus;
  last_handshake_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RouterRecord = {
  id: string;
  cloud_router_id?: string | null;
  account_id: string;
  organization_id?: string | null;
  zone_id: string | null;
  name: string;
  label: string;
  model: string | null;
  board_name: string | null;
  serial_number: string | null;
  routeros_version: string | null;
  local_ip: string;
  hotspot_address: string | null;
  notes: string | null;
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

export type RouterConnectionRecord = {
  id: string;
  router_id: string;
  mode: RouterConnectionMode;
  host: string;
  port: number;
  use_ssl: number;
  status: string;
  last_error: string | null;
  last_connected_at: string | null;
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
  currency: string;
  mikrotik_id: string | null;
  mikrotik_profile_name: string | null;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  revision: number;
  last_synced_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type HotspotPlanHistoryRecord = {
  id: string;
  plan_id: string;
  router_id: string;
  action: "created" | "updated" | "deleted" | "restored" | "synchronized";
  revision: number;
  actor_profile_id: string | null;
  source: string;
  mikrotik_id: string | null;
  mikrotik_profile_name: string | null;
  name: string;
  currency: string;
  price_hint: number | null;
  snapshot_json: string;
  created_at: string;
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
  currency: string;
  price_snapshot: number | null;
  status: string;
  generated_file_id: string | null;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  hotspot_server_name?: string;
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
  hotspot_server_name?: string;
  mikrotik_profile_name?: string | null;
  exported_at?: string | null;
  archived_at?: string | null;
  router_deleted_at?: string | null;
  last_router_sync_at?: string | null;
  uptime_seconds?: number;
  remaining_seconds?: number | null;
  data_remaining_bytes?: number | null;
  duration_minutes_snapshot?: number | null;
  validity_minutes_snapshot?: number | null;
  data_limit_mb_snapshot?: number | null;
  download_limit_snapshot?: string | null;
  upload_limit_snapshot?: string | null;
  shared_users_snapshot?: number | null;
};

export type TicketStateHistoryRecord = {
  id: string;
  account_id: string;
  ticket_id: string;
  router_id: string;
  previous_status: string | null;
  next_status: string;
  source: string;
  message: string;
  created_by_profile_id: string | null;
  created_at: string;
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
  metadata_json: string | null;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type PrintHistoryRecord = {
  id: string;
  account_id: string;
  router_id: string | null;
  batch_id: string | null;
  printer_id: string | null;
  printer_name: string;
  mode: string;
  format: string;
  status: string;
  ticket_count: number;
  user_message: string;
  created_by_profile: string;
  created_by_profile_id: string;
  created_at: string;
};

export type ActiveSessionCacheRecord = {
  id: string;
  router_id: string;
  username: string;
  ip_address: string | null;
  mac_address: string | null;
  uptime: string | null;
  session_time_left: string | null;
  downloaded_bytes: number;
  uploaded_bytes: number;
  cached_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type RouterSnapshotRecord = {
  id: string;
  router_id: string;
  cpu_load: number | null;
  memory_used: number | null;
  memory_total: number | null;
  uptime: string | null;
  active_clients_count: number;
  tickets_count: number;
  plans_count: number;
  captured_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export type RouterManagedResourceManifestStatus = "drift" | "error" | "synced";

export type RouterManagedResourceManifestRecord = {
  account_id: string;
  created_at: string;
  desired_json: string;
  last_error: string | null;
  observed_at: string;
  observed_json: string;
  revision: number;
  router_id: string;
  schema_version: number;
  status: RouterManagedResourceManifestStatus;
  updated_at: string;
  warnings_json: string;
};

export type AppLogRecord = {
  id: string;
  account_id: string | null;
  level: "critical" | "error" | "info" | "warning";
  category: string;
  user_message: string;
  technical_message: string | null;
  router_id: string | null;
  created_by_profile: string | null;
  internal_profile_id: string | null;
  created_at: string;
};

export type CreateRouterInput = Omit<
  RouterRecord,
  "cloud_router_id" | "created_at" | "deleted_at" | "hotspot_address" | "notes" | "organization_id" | "subscription_counted" | "sync_status" | "updated_at"
> &
  Partial<
    Pick<
      RouterRecord,
      "cloud_router_id" | "created_at" | "deleted_at" | "hotspot_address" | "notes" | "organization_id" | "subscription_counted" | "sync_status" | "updated_at"
    >
  >;

export type CreateRouterConnectionInput = Omit<
  RouterConnectionRecord,
  "created_at" | "deleted_at" | "sync_status" | "updated_at"
> &
  Partial<Pick<RouterConnectionRecord, "created_at" | "deleted_at" | "sync_status" | "updated_at">>;

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
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "sync_status"
  | "currency"
  | "mikrotik_id"
  | "created_by_profile_id"
  | "updated_by_profile_id"
  | "revision"
  | "last_synced_at"
> &
  Partial<
    Pick<
      HotspotPlanRecord,
      | "created_at"
      | "updated_at"
      | "deleted_at"
      | "sync_status"
      | "currency"
      | "mikrotik_id"
      | "created_by_profile_id"
      | "updated_by_profile_id"
      | "revision"
      | "last_synced_at"
    >
  >;

export type CreateTicketBatchInput = Omit<
  TicketBatchRecord,
  "created_at" | "updated_at" | "deleted_at" | "sync_status" | "currency" | "price_snapshot"
> &
  Partial<
    Pick<
      TicketBatchRecord,
      "created_at" | "updated_at" | "deleted_at" | "sync_status" | "currency" | "price_snapshot"
    >
  >;

export type CreateTicketInput = Omit<
  TicketRecord,
  "created_at" | "updated_at" | "sync_status"
> &
  Partial<Pick<TicketRecord, "created_at" | "updated_at" | "sync_status">>;

export type CreateGeneratedFileInput = Omit<
  GeneratedFileRecord,
  "created_at" | "updated_at" | "deleted_at" | "metadata_json" | "sync_status"
> &
  Partial<
    Pick<
      GeneratedFileRecord,
      "created_at" | "updated_at" | "deleted_at" | "metadata_json" | "sync_status"
    >
  >;

export type CreatePrintHistoryInput = Omit<PrintHistoryRecord, "created_at"> &
  Partial<Pick<PrintHistoryRecord, "created_at">>;

export type CreateRouterSnapshotInput = Omit<
  RouterSnapshotRecord,
  "created_at" | "updated_at" | "deleted_at" | "sync_status"
> &
  Partial<Pick<RouterSnapshotRecord, "created_at" | "updated_at" | "deleted_at" | "sync_status">>;

export type CreateAppLogInput = Omit<AppLogRecord, "created_at"> & Partial<Pick<AppLogRecord, "created_at">>;
