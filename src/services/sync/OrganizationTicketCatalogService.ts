import type { UserRole } from "../../domain/auth";
import type { CreateTicketBatchInput, CreateTicketInput, SyncStatus, TicketBatchRecord, TicketRecord } from "../../domain/database";
import {
  HotspotPlanRepository,
  RouterRepository,
  SyncOutboxRepository,
  TicketBatchRepository,
  TicketRepository,
  stableHash,
  type DatabaseClient
} from "../database";
import {
  SaasRequestError,
  getSaasRouterTicketCatalog,
  saveSaasRouterTicketCatalog,
  type SaasTicketBatchSnapshot,
  type SaasTicketSnapshot
} from "../saas";
import { secretRefForTicket } from "../tickets";
import { SyncOutboxError, SyncOutboxService, type SyncOutboxDrainReport } from "./SyncOutboxService";

export type OrganizationTicketCatalogSyncResult = { importedBatches: number; importedTickets: number };

export const CLOUD_TICKET_CATALOG_OPERATION = "cloud.ticket_catalog.publish";
const CLOUD_TICKET_CATALOG_CHUNK_SIZE = 250;

type CloudTicketCatalogPayload = Parameters<typeof saveSaasRouterTicketCatalog>[0];

export class OrganizationTicketCatalogService {
  private readonly batches: TicketBatchRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly routers: RouterRepository;
  private readonly tickets: TicketRepository;
  private readonly outbox: SyncOutboxRepository;
  private readonly outboxService: SyncOutboxService;

  constructor(database: DatabaseClient, private readonly accountId: string, private readonly profileId: string, private readonly profileRole: UserRole) {
    this.batches = new TicketBatchRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.routers = new RouterRepository(database);
    this.tickets = new TicketRepository(database);
    this.outbox = new SyncOutboxRepository(database);
    this.outboxService = new SyncOutboxService(this.outbox).register(
      CLOUD_TICKET_CATALOG_OPERATION,
      async (_operation, rawPayload) => {
        const payload = requireCatalogPayload(rawPayload);
        try {
          await saveSaasRouterTicketCatalog(payload);
        } catch (error) {
          if (error instanceof SaasRequestError && error.status === 409) {
            throw new SyncOutboxError(error.message, "CLOUD_CATALOG_CONFLICT", "conflict");
          }
          if (error instanceof SaasRequestError && [400, 403, 404].includes(error.status)) {
            throw new SyncOutboxError(error.message, `CLOUD_CATALOG_HTTP_${error.status}`, "permanent");
          }
          throw new SyncOutboxError(
            error instanceof Error ? error.message : "Le catalogue organisationnel est temporairement inaccessible.",
            "CLOUD_CATALOG_RETRY",
            "retry"
          );
        }
      }
    );
  }

  async publishBatch(routerId: string, batchId: string): Promise<void> {
    const operationIds = await this.enqueueBatch(routerId, batchId);
    await this.outboxService.drain({
      accountId: this.accountId,
      limit: Math.max(40, operationIds.length),
      operationTypes: [CLOUD_TICKET_CATALOG_OPERATION],
      routerId
    });
    await this.requireOperationsSucceeded(operationIds);
  }

