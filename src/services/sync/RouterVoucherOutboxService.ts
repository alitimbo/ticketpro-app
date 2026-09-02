import type { CreateTicketInput, SyncOutboxRecord, TicketRecord } from "../../domain/database";
import type { HotspotUser } from "../../domain/router";
import {
  HotspotPlanRepository,
  SyncOutboxRepository,
  TicketBatchRepository,
  TicketRepository,
  type EnqueueSyncOperationInput,
  type DatabaseClient
} from "../database";
import { RouterServiceError, type RouterService } from "../router";
import { recordActiveOutboxRetry } from "../performance/VoucherGenerationPerformance";
import { buildVoucherBatchOwnershipComment, voucherBelongsToBatch } from "../tickets";
import { SyncOutboxError, SyncOutboxService, type SyncOutboxDrainReport } from "./SyncOutboxService";

export const ROUTER_VOUCHER_CREATE_OPERATION = "routeros.voucher.create";
export const ROUTER_VOUCHER_MAX_ATTEMPTS = 10_000;
const ROUTER_VOUCHER_RESUME_LIMIT = 200;

type VoucherCreatePayload = { ticketId: string };

export type RouterVoucherResumeReport = SyncOutboxDrainReport & {
  completedBatchIds: string[];
};

export class RouterVoucherOutboxService {
  private readonly batches: TicketBatchRepository;
  private readonly outbox: SyncOutboxRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly processor: SyncOutboxService;
  private readonly tickets: TicketRepository;

  constructor(
    database: DatabaseClient,
    private readonly accountId: string,
    private readonly routerService: Pick<RouterService, "createHotspotUser" | "findHotspotUser">
  ) {
    this.batches = new TicketBatchRepository(database);
    this.outbox = new SyncOutboxRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.tickets = new TicketRepository(database);
    this.processor = new SyncOutboxService(this.outbox, { stopOnRetry: true }).register(
      ROUTER_VOUCHER_CREATE_OPERATION,
      (operation, payload) => this.processCreate(operation, requireCreatePayload(payload))
    );
  }

  async enqueueTickets(tickets: CreateTicketInput[]): Promise<Map<string, SyncOutboxRecord>> {
    const operations = new Map<string, SyncOutboxRecord>();
    const queued = await this.outbox.enqueueMany(
      buildRouterVoucherCreateOperations(this.accountId, tickets)
    );
    queued.forEach((operation) => operations.set(operation.aggregate_id, operation));
    return operations;
  }

  async begin(operationId: string): Promise<SyncOutboxRecord | null> {
    return this.outbox.claim(operationId, this.accountId);
  }

  async beginMany(operationIds: string[]): Promise<Map<string, SyncOutboxRecord>> {
    return this.outbox.claimMany(operationIds, this.accountId);
  }

  async complete(operationId: string, ticket: CreateTicketInput): Promise<void> {
    await this.tickets.update({
      ...ticket,
      last_router_sync_at: ticket.last_router_sync_at ?? new Date().toISOString(),
      sync_status: "synced"
    });
    await this.outbox.markSucceeded(operationId, this.accountId);
  }

