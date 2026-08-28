import type { CreateTicketInput, TicketRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";
import { assertAccountProfileOwnership } from "../ownership";
import { canApplyPlanChangeToVoucher, resolveSharedTicketStatus } from "../../tickets";

export class TicketRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateTicketInput): Promise<TicketRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    await this.database.execute(
      `INSERT INTO tickets (
        id, account_id, batch_id, router_id, plan_id, username, password_encrypted, status,
        mac_address, ip_address, activated_at, completed_at, expires_at, deleted_at,
        printed_count, downloaded_bytes, uploaded_bytes, mikrotik_id, created_by_profile,
        created_by_profile_id, sync_status, hotspot_server_name, mikrotik_profile_name,
        exported_at, archived_at, router_deleted_at, last_router_sync_at,
        uptime_seconds, remaining_seconds, data_remaining_bytes,
        duration_minutes_snapshot, validity_minutes_snapshot, data_limit_mb_snapshot,
        download_limit_snapshot, upload_limit_snapshot, shared_users_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36)`,
      [
        input.id,
        input.account_id,
        input.batch_id,
        input.router_id,
        input.plan_id,
        input.username,
        input.password_encrypted,
        input.status,
        input.mac_address,
        input.ip_address,
        input.activated_at,
        input.completed_at,
        input.expires_at,
        input.deleted_at,
        input.printed_count,
        input.downloaded_bytes,
        input.uploaded_bytes,
        input.mikrotik_id,
        input.created_by_profile,
        input.created_by_profile_id,
        input.sync_status ?? "local",
        input.hotspot_server_name ?? "all",
        input.mikrotik_profile_name ?? null,
        input.exported_at ?? null,
        input.archived_at ?? null,
        input.router_deleted_at ?? null,
        input.last_router_sync_at ?? null,
        input.uptime_seconds ?? 0,
        input.remaining_seconds ?? null,
        input.data_remaining_bytes ?? null,
        input.duration_minutes_snapshot ?? null,
        input.validity_minutes_snapshot ?? null,
        input.data_limit_mb_snapshot ?? null,
        input.download_limit_snapshot ?? null,
        input.upload_limit_snapshot ?? null,
        input.shared_users_snapshot ?? null
      ]
    );

    const created = await this.findById(input.id);
    if (!created) throw new Error("Le ticket n'a pas pu être créé.");
    return created;
  }

  async findById(id: string): Promise<TicketRecord | null> {
    const rows = await this.database.query<TicketRecord>("SELECT * FROM tickets WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async findByRouterUsername(routerId: string, username: string): Promise<TicketRecord | null> {
    const rows = await this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE router_id = ?1 AND username = ?2 ORDER BY created_at DESC LIMIT 1",
      [routerId, username]
    );
    return rows[0] ?? null;
  }

  async upsertShared(input: CreateTicketInput): Promise<TicketRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    const current = await this.findById(input.id);
    const snapshot = commercialSnapshotValues(current, input);
    const shared = sharedTicketValues(current, input);
    await this.database.execute(
      `INSERT INTO tickets (
        id, account_id, batch_id, router_id, plan_id, username, password_encrypted, status,
        mac_address, ip_address, activated_at, completed_at, expires_at, deleted_at,
        printed_count, downloaded_bytes, uploaded_bytes, mikrotik_id, created_by_profile,
        created_by_profile_id, created_at, updated_at, sync_status, hotspot_server_name,
        mikrotik_profile_name, exported_at, archived_at, router_deleted_at,
        last_router_sync_at, uptime_seconds, remaining_seconds, data_remaining_bytes,
        duration_minutes_snapshot, validity_minutes_snapshot, data_limit_mb_snapshot,
        download_limit_snapshot, upload_limit_snapshot, shared_users_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        mac_address = excluded.mac_address,
        ip_address = excluded.ip_address,
        activated_at = excluded.activated_at,
        completed_at = excluded.completed_at,
        expires_at = excluded.expires_at,
        deleted_at = excluded.deleted_at,
        printed_count = excluded.printed_count,
        downloaded_bytes = excluded.downloaded_bytes,
        uploaded_bytes = excluded.uploaded_bytes,
        mikrotik_id = excluded.mikrotik_id,
        sync_status = excluded.sync_status,
        hotspot_server_name = excluded.hotspot_server_name,
        mikrotik_profile_name = excluded.mikrotik_profile_name,
        exported_at = excluded.exported_at,
        archived_at = excluded.archived_at,
        router_deleted_at = excluded.router_deleted_at,
        last_router_sync_at = excluded.last_router_sync_at,
        uptime_seconds = excluded.uptime_seconds,
        remaining_seconds = excluded.remaining_seconds,
        data_remaining_bytes = excluded.data_remaining_bytes,
        duration_minutes_snapshot = excluded.duration_minutes_snapshot,
        validity_minutes_snapshot = excluded.validity_minutes_snapshot,
        data_limit_mb_snapshot = excluded.data_limit_mb_snapshot,
        download_limit_snapshot = excluded.download_limit_snapshot,
        upload_limit_snapshot = excluded.upload_limit_snapshot,
        shared_users_snapshot = excluded.shared_users_snapshot,
        updated_at = excluded.updated_at
      WHERE tickets.account_id = excluded.account_id
        AND tickets.router_id = excluded.router_id`,
      [
        input.id,
        input.account_id,
        input.batch_id,
        input.router_id,
        input.plan_id,
        input.username,
        input.password_encrypted,
        shared.status,
        shared.macAddress,
        shared.ipAddress,
        shared.activatedAt,
        shared.completedAt,
        shared.expiresAt,
        shared.deletedAt,
        shared.printedCount,
        shared.downloadedBytes,
        shared.uploadedBytes,
        shared.mikrotikId,
        input.created_by_profile,
        input.created_by_profile_id,
        input.created_at ?? new Date().toISOString(),
        input.updated_at ?? new Date().toISOString(),
        shared.syncStatus,
        input.hotspot_server_name ?? "all",
        shared.mikrotikProfileName,
        shared.exportedAt,
        shared.archivedAt,
        shared.routerDeletedAt,
        shared.lastRouterSyncAt,
        shared.uptimeSeconds,
        shared.remainingSeconds,
        shared.dataRemainingBytes,
        snapshot.durationMinutes,
        snapshot.validityMinutes,
        snapshot.dataLimitMb,
        snapshot.downloadLimit,
        snapshot.uploadLimit,
        snapshot.sharedUsers
      ]
    );
    const saved = await this.findById(input.id);
    if (!saved || saved.account_id !== input.account_id || saved.router_id !== input.router_id) {
      throw new Error("Ce voucher partagé entre en conflit avec une donnée locale existante.");
    }
    return saved;
  }

  async update(input: CreateTicketInput): Promise<TicketRecord> {
    assertAccountProfileOwnership(input.account_id, input.created_by_profile_id);
    const current = await this.findById(input.id);
    if (!current || current.account_id !== input.account_id) {
      throw new Error("Le ticket à mettre à jour est introuvable.");
    }
    const snapshot = commercialSnapshotValues(current, input);
    await this.database.execute(
      `UPDATE tickets SET
        status = ?1, mac_address = ?2, ip_address = ?3, activated_at = ?4, completed_at = ?5,
        expires_at = ?6, deleted_at = ?7, printed_count = ?8, downloaded_bytes = ?9,
        uploaded_bytes = ?10, mikrotik_id = ?11, sync_status = ?12,
        hotspot_server_name = ?13, mikrotik_profile_name = ?14, exported_at = ?15,
        archived_at = ?16, router_deleted_at = ?17, last_router_sync_at = ?18,
        uptime_seconds = ?19, remaining_seconds = ?20, data_remaining_bytes = ?21,
        duration_minutes_snapshot = ?22, validity_minutes_snapshot = ?23,
        data_limit_mb_snapshot = ?24, download_limit_snapshot = ?25,
        upload_limit_snapshot = ?26, shared_users_snapshot = ?27,
        updated_at = ?28
      WHERE id = ?29 AND account_id = ?30`,
      [
        input.status,
        input.mac_address,
        input.ip_address,
        input.activated_at,
        input.completed_at,
        input.expires_at,
        input.deleted_at,
        input.printed_count,
        input.downloaded_bytes,
        input.uploaded_bytes,
        input.mikrotik_id,
        input.sync_status ?? "local",
        input.hotspot_server_name ?? "all",
        input.mikrotik_profile_name ?? null,
        input.exported_at ?? null,
        input.archived_at ?? null,
        input.router_deleted_at ?? null,
        input.last_router_sync_at ?? null,
        input.uptime_seconds ?? 0,
        input.remaining_seconds ?? null,
        input.data_remaining_bytes ?? null,
        snapshot.durationMinutes,
        snapshot.validityMinutes,
        snapshot.dataLimitMb,
        snapshot.downloadLimit,
        snapshot.uploadLimit,
        snapshot.sharedUsers,
        input.updated_at ?? new Date().toISOString(),
        input.id,
        input.account_id
      ]
    );

    const updated = await this.findById(input.id);
    if (!updated) throw new Error("Le ticket n'a pas pu être mis à jour.");
    return updated;
  }

  async listByBatch(batchId: string): Promise<TicketRecord[]> {
    return this.database.query<TicketRecord>("SELECT * FROM tickets WHERE batch_id = ?1 ORDER BY created_at ASC", [batchId]);
  }

  async listByRouter(routerId: string): Promise<TicketRecord[]> {
    return this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [routerId]
    );
  }

  async listExistingUsernamesByRouter(routerId: string): Promise<Array<{ username: string }>> {
    return this.database.query<{ username: string }>(
      "SELECT username FROM tickets WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY username",
      [routerId]
    );
  }

  async listByAccount(accountId: string, profileId?: string): Promise<TicketRecord[]> {
    if (profileId) {
      return this.database.query<TicketRecord>(
        "SELECT * FROM tickets WHERE account_id = ?1 AND created_by_profile_id = ?2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }
    return this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [accountId]
    );
  }

  async listForReportByAccount(accountId: string, profileId?: string): Promise<TicketRecord[]> {
    if (profileId) {
      return this.database.query<TicketRecord>(
        "SELECT * FROM tickets WHERE account_id = ?1 AND created_by_profile_id = ?2 ORDER BY created_at DESC",
        [accountId, profileId]
      );
    }

    return this.database.query<TicketRecord>(
      "SELECT * FROM tickets WHERE account_id = ?1 ORDER BY created_at DESC",
      [accountId]
    );
  }

  async recordRouterStatusByUsername(input: {
    accountId: string;
    routerId: string;
    status: string;
    username: string;
  }): Promise<void> {
    await this.database.execute(
      `UPDATE tickets
       SET status = ?1, sync_status = 'synced', updated_at = ?2
       WHERE account_id = ?3 AND router_id = ?4 AND username = ?5 AND deleted_at IS NULL`,
      [input.status, new Date().toISOString(), input.accountId, input.routerId, input.username]
    );
  }
}

