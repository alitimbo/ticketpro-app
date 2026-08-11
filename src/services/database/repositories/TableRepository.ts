import type { DatabaseClient, DatabaseRow, DatabaseValue } from "../DatabaseClient";

export type LocalTableName =
  | "active_sessions_cache"
  | "app_logs"
  | "account_subscriptions"
  | "accounts"
  | "app_settings"
  | "billing_invoices"
  | "generated_files"
  | "hotspot_plans"
  | "internal_profiles"
  | "license_state"
  | "printers"
  | "router_connections"
  | "router_snapshots"
  | "routers"
  | "subscription_plans"
  | "ticket_batches"
  | "tickets"
  | "vpn_networks"
  | "vpn_peers";

const tableColumns: Record<LocalTableName, string[]> = {
  active_sessions_cache: [
    "id",
    "router_id",
    "username",
    "ip_address",
    "mac_address",
    "uptime",
    "session_time_left",
    "downloaded_bytes",
    "uploaded_bytes",
    "cached_at",
    "sync_status"
  ],
  app_logs: [
    "id",
    "account_id",
    "level",
    "category",
    "user_message",
    "technical_message",
    "router_id",
    "created_by_profile",
    "internal_profile_id"
  ],
  app_settings: ["id", "key", "value"],
  accounts: [
    "id",
    "email",
    "password_hash",
    "display_name",
    "company_name",
    "phone",
    "status",
    "last_login_at"
  ],
  account_subscriptions: [
    "id",
    "account_id",
    "subscription_plan_id",
    "status",
    "current_period_start",
    "current_period_end",
    "router_limit_snapshot",
    "price_cfa_snapshot",
    "price_per_router_cfa_snapshot",
    "payment_status"
  ],
  billing_invoices: [
    "id",
    "account_id",
    "subscription_id",
    "invoice_number",
    "amount_cfa",
    "status",
    "issued_at",
    "due_at",
    "paid_at",
    "notes"
  ],
  generated_files: [
    "id",
    "account_id",
    "router_id",
    "batch_id",
    "type",
    "file_name",
    "file_path",
    "format",
    "created_by_profile",
    "created_by_profile_id",
    "sync_status"
  ],
  hotspot_plans: [
    "id",
    "router_id",
    "name",
    "duration_minutes",
    "validity_minutes",
    "data_limit_mb",
    "download_limit",
    "upload_limit",
    "shared_users",
    "price_hint",
    "mikrotik_profile_name",
    "status",
    "sync_status"
  ],
  internal_profiles: [
    "id",
    "account_id",
    "role",
    "display_name",
    "password_hash",
    "is_enabled",
    "permissions_json",
    "last_used_at"
  ],
  license_state: [
    "id",
    "account_id",
    "license_id",
    "activation_id",
    "activation_token_encrypted",
    "install_id",
    "device_id",
    "status",
    "expires_at",
    "duration_days",
    "router_limit",
    "router_count",
    "max_devices",
    "device_count",
    "plan_id",
    "plan_code",
    "plan_name",
    "plan_description",
    "price_cfa",
    "billing_period",
    "last_validated_at"
  ],
  printers: ["id", "name", "type", "paper_width_mm", "status", "sync_status"],
  router_connections: [
    "id",
    "router_id",
    "mode",
    "host",
    "port",
    "use_ssl",
    "status",
    "last_error",
    "last_connected_at",
    "sync_status"
  ],
  router_snapshots: [
    "id",
    "router_id",
    "cpu_load",
    "memory_used",
    "memory_total",
    "uptime",
    "active_clients_count",
    "tickets_count",
    "plans_count",
    "captured_at",
    "sync_status"
  ],
  routers: [
    "id",
    "cloud_router_id",
    "account_id",
    "zone_id",
    "name",
    "label",
    "model",
    "board_name",
    "serial_number",
    "routeros_version",
    "local_ip",
    "hotspot_address",
    "notes",
    "api_port",
    "api_ssl_port",
    "username",
    "encrypted_password",
    "connection_mode",
    "status",
    "last_seen_at",
    "subscription_counted",
    "created_by_profile_id",
    "sync_status"
  ],
  subscription_plans: [
    "id",
    "name",
    "router_limit",
    "price_cfa",
    "price_per_router_cfa",
    "billing_period",
    "description",
    "is_recommended",
    "is_active"
  ],
  ticket_batches: [
    "id",
    "account_id",
    "router_id",
    "plan_id",
    "operator_profile",
    "quantity",
    "prefix",
    "code_length",
    "status",
    "generated_file_id",
    "created_by_profile",
    "created_by_profile_id",
    "sync_status",
    "hotspot_server_name"
  ],
  tickets: [
    "id",
    "account_id",
    "batch_id",
    "router_id",
    "plan_id",
    "username",
    "password_encrypted",
    "status",
    "mac_address",
    "ip_address",
    "activated_at",
    "completed_at",
    "expires_at",
    "deleted_at",
    "printed_count",
    "downloaded_bytes",
    "uploaded_bytes",
    "mikrotik_id",
    "created_by_profile",
    "created_by_profile_id",
    "sync_status",
    "hotspot_server_name",
    "mikrotik_profile_name",
    "exported_at",
    "archived_at",
    "router_deleted_at",
    "last_router_sync_at",
    "uptime_seconds",
    "remaining_seconds",
    "data_remaining_bytes"
  ],
  vpn_networks: [
    "id",
    "account_id",
    "name",
    "server_endpoint",
    "server_public_key",
    "server_port",
    "address_pool",
    "provisioning_api_url",
    "provisioning_api_token_encrypted",
    "status"
  ],
  vpn_peers: [
    "id",
    "account_id",
    "network_id",
    "router_id",
    "resource_id",
    "peer_type",
    "name",
    "public_key",
    "private_key_encrypted",
    "assigned_address",
    "allowed_ips",
    "endpoint_address",
    "endpoint_port",
    "status",
    "last_handshake_at"
  ]
};