  async completeMany(entries: Array<{ operationId: string; ticket: CreateTicketInput }>): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    await this.tickets.confirmRouterBatch(entries.map(({ ticket }) => ({
      ...ticket,
      last_router_sync_at: ticket.last_router_sync_at ?? now,
      sync_status: "synced"
    })));
    await this.outbox.markSucceededMany(entries.map(({ operationId }) => operationId), this.accountId, now);
  }

  async defer(operationId: string, error: unknown): Promise<void> {
    const classified = classifyRouterWriteError(error);
    if (classified.kind === "conflict") {
      await this.outbox.markConflict(
        operationId,
        this.accountId,
        classified.code,
        classified.message
      );
      return;
    }
    if (classified.kind === "permanent") {
      await this.outbox.markFailed(
        operationId,
        this.accountId,
        classified.code,
        classified.message
      );
      return;
    }
    const status = await this.outbox.markRetry(operationId, this.accountId, {
      code: classified.code,
      message: classified.message,
      nextAttemptAt: new Date(Date.now() + 2_000).toISOString()
    });
    if (status === "retry") recordActiveOutboxRetry();
  }

  async deferMany(operationIds: string[], error: unknown): Promise<void> {
    if (operationIds.length === 0) return;
    const classified = classifyRouterWriteError(error);
    if (classified.kind === "conflict") {
      await this.outbox.markConflictMany(
        operationIds,
        this.accountId,
        classified.code,
        classified.message
      );
      return;
    }
    if (classified.kind === "permanent") {
      await this.outbox.markFailedMany(
        operationIds,
        this.accountId,
        classified.code,
        classified.message
      );
      return;
    }
    await this.outbox.markRetryMany(operationIds, this.accountId, {
      code: classified.code,
      message: classified.message,
      nextAttemptAt: new Date(Date.now() + 2_000).toISOString()
    });
    recordActiveOutboxRetry(operationIds.length);
  }

  async resume(routerId: string): Promise<RouterVoucherResumeReport> {
    const [routerOperations, pendingBatches] = await Promise.all([
      this.outbox.listByAccount(this.accountId).then((operations) => operations.filter(
        (operation) => operation.router_id === routerId
          && operation.operation_type === ROUTER_VOUCHER_CREATE_OPERATION
      )),
      this.batches.listByRouter(routerId).then((batches) => batches.filter(
        (batch) => batch.account_id === this.accountId && batch.sync_status !== "synced"
      ))
    ]);
    const pendingBatchIds = new Set(pendingBatches.map((batch) => batch.id));
    const affectedBatchIds = new Set(
      routerOperations
        .filter((operation) =>
          ["pending", "processing", "retry"].includes(operation.status)
          || pendingBatchIds.has(operation.correlation_id)
        )
        .map((operation) => operation.correlation_id)
    );
    const report = await this.processor.drain({
      accountId: this.accountId,
      limit: ROUTER_VOUCHER_RESUME_LIMIT,
      operationTypes: [ROUTER_VOUCHER_CREATE_OPERATION],
      routerId
    });
    const completedBatchIds: string[] = [];
    for (const batchId of affectedBatchIds) {
      if (await this.reconcileBatchState(batchId)) completedBatchIds.push(batchId);
    }
    return { ...report, completedBatchIds };
  }

  private async reconcileBatchState(batchId: string): Promise<boolean> {
    const [batch, tickets, currentOperations] = await Promise.all([
      this.batches.findById(batchId),
      this.tickets.listByBatch(batchId),
      this.outbox.listByAccount(this.accountId)
    ]);
    if (!batch || batch.account_id !== this.accountId) return false;

    const operations = currentOperations.filter((operation) =>
      operation.router_id === batch.router_id
      && operation.operation_type === ROUTER_VOUCHER_CREATE_OPERATION
      && operation.correlation_id === batchId
    );
    const expectedTicketIds = new Set(tickets.map((ticket) => ticket.id));
    const exactTicketSet = tickets.length === batch.quantity
      && expectedTicketIds.size === batch.quantity
      && operations.length === batch.quantity
      && operations.every((operation) => expectedTicketIds.has(operation.aggregate_id));
    const allConfirmed = exactTicketSet
      && tickets.every((ticket) => ticket.sync_status === "synced" && Boolean(ticket.last_router_sync_at))
      && operations.every((operation) => operation.status === "succeeded");
    const hasTerminalError = operations.some((operation) =>
      operation.status === "conflict" || operation.status === "failed"
    ) || tickets.some((ticket) => ticket.sync_status === "conflict");
    const nextStatus = allConfirmed ? "terminé" : "partiel";
    const nextSyncStatus = allConfirmed ? "synced" : hasTerminalError ? "conflict" : "pending";
    if (batch.status !== nextStatus || batch.sync_status !== nextSyncStatus) {
      await this.batches.updateState(batch.id, this.accountId, nextStatus, nextSyncStatus);
    }
    return allConfirmed;
  }

  private async processCreate(operation: SyncOutboxRecord, payload: VoucherCreatePayload): Promise<void> {
    const ticket = await this.tickets.findById(payload.ticketId);
    if (!ticket || ticket.account_id !== this.accountId || ticket.router_id !== operation.router_id) {
      throw new SyncOutboxError(
        "Le voucher local associé à l'opération est introuvable.",
        "LOCAL_VOUCHER_MISSING",
        "conflict"
      );
    }
    const plan = await this.plans.findById(ticket.plan_id);
    const expectedProfile = ticket.mikrotik_profile_name ?? plan?.mikrotik_profile_name ?? plan?.name;
    if (!plan || !expectedProfile) {
      throw new SyncOutboxError(
        "Le profil MikroTik du voucher n'est plus disponible.",
        "ROUTER_PROFILE_MISSING",
        "conflict"
      );
    }

    let existing = await this.routerService.findHotspotUser(ticket.username);
    if (existing) {
      await this.confirmExisting(operation, ticket, existing, expectedProfile);
      return;
    }

    if (!canCreatePendingVoucher(ticket)) {
      throw new SyncOutboxError(
        "Ce voucher a déjà été émis ou utilisé. TicketPro refuse de le recréer.",
        "VOUCHER_RECREATION_REFUSED",
        "conflict"
      );
    }

    try {
      existing = await this.routerService.createHotspotUser({
        comment: buildVoucherBatchOwnershipComment(ticket.batch_id),
        limitBytesTotal: ticket.data_limit_mb_snapshot === null || ticket.data_limit_mb_snapshot === undefined
          ? null
          : Math.round(ticket.data_limit_mb_snapshot * 1024 * 1024),
        limitUptime: minutesToRouterOsDuration(ticket.duration_minutes_snapshot),
        passwordSecretRef: ticket.password_encrypted,
        planId: ticket.plan_id,
        serverName: ticket.hotspot_server_name ?? "all",
        username: ticket.username,
        validityMinutes: ticket.validity_minutes_snapshot ?? ticket.duration_minutes_snapshot ?? null
      });
    } catch (error) {
      try {
        existing = await this.routerService.findHotspotUser(ticket.username);
      } catch {
        existing = null;
      }
      if (!existing) throw classifyRouterWriteError(error);
    }
    await this.confirmExisting(operation, ticket, existing, expectedProfile);
  }

  private async confirmExisting(
    operation: SyncOutboxRecord,
    ticket: TicketRecord,
    user: HotspotUser,
    expectedProfile: string
  ): Promise<void> {
    if (!voucherBelongsToBatch(user.comment, ticket.batch_id)) {
      throw new SyncOutboxError(
        `Le code ${ticket.username} appartient déjà à un autre lot.`,
        "ROUTER_VOUCHER_OWNERSHIP_CONFLICT",
        "conflict"
      );
    }
    if (user.profileName !== expectedProfile && user.planId !== ticket.plan_id) {
      throw new SyncOutboxError(
        `Le voucher ${ticket.username} existe avec le profil ${user.profileName}.`,
        "ROUTER_VOUCHER_PROFILE_CONFLICT",
        "conflict"
      );
    }
    await this.tickets.update({
      ...ticket,
      hotspot_server_name: user.serverName ?? ticket.hotspot_server_name ?? "all",
      last_router_sync_at: new Date().toISOString(),
      mikrotik_id: user.id,
      mikrotik_profile_name: user.profileName,
      sync_status: "synced"
    });
    // The processor marks the operation succeeded after this handler returns.
    if (operation.status !== "processing") {
      throw new SyncOutboxError("L'opération RouterOS n'est pas verrouillée.", "OUTBOX_NOT_CLAIMED", "conflict");
    }
  }
}