function commercialSnapshotValues(current: TicketRecord | null, input: CreateTicketInput) {
  const mutable = !current || canApplyPlanChangeToVoucher(current);
  const value = <T>(previous: T | null | undefined, next: T | null | undefined): T | null => {
    if (mutable && next !== undefined) return next;
    return previous ?? next ?? null;
  };
  return {
    dataLimitMb: value(current?.data_limit_mb_snapshot, input.data_limit_mb_snapshot),
    downloadLimit: value(current?.download_limit_snapshot, input.download_limit_snapshot),
    durationMinutes: value(current?.duration_minutes_snapshot, input.duration_minutes_snapshot),
    sharedUsers: value(current?.shared_users_snapshot, input.shared_users_snapshot),
    uploadLimit: value(current?.upload_limit_snapshot, input.upload_limit_snapshot),
    validityMinutes: value(current?.validity_minutes_snapshot, input.validity_minutes_snapshot)
  };
}

function sharedTicketValues(current: TicketRecord | null, input: CreateTicketInput) {
  if (!current) {
    return {
      activatedAt: input.activated_at,
      archivedAt: input.archived_at ?? null,
      completedAt: input.completed_at,
      dataRemainingBytes: input.data_remaining_bytes ?? null,
      deletedAt: input.deleted_at,
      downloadedBytes: input.downloaded_bytes,
      exportedAt: input.exported_at ?? null,
      expiresAt: input.expires_at,
      ipAddress: input.ip_address,
      lastRouterSyncAt: input.last_router_sync_at ?? null,
      macAddress: input.mac_address,
      mikrotikId: input.mikrotik_id,
      mikrotikProfileName: input.mikrotik_profile_name ?? null,
      printedCount: input.printed_count,
      remainingSeconds: input.remaining_seconds ?? null,
      routerDeletedAt: input.router_deleted_at ?? null,
      status: input.status,
      syncStatus: input.sync_status ?? "synced",
      uploadedBytes: input.uploaded_bytes,
      uptimeSeconds: input.uptime_seconds ?? 0
    };
  }

  const status = resolveSharedTicketStatus(current.status, input.status);
  return {
    activatedAt: current.activated_at ?? input.activated_at,
    archivedAt: current.archived_at ?? input.archived_at ?? null,
    completedAt: current.completed_at ?? input.completed_at,
    dataRemainingBytes: minimumKnown(current.data_remaining_bytes, input.data_remaining_bytes),
    deletedAt: current.deleted_at ?? input.deleted_at,
    downloadedBytes: Math.max(current.downloaded_bytes, input.downloaded_bytes),
    exportedAt: current.exported_at ?? input.exported_at ?? null,
    expiresAt: current.expires_at ?? input.expires_at,
    ipAddress: input.ip_address ?? current.ip_address,
    lastRouterSyncAt: latestIso(current.last_router_sync_at, input.last_router_sync_at),
    macAddress: input.mac_address ?? current.mac_address,
    mikrotikId: current.mikrotik_id ?? input.mikrotik_id,
    mikrotikProfileName: canApplyPlanChangeToVoucher(current)
      ? input.mikrotik_profile_name ?? null
      : current.mikrotik_profile_name ?? input.mikrotik_profile_name ?? null,
    printedCount: Math.max(current.printed_count, input.printed_count),
    remainingSeconds: minimumKnown(current.remaining_seconds, input.remaining_seconds),
    routerDeletedAt: current.router_deleted_at ?? input.router_deleted_at ?? null,
    status: status.status,
    syncStatus: status.regression ? "conflict" : input.sync_status ?? "synced",
    uploadedBytes: Math.max(current.uploaded_bytes, input.uploaded_bytes),
    uptimeSeconds: Math.max(current.uptime_seconds ?? 0, input.uptime_seconds ?? 0)
  };
}

function minimumKnown(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return left;
  return Math.min(left, right);
}

function latestIso(left: string | null | undefined, right: string | null | undefined): string | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}
