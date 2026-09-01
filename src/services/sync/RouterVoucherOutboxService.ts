import type { CreateTicketInput, SyncOutboxRecord, TicketRecord } from "../../domain/database";
import type { HotspotUser } from "../../domain/router";
import {
  HotspotPlanRepository,
  SyncOutboxRepository,
  TicketRepository,
  type DatabaseClient
} from "../database";
import { RouterServiceError, type RouterService } from "../router";
import { buildVoucherBatchOwnershipComment, voucherBelongsToBatch } from "../tickets";
import { SyncOutboxError, SyncOutboxService, type SyncOutboxDrainReport } from "./SyncOutboxService";

export const ROUTER_VOUCHER_CREATE_OPERATION = "routeros.voucher.create";

type VoucherCreatePayload = { ticketId: string };

export class RouterVoucherOutboxService {
  private readonly outbox: SyncOutboxRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly processor: SyncOutboxService;
  private readonly tickets: TicketRepository;

  constructor(
    database: DatabaseClient,
    private readonly accountId: string,
    private readonly routerService: Pick<RouterService, "createHotspotUser" | "findHotspotUser">
  ) {
    this.outbox = new SyncOutboxRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.tickets = new TicketRepository(database);
    this.processor = new SyncOutboxService(this.outbox).register(
      ROUTER_VOUCHER_CREATE_OPERATION,
      (operation, payload) => this.processCreate(operation, requireCreatePayload(payload))
    );
  }

  async enqueueTickets(tickets: CreateTicketInput[]): Promise<Map<string, SyncOutboxRecord>> {
    const operations = new Map<string, SyncOutboxRecord>();
    const eligibleTickets = tickets.filter((ticket) => ticket.account_id === this.accountId);
    const queued = await this.outbox.enqueueMany(eligibleTickets.map((ticket) => ({
        account_id: this.accountId,
        aggregate_id: ticket.id,
        aggregate_type: "ticket",
        correlation_id: ticket.batch_id,
        idempotency_key: `routeros:voucher:create:${ticket.router_id}:${ticket.id}`,
        max_attempts: 8,
        operation_type: ROUTER_VOUCHER_CREATE_OPERATION,
        payload: { ticketId: ticket.id } satisfies VoucherCreatePayload,
        priority: 20,
        router_id: ticket.router_id
      })));
    eligibleTickets.forEach((ticket, index) => operations.set(ticket.id, queued[index]));
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
    await this.outbox.markRetry(operationId, this.accountId, {
      code: classified.code,
      message: classified.message,
      nextAttemptAt: new Date(Date.now() + 2_000).toISOString()
    });
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
  }

  async resume(routerId: string): Promise<SyncOutboxDrainReport> {
    return this.processor.drain({
      accountId: this.accountId,
      limit: 100,
      operationTypes: [ROUTER_VOUCHER_CREATE_OPERATION],
      routerId
    });
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