  private async enqueueBatch(routerId: string, batchId: string): Promise<string[]> {
    const router = await this.requireOwnedRouter(routerId);
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.account_id !== this.accountId || batch.router_id !== routerId) throw new Error("Lot local introuvable pour la synchronisation de l’organisation.");
    const tickets = (await this.tickets.listByBatch(batchId)).map(ticketToCloud);
    const groups = tickets.length === 0 ? [[]] : chunk(tickets, CLOUD_TICKET_CATALOG_CHUNK_SIZE);
    const operationIds: string[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const payload: CloudTicketCatalogPayload = {
        batches: [batchToCloud(batch)],
        router_id: router.cloud_router_id ?? router.id,
        tickets: groups[index]
      };
      const version = stableHash(JSON.stringify(payload));
      const operation = await this.outbox.enqueue({
        account_id: this.accountId,
        aggregate_id: batch.id,
        aggregate_type: "ticket_batch",
        correlation_id: batch.id,
        idempotency_key: `cloud:ticket-catalog:${payload.router_id}:${batch.id}:${index}:${version}`,
        max_attempts: 8,
        operation_type: CLOUD_TICKET_CATALOG_OPERATION,
        payload,
        priority: 60,
        router_id: routerId
      });
      operationIds.push(operation.id);
    }
    return operationIds;
  }

  async publishTicket(routerId: string, ticketId: string): Promise<void> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket || ticket.account_id !== this.accountId || ticket.router_id !== routerId) throw new Error("Voucher local introuvable pour la synchronisation de l’organisation.");
    await this.publishBatch(routerId, ticket.batch_id);
  }

  async publishRouter(routerId: string): Promise<void> {
    const batches = await this.batches.listByRouter(routerId);
    const operationIds: string[] = [];
    for (const batch of batches) operationIds.push(...await this.enqueueBatch(routerId, batch.id));
    await this.outboxService.drain({
      accountId: this.accountId,
      limit: Math.max(100, operationIds.length),
      operationTypes: [CLOUD_TICKET_CATALOG_OPERATION],
      routerId
    });
    await this.requireOperationsSucceeded(operationIds);
  }

  async resumePending(routerId?: string): Promise<SyncOutboxDrainReport> {
    return this.outboxService.drain({
      accountId: this.accountId,
      limit: 100,
      operationTypes: [CLOUD_TICKET_CATALOG_OPERATION],
      routerId
    });
  }

  async pullRouter(routerId: string): Promise<OrganizationTicketCatalogSyncResult> {
    const router = await this.requireOwnedRouter(routerId);
    const catalog = await getSaasRouterTicketCatalog(router.cloud_router_id ?? router.id);
    const plans = await this.plans.listByRouter(routerId);
    const byId = new Map(plans.map((plan) => [plan.id, plan]));
    const byProfile = new Map(plans.filter((plan) => plan.mikrotik_profile_name).map((plan) => [plan.mikrotik_profile_name as string, plan]));
    const remoteTicketsByBatch = new Map<string, SaasTicketSnapshot[]>();
    for (const ticket of catalog.tickets) remoteTicketsByBatch.set(ticket.batch_id, [...(remoteTicketsByBatch.get(ticket.batch_id) ?? []), ticket]);

    const localBatchIds = new Map<string, string>();
    let importedBatches = 0;
    let importedTickets = 0;
    for (const remote of catalog.batches) {
      const firstTicket = remoteTicketsByBatch.get(remote.id)?.[0];
      const plan = byId.get(remote.plan_id) ?? (firstTicket?.mikrotik_profile_name ? byProfile.get(firstTicket.mikrotik_profile_name) : undefined);
      if (!plan) continue;
      const occupied = await this.batches.findById(remote.id);
      const id = occupied && (occupied.account_id !== this.accountId || occupied.router_id !== routerId) ? sharedLocalId("batch", routerId, remote.id) : remote.id;
      localBatchIds.set(remote.id, id);
      await this.batches.upsertShared(batchFromCloud(this.accountId, routerId, plan.id, id, remote));
      importedBatches += 1;
    }

    for (const remote of catalog.tickets) {
      const batchId = localBatchIds.get(remote.batch_id);
      const plan = byId.get(remote.plan_id) ?? (remote.mikrotik_profile_name ? byProfile.get(remote.mikrotik_profile_name) : undefined);
      if (!batchId || !plan) continue;
      const sameUsername = await this.tickets.findByRouterUsername(routerId, remote.username);
      const occupied = await this.tickets.findById(remote.id);
      const id = sameUsername?.id ?? (occupied && (occupied.account_id !== this.accountId || occupied.router_id !== routerId) ? sharedLocalId("ticket", routerId, remote.id) : remote.id);
      await this.tickets.upsertShared(ticketFromCloud(this.accountId, routerId, plan.id, sameUsername?.batch_id ?? batchId, id, this.profileRole, remote));
      importedTickets += 1;
    }
    return { importedBatches, importedTickets };
  }

  private async requireOwnedRouter(routerId: string) {
    const router = await this.routers.findById(routerId);
    if (!router || router.account_id !== this.accountId || router.deleted_at) throw new Error("Routeur local introuvable pour la synchronisation de l’organisation.");
    return router;
  }

  private async requireOperationsSucceeded(operationIds: string[]): Promise<void> {
    const operations = await Promise.all(operationIds.map((id) => this.outbox.findById(id)));
    const unresolved = operations.filter((operation) => operation?.status !== "succeeded");
    if (unresolved.length === 0) return;
    const conflict = unresolved.find((operation) => operation?.status === "conflict" || operation?.status === "failed");
    if (conflict) {
      throw new Error(conflict.last_error_message ?? "La synchronisation organisationnelle nécessite une correction.");
    }
    throw new Error(
      `${unresolved.length} opération(s) organisationnelle(s) conservée(s) dans la file de reprise.`
    );
  }
}

function batchToCloud(batch: TicketBatchRecord) {
  return { code_length: batch.code_length, created_at: batch.created_at, currency: batch.currency, hotspot_server_name: batch.hotspot_server_name ?? "all", id: batch.id, plan_id: batch.plan_id, prefix: batch.prefix, price_snapshot: batch.price_snapshot, quantity: batch.quantity, status: batch.status, sync_status: batch.sync_status, updated_at: batch.updated_at };
}