export function buildRouterVoucherCreateOperations(
  accountId: string,
  tickets: CreateTicketInput[]
): EnqueueSyncOperationInput[] {
  return tickets
    .filter((ticket) => ticket.account_id === accountId)
    .map((ticket) => ({
      account_id: accountId,
      aggregate_id: ticket.id,
      aggregate_type: "ticket",
      correlation_id: ticket.batch_id,
      idempotency_key: `routeros:voucher:create:${ticket.router_id}:${ticket.id}`,
      max_attempts: ROUTER_VOUCHER_MAX_ATTEMPTS,
      operation_type: ROUTER_VOUCHER_CREATE_OPERATION,
      payload: { ticketId: ticket.id } satisfies VoucherCreatePayload,
      priority: 20,
      router_id: ticket.router_id
    }));
}

function requireCreatePayload(value: unknown): VoucherCreatePayload {
  if (!value || typeof value !== "object" || typeof (value as VoucherCreatePayload).ticketId !== "string") {
    throw new SyncOutboxError("Charge de création invalide.", "VOUCHER_PAYLOAD_INVALID", "conflict");
  }
  return value as VoucherCreatePayload;
}

function canCreatePendingVoucher(ticket: TicketRecord): boolean {
  return ["disponible", "imprimé", "available", "printed"].includes(ticket.status)
    && !ticket.activated_at
    && !ticket.completed_at
    && !ticket.expires_at
    && !ticket.mikrotik_id
    && !ticket.last_router_sync_at
    && (ticket.uptime_seconds ?? 0) === 0
    && ticket.downloaded_bytes === 0
    && ticket.uploaded_bytes === 0;
}

function classifyRouterWriteError(error: unknown): SyncOutboxError {
  if (error instanceof SyncOutboxError) return error;
  if (error instanceof RouterServiceError) {
    if (["authentication_failed", "hotspot_not_found", "permission_denied"].includes(error.code)) {
      return new SyncOutboxError(error.message, `ROUTER_${error.code.toUpperCase()}`, "permanent");
    }
    if (error.code === "duplicate_user") {
      return new SyncOutboxError(error.message, "ROUTER_DUPLICATE_USER", "retry", 0);
    }
    return new SyncOutboxError(error.message, `ROUTER_${error.code.toUpperCase()}`, "retry");
  }
  return new SyncOutboxError(
    error instanceof Error ? error.message : "Commande RouterOS temporairement impossible.",
    "ROUTER_WRITE_RETRY",
    "retry"
  );
}

function minutesToRouterOsDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const totalSeconds = Math.max(60, Math.round(minutes * 60));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  return [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    remainingMinutes > 0 ? `${remainingMinutes}m` : ""
  ].filter(Boolean).join("") || "1m";
}
