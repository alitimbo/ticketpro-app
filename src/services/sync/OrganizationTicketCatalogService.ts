import type { UserRole } from "../../domain/auth";
import type { CreateTicketBatchInput, CreateTicketInput, SyncStatus, TicketBatchRecord, TicketRecord } from "../../domain/database";
import { HotspotPlanRepository, RouterRepository, TicketBatchRepository, TicketRepository, type DatabaseClient } from "../database";
import { getSaasRouterTicketCatalog, saveSaasRouterTicketCatalog, type SaasTicketBatchSnapshot, type SaasTicketSnapshot } from "../saas";
import { secretRefForTicket } from "../tickets";

export type OrganizationTicketCatalogSyncResult = { importedBatches: number; importedTickets: number };

export class OrganizationTicketCatalogService {
  private readonly batches: TicketBatchRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly routers: RouterRepository;
  private readonly tickets: TicketRepository;

  constructor(database: DatabaseClient, private readonly accountId: string, private readonly profileId: string, private readonly profileRole: UserRole) {
    this.batches = new TicketBatchRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.routers = new RouterRepository(database);
    this.tickets = new TicketRepository(database);
  }

  async publishBatch(routerId: string, batchId: string): Promise<void> {
    const router = await this.requireOwnedRouter(routerId);
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.account_id !== this.accountId || batch.router_id !== routerId) throw new Error("Lot local introuvable pour la synchronisation de l’organisation.");
    const tickets = (await this.tickets.listByBatch(batchId)).map(ticketToCloud);
    const groups = tickets.length === 0 ? [[]] : chunk(tickets, 40);
    for (const group of groups) {
      await saveSaasRouterTicketCatalog({
        batches: [batchToCloud(batch)],
        router_id: router.cloud_router_id ?? router.id,
        tickets: group
      });
    }
  }

  async publishTicket(routerId: string, ticketId: string): Promise<void> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket || ticket.account_id !== this.accountId || ticket.router_id !== routerId) throw new Error("Voucher local introuvable pour la synchronisation de l’organisation.");
    await this.publishBatch(routerId, ticket.batch_id);
  }

  async publishRouter(routerId: string): Promise<void> {
    const batches = await this.batches.listByRouter(routerId);
    for (let index = 0; index < batches.length; index += 3) {
      await Promise.all(
        batches.slice(index, index + 3).map((batch) => this.publishBatch(routerId, batch.id))
      );
    }
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
}

function batchToCloud(batch: TicketBatchRecord) {
  return { code_length: batch.code_length, created_at: batch.created_at, currency: batch.currency, hotspot_server_name: batch.hotspot_server_name ?? "all", id: batch.id, plan_id: batch.plan_id, prefix: batch.prefix, price_snapshot: batch.price_snapshot, quantity: batch.quantity, status: batch.status, sync_status: batch.sync_status, updated_at: batch.updated_at };
}

function ticketToCloud(ticket: TicketRecord) {
  return { activated_at: ticket.activated_at, archived_at: ticket.archived_at ?? null, batch_id: ticket.batch_id, completed_at: ticket.completed_at, created_at: ticket.created_at, data_remaining_bytes: ticket.data_remaining_bytes ?? null, deleted_at: ticket.deleted_at, downloaded_bytes: ticket.downloaded_bytes, expires_at: ticket.expires_at, exported_at: ticket.exported_at ?? null, hotspot_server_name: ticket.hotspot_server_name ?? "all", id: ticket.id, ip_address: ticket.ip_address, last_router_sync_at: ticket.last_router_sync_at ?? null, mac_address: ticket.mac_address, mikrotik_id: ticket.mikrotik_id, mikrotik_profile_name: ticket.mikrotik_profile_name ?? null, password_is_username: ticket.password_encrypted.endsWith(`/${ticket.username}/password`), plan_id: ticket.plan_id, printed_count: ticket.printed_count, remaining_seconds: ticket.remaining_seconds ?? null, router_deleted_at: ticket.router_deleted_at ?? null, status: ticket.status, sync_status: ticket.sync_status, updated_at: ticket.updated_at, uploaded_bytes: ticket.uploaded_bytes, uptime_seconds: ticket.uptime_seconds ?? 0, username: ticket.username };
}

function batchFromCloud(accountId: string, routerId: string, planId: string, id: string, remote: SaasTicketBatchSnapshot): CreateTicketBatchInput {
  return { account_id: accountId, code_length: remote.code_length, created_at: remote.created_at, created_by_profile: remote.operator_profile, created_by_profile_id: cloudProfileId(accountId, remote.created_by_user_id, remote.created_by_name, remote.created_by_email), currency: remote.currency, deleted_at: null, generated_file_id: null, hotspot_server_name: remote.hotspot_server_name, id, operator_profile: remote.operator_profile, plan_id: planId, prefix: remote.prefix, price_snapshot: remote.price_snapshot, quantity: remote.quantity, router_id: routerId, status: remote.status, sync_status: normalizeSyncStatus(remote.sync_status), updated_at: remote.updated_at };
}

function ticketFromCloud(accountId: string, routerId: string, planId: string, batchId: string, id: string, profileRole: UserRole, remote: SaasTicketSnapshot): CreateTicketInput {
  return { account_id: accountId, activated_at: remote.activated_at, archived_at: remote.archived_at, batch_id: batchId, completed_at: remote.completed_at, created_at: remote.created_at, created_by_profile: remote.created_by_role || profileRole, created_by_profile_id: cloudProfileId(accountId, remote.created_by_user_id, remote.created_by_name, remote.created_by_email), data_remaining_bytes: remote.data_remaining_bytes, deleted_at: remote.deleted_at, downloaded_bytes: remote.downloaded_bytes, expires_at: remote.expires_at, exported_at: remote.exported_at, hotspot_server_name: remote.hotspot_server_name, id, ip_address: remote.ip_address, last_router_sync_at: remote.last_router_sync_at, mac_address: remote.mac_address, mikrotik_id: remote.mikrotik_id, mikrotik_profile_name: remote.mikrotik_profile_name, password_encrypted: remote.password_is_username ? secretRefForTicket(routerId, remote.username) : `cloud-password-unavailable://${remote.id}`, plan_id: planId, printed_count: remote.printed_count, remaining_seconds: remote.remaining_seconds, router_deleted_at: remote.router_deleted_at, router_id: routerId, status: remote.status, sync_status: normalizeSyncStatus(remote.sync_status), updated_at: remote.updated_at, uploaded_bytes: remote.uploaded_bytes, uptime_seconds: remote.uptime_seconds, username: remote.username };
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