function ticketToCloud(ticket: TicketRecord) {
  return { activated_at: ticket.activated_at, archived_at: ticket.archived_at ?? null, batch_id: ticket.batch_id, completed_at: ticket.completed_at, created_at: ticket.created_at, data_limit_mb_snapshot: ticket.data_limit_mb_snapshot ?? null, data_remaining_bytes: ticket.data_remaining_bytes ?? null, deleted_at: ticket.deleted_at, downloaded_bytes: ticket.downloaded_bytes, download_limit_snapshot: ticket.download_limit_snapshot ?? null, duration_minutes_snapshot: ticket.duration_minutes_snapshot ?? null, expires_at: ticket.expires_at, exported_at: ticket.exported_at ?? null, hotspot_server_name: ticket.hotspot_server_name ?? "all", id: ticket.id, ip_address: ticket.ip_address, last_router_sync_at: ticket.last_router_sync_at ?? null, mac_address: ticket.mac_address, mikrotik_id: ticket.mikrotik_id, mikrotik_profile_name: ticket.mikrotik_profile_name ?? null, password_is_username: ticket.password_encrypted.endsWith(`/${ticket.username}/password`), plan_id: ticket.plan_id, printed_count: ticket.printed_count, remaining_seconds: ticket.remaining_seconds ?? null, router_deleted_at: ticket.router_deleted_at ?? null, shared_users_snapshot: ticket.shared_users_snapshot ?? null, status: ticket.status, sync_status: ticket.sync_status, updated_at: ticket.updated_at, uploaded_bytes: ticket.uploaded_bytes, upload_limit_snapshot: ticket.upload_limit_snapshot ?? null, uptime_seconds: ticket.uptime_seconds ?? 0, username: ticket.username, validity_minutes_snapshot: ticket.validity_minutes_snapshot ?? null };
}

function batchFromCloud(accountId: string, routerId: string, planId: string, id: string, remote: SaasTicketBatchSnapshot): CreateTicketBatchInput {
  return { account_id: accountId, code_length: remote.code_length, created_at: remote.created_at, created_by_profile: remote.operator_profile, created_by_profile_id: cloudProfileId(accountId, remote.created_by_user_id, remote.created_by_name, remote.created_by_email), currency: remote.currency, deleted_at: null, generated_file_id: null, hotspot_server_name: remote.hotspot_server_name, id, operator_profile: remote.operator_profile, plan_id: planId, prefix: remote.prefix, price_snapshot: remote.price_snapshot, quantity: remote.quantity, router_id: routerId, status: remote.status, sync_status: normalizeSyncStatus(remote.sync_status), updated_at: remote.updated_at };
}

function ticketFromCloud(accountId: string, routerId: string, planId: string, batchId: string, id: string, profileRole: UserRole, remote: SaasTicketSnapshot): CreateTicketInput {
  return { account_id: accountId, activated_at: remote.activated_at, archived_at: remote.archived_at, batch_id: batchId, completed_at: remote.completed_at, created_at: remote.created_at, created_by_profile: remote.created_by_role || profileRole, created_by_profile_id: cloudProfileId(accountId, remote.created_by_user_id, remote.created_by_name, remote.created_by_email), data_limit_mb_snapshot: remote.data_limit_mb_snapshot ?? null, data_remaining_bytes: remote.data_remaining_bytes, deleted_at: remote.deleted_at, downloaded_bytes: remote.downloaded_bytes, download_limit_snapshot: remote.download_limit_snapshot ?? null, duration_minutes_snapshot: remote.duration_minutes_snapshot ?? null, expires_at: remote.expires_at, exported_at: remote.exported_at, hotspot_server_name: remote.hotspot_server_name, id, ip_address: remote.ip_address, last_router_sync_at: remote.last_router_sync_at, mac_address: remote.mac_address, mikrotik_id: remote.mikrotik_id, mikrotik_profile_name: remote.mikrotik_profile_name, password_encrypted: remote.password_is_username ? secretRefForTicket(routerId, remote.username) : `cloud-password-unavailable://${remote.id}`, plan_id: planId, printed_count: remote.printed_count, remaining_seconds: remote.remaining_seconds, router_deleted_at: remote.router_deleted_at, router_id: routerId, shared_users_snapshot: remote.shared_users_snapshot ?? null, status: remote.status, sync_status: normalizeSyncStatus(remote.sync_status), updated_at: remote.updated_at, uploaded_bytes: remote.uploaded_bytes, upload_limit_snapshot: remote.upload_limit_snapshot ?? null, uptime_seconds: remote.uptime_seconds, username: remote.username, validity_minutes_snapshot: remote.validity_minutes_snapshot ?? null };
}

function normalizeSyncStatus(value: string): SyncStatus {
  return value === "local" || value === "pending" || value === "conflict" || value === "synced" ? value : "synced";
}

function sharedLocalId(kind: "batch" | "ticket", routerId: string, cloudId: string): string {
  return `${kind}-shared-${routerId}-${cloudId}`.slice(0, 500);
}

function cloudProfileId(accountId: string, userId: string, name: string, email: string): string {
  return `${accountId}:cloud-user:${name.trim() || email.trim() || userId}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function requireCatalogPayload(value: unknown): CloudTicketCatalogPayload {
  if (!value || typeof value !== "object") {
    throw new SyncOutboxError("Charge du catalogue absente.", "CLOUD_CATALOG_PAYLOAD_INVALID", "conflict");
  }
  const payload = value as Partial<CloudTicketCatalogPayload>;
  if (!payload.router_id || !Array.isArray(payload.batches) || !Array.isArray(payload.tickets)) {
    throw new SyncOutboxError("Charge du catalogue invalide.", "CLOUD_CATALOG_PAYLOAD_INVALID", "conflict");
  }
  return payload as CloudTicketCatalogPayload;
}
