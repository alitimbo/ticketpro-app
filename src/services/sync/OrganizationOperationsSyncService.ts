import type { UserRole } from "../../domain/auth";
import type { AppLogRecord, GeneratedFileRecord, SyncStatus } from "../../domain/database";
import {
  normalizeTicketPrintArchivePayload,
  type TicketPrintArchivePayload
} from "../pdf";
import {
  AppLogRepository,
  GeneratedFileRepository,
  RouterRepository,
  type DatabaseClient
} from "../database";
import {
  cleanSaasRouterActivityLogs,
  getSaasRouterActivityLogs,
  getSaasRouterFiles,
  getSaasTicketPrintArchive,
  saveSaasRouterActivityLogs,
  saveSaasRouterFiles,
  saveSaasTicketPrintArchive
} from "../saas";

export class OrganizationOperationsSyncService {
  private readonly files: GeneratedFileRepository;
  private readonly logs: AppLogRepository;
  private readonly routers: RouterRepository;

  constructor(
    database: DatabaseClient,
    private readonly accountId: string,
    private readonly profileId: string,
    private readonly profileRole: UserRole
  ) {
    this.files = new GeneratedFileRepository(database);
    this.logs = new AppLogRepository(database);
    this.routers = new RouterRepository(database);
  }

  async publishFiles(routerId: string): Promise<void> {
    const router = await this.requireRouter(routerId);
    const files = (await this.files.listByRouterIncludingDeleted(routerId, this.accountId)).slice(0, 100);
    if (files.length === 0) return;
    for (const group of chunk(files, 3)) {
      await saveSaasRouterFiles({
        files: group.map(fileToCloud),
        router_id: router.cloud_router_id ?? router.id
      });
    }
  }

  async publishFile(routerId: string, fileId: string): Promise<void> {
    const router = await this.requireRouter(routerId);
    const file = await this.files.findById(fileId);
    if (!file || file.account_id !== this.accountId || file.router_id !== routerId) return;
    await saveSaasRouterFiles({
      files: [fileToCloud(file)],
      router_id: router.cloud_router_id ?? router.id
    });
  }

  async pullFiles(routerId: string): Promise<number> {
    const router = await this.requireRouter(routerId);
    const remoteFiles = await getSaasRouterFiles(router.cloud_router_id ?? router.id);
    for (const remote of remoteFiles) {
      const occupied = await this.files.findById(remote.id);
      const id = occupied && occupied.account_id !== this.accountId
        ? sharedLocalId("file", routerId, remote.id)
        : remote.id;
      await this.files.upsert({
        account_id: this.accountId,
        batch_id: remote.batch_id,
        created_at: remote.created_at,
        created_by_profile: remote.created_by_role,
        created_by_profile_id: cloudProfileId(
          this.accountId,
          remote.created_by_user_id,
          remote.created_by_name,
          remote.created_by_email
        ),
        deleted_at: remote.deleted_at,
        file_name: remote.file_name,
        file_path: `files/${remote.file_name}`,
        format: remote.format,
        id,
        metadata_json: remote.metadata_json,
        router_id: routerId,
        sync_status: normalizeSyncStatus(remote.sync_status),
        type: remote.type,
        updated_at: remote.updated_at
      });
    }
    return remoteFiles.length;
  }

  async publishTicketPrintArchive(
    routerId: string,
    fileId: string,
    archive: TicketPrintArchivePayload
  ): Promise<void> {
    const router = await this.requireRouter(routerId);
    const file = await this.files.findById(fileId);
    if (!file || file.account_id !== this.accountId || file.router_id !== routerId) {
      throw new Error("Le fichier local de l'archive d'impression est introuvable.");
    }
    await saveSaasTicketPrintArchive({
      archive: normalizeTicketPrintArchivePayload(archive),
      file_id: cloudFileId(routerId, file.id),
      router_id: router.cloud_router_id ?? router.id
    });
  }