export class TableRepository<T extends DatabaseRow = DatabaseRow> {
  constructor(
    private readonly database: DatabaseClient,
    private readonly tableName: LocalTableName
  ) {}

  async create(row: T): Promise<T> {
    const columns = tableColumns[this.tableName].filter((column) => column in row);
    const placeholders = columns.map((_, index) => `?${index + 1}`);
    const params = columns.map((column) => row[column] as DatabaseValue);

    await this.database.execute(
      `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
      params
    );

    const created = await this.findById(String(row.id));

    if (!created) {
      throw new Error("L'enregistrement local n'a pas pu être créé.");
    }

    return created;
  }

  async createMany(rows: T[]): Promise<T[]> {
    if (rows.length === 0) {
      return [];
    }

    await this.database.transaction(
      rows.map((row) => {
        const columns = tableColumns[this.tableName].filter((column) => column in row);
        const placeholders = columns.map((_, index) => `?${index + 1}`);

        return {
          params: columns.map((column) => row[column] as DatabaseValue),
          sql: `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`
        };
      })
    );

    const created = await Promise.all(rows.map((row) => this.findById(String(row.id))));

    if (created.some((row) => !row)) {
      throw new Error("Les enregistrements locaux n'ont pas pu être créés.");
    }

    return created as T[];
  }

  async findById(id: string): Promise<T | null> {
    const rows = await this.database.query<T>(`SELECT * FROM ${this.tableName} WHERE id = ?1`, [id]);
    return rows[0] ?? null;
  }

  async list(): Promise<T[]> {
    return this.database.query<T>(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`);
  }
}

export function createTableRepository<T extends DatabaseRow = DatabaseRow>(
  database: DatabaseClient,
  tableName: LocalTableName
) {
  return new TableRepository<T>(database, tableName);
}
