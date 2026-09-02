import type { SyncOutboxRecord } from "../../domain/database";
import {
  SyncOutboxRepository,
  parseOutboxPayload,
  type SyncOutboxHealth
} from "../database";
import { recordActiveOutboxRetry } from "../performance/VoucherGenerationPerformance";

export type SyncOutboxHandler = (
  operation: SyncOutboxRecord,
  payload: unknown
) => Promise<void>;

export type SyncOutboxDrainReport = {
  conflicts: number;
  failed: number;
  processed: number;
  recovered: number;
  retried: number;
  succeeded: number;
};

export class SyncOutboxError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly kind: "conflict" | "permanent" | "retry",
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

export class SyncOutboxService {
  private readonly handlers = new Map<string, SyncOutboxHandler>();

  constructor(
    private readonly outbox: SyncOutboxRepository,
    private readonly options: {
      baseRetryMs?: number;
      maxRetryMs?: number;
      now?: () => Date;
      staleLockMs?: number;
      stopOnRetry?: boolean;
    } = {}
  ) {}

  register(operationType: string, handler: SyncOutboxHandler): this {
    this.handlers.set(operationType, handler);
    return this;
  }

  async drain(input: {
    accountId: string;
    limit?: number;
    operationTypes?: string[];
    routerId?: string;
  }): Promise<SyncOutboxDrainReport> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - (this.options.staleLockMs ?? 120_000)).toISOString();
    const recovered = await this.outbox.recoverStale(input.accountId, staleBefore, now.toISOString());
    const ready = await this.outbox.listReady({
      accountId: input.accountId,
      limit: input.limit,
      now: now.toISOString(),
      operationTypes: input.operationTypes,
      routerId: input.routerId
    });
    const report: SyncOutboxDrainReport = {
      conflicts: 0,
      failed: 0,
      processed: 0,
      recovered,
      retried: 0,
      succeeded: 0
    };

    for (const candidate of ready) {
      const claimed = await this.outbox.claim(candidate.id, input.accountId, this.now().toISOString());
      if (!claimed) continue;
      report.processed += 1;
      const handler = this.handlers.get(claimed.operation_type);
      if (!handler) {
        await this.outbox.markConflict(
          claimed.id,
          input.accountId,
          "OUTBOX_HANDLER_MISSING",
          `Aucun gestionnaire n'est enregistré pour ${claimed.operation_type}.`,
          this.now().toISOString()
        );
        report.conflicts += 1;
        continue;
      }

      try {
        await handler(claimed, parseOutboxPayload(claimed));
        await this.outbox.markSucceeded(claimed.id, input.accountId, this.now().toISOString());
        report.succeeded += 1;
      } catch (error) {
        const classified = classifyOutboxError(error);
        if (classified.kind === "conflict") {
          await this.outbox.markConflict(
            claimed.id,
            input.accountId,
            classified.code,
            classified.message,
            this.now().toISOString()
          );
          report.conflicts += 1;
          continue;
        }
        if (classified.kind === "permanent") {
          await this.outbox.markFailed(
            claimed.id,
            input.accountId,
            classified.code,
            classified.message,
            this.now().toISOString()
          );
          report.failed += 1;
          continue;
        }
        const delay = classified.retryAfterMs ?? this.retryDelay(claimed.attempt_count);
        const nextAttemptAt = new Date(this.now().getTime() + delay).toISOString();
        const status = await this.outbox.markRetry(claimed.id, input.accountId, {
          code: classified.code,
          message: classified.message,
          nextAttemptAt
        }, this.now().toISOString());
        if (status === "failed") report.failed += 1;
        else {
          report.retried += 1;
          recordActiveOutboxRetry();
        }
        if (this.options.stopOnRetry) break;
      }
    }

    return report;
  }

  health(accountId: string, routerId?: string): Promise<SyncOutboxHealth> {
    return this.outbox.health(accountId, routerId);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private retryDelay(attemptCount: number): number {
    const base = this.options.baseRetryMs ?? 2_000;
    const maximum = this.options.maxRetryMs ?? 5 * 60_000;
    return Math.min(maximum, base * 2 ** Math.max(0, attemptCount - 1));
  }
}

function classifyOutboxError(error: unknown): SyncOutboxError {
  if (error instanceof SyncOutboxError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SyncOutboxError(message || "Échec temporaire de synchronisation.", "OUTBOX_RETRY", "retry");
}