  async getTicketPrintArchive(
    routerId: string,
    fileId: string
  ): Promise<TicketPrintArchivePayload> {
    const router = await this.requireRouter(routerId);
    return normalizeTicketPrintArchivePayload(
      await getSaasTicketPrintArchive(
        router.cloud_router_id ?? router.id,
        cloudFileId(routerId, fileId)
      )
    );
  }

  async publishLog(record: AppLogRecord): Promise<void> {
    if (!record.account_id || !record.router_id || record.account_id !== this.accountId) return;
    const router = await this.requireRouter(record.router_id);
    await saveSaasRouterActivityLogs({
      logs: [{
        category: record.category,
        created_at: record.created_at,
        id: record.id,
        level: record.level,
        technical_message: record.technical_message,
        user_message: record.user_message
      }],
      router_id: router.cloud_router_id ?? router.id
    });
  }

  async publishLogs(routerId: string): Promise<void> {
    const router = await this.requireRouter(routerId);
    const records = (await this.logs.listByAccount(this.accountId))
      .filter((record) => record.router_id === routerId)
      .slice(0, 100);
    if (records.length === 0) return;
    for (const group of chunk(records, 10)) {
      await saveSaasRouterActivityLogs({
        logs: group.map((record) => ({
          category: record.category,
          created_at: record.created_at,
          id: record.id,
          level: record.level,
          technical_message: record.technical_message,
          user_message: record.user_message
        })),
        router_id: router.cloud_router_id ?? router.id
      });
    }
  }

  async pullLogs(routerId: string): Promise<number> {
    const router = await this.requireRouter(routerId);
    const remoteLogs = await getSaasRouterActivityLogs(router.cloud_router_id ?? router.id);
    for (const remote of remoteLogs) {
      const occupied = await this.logs.findById(remote.id);
      const id = occupied && occupied.account_id !== this.accountId
        ? sharedLocalId("log", routerId, remote.id)
        : remote.id;
      await this.logs.upsertShared({
        account_id: this.accountId,
        category: remote.category,
        created_at: remote.created_at,
        created_by_profile: remote.created_by_role,
        id,
        internal_profile_id: cloudProfileId(
          this.accountId,
          remote.created_by_user_id,
          remote.created_by_name,
          remote.created_by_email
        ),
        level: remote.level,
        router_id: routerId,
        technical_message: remote.technical_message,
        user_message: remote.user_message
      });
    }
    return remoteLogs.length;
  }

  async cleanLogs(routerId: string, before: string): Promise<number> {
    const router = await this.requireRouter(routerId);
    return cleanSaasRouterActivityLogs(router.cloud_router_id ?? router.id, before);
  }

  private async requireRouter(routerId: string) {
    const router = await this.routers.findById(routerId);
    if (!router || router.account_id !== this.accountId || router.deleted_at) {
      throw new Error("Routeur local introuvable pour la synchronisation de l'organisation.");
    }
    return router;
  }
}

function fileToCloud(file: GeneratedFileRecord) {
  return {
    batch_id: file.batch_id,
    created_at: file.created_at,
    deleted_at: file.deleted_at,
    file_name: file.file_name,
    format: file.format,
    id: file.id,
    metadata_json: file.metadata_json,
    sync_status: file.sync_status,
    type: file.type,
    updated_at: file.updated_at
  };
}

function normalizeSyncStatus(value: string): SyncStatus {
  return value === "local" || value === "pending" || value === "conflict" || value === "synced"
    ? value
    : "synced";
}

function sharedLocalId(kind: "file" | "log", routerId: string, cloudId: string): string {
  return `${kind}-shared-${routerId}-${cloudId}`.slice(0, 500);
}

function cloudFileId(routerId: string, localFileId: string): string {
  const sharedPrefix = `file-shared-${routerId}-`;
  return localFileId.startsWith(sharedPrefix)
    ? localFileId.slice(sharedPrefix.length)
    : localFileId;
}

function cloudProfileId(accountId: string, userId: string, name: string, email: string): string {
  return `${accountId}:cloud-user:${name.trim() || email.trim() || userId}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}
