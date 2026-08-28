import type {
  CreateSyncOutboxInput,
  SyncOutboxRecord,
  SyncOutboxStatus
} from "../../../domain/database";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";

export type EnqueueSyncOperationInput = Omit<
  CreateSyncOutboxInput,
  "id" | "payload_json"
> & {
  id?: string;
  payload: unknown;
};

export type SyncOutboxHealth = {
  conflict: number;
  failed: number;
  oldestPendingAt: string | null;
  pending: number;
  processing: number;
  retry: number;
  succeeded: number;
  total: number;
};

const nonTerminalStatuses = new Set<SyncOutboxStatus>(["pending", "processing", "retry"]);

/**
 * Durable local queue for operations that cross a process or network boundary.
 * Payloads are immutable and secret-free. Retrying the same idempotency key
 * always returns the original operation instead of creating a duplicate.
 */
export class SyncOutboxRepository {
  constructor(private readonly database: DatabaseClient) {}

  async enqueue(input: EnqueueSyncOperationInput): Promise<SyncOutboxRecord> {
    assertSecretFreePayload(input.payload);
    const existing = await this.findByIdempotencyKey(input.account_id, input.idempotency_key);
    if (existing) return existing;

    const now = input.created_at ?? new Date().toISOString();
    const id = input.id ?? createOutboxId(input.idempotency_key);
    const payloadJson = JSON.stringify(input.payload);
    try {
      await this.database.execute(
        `INSERT INTO sync_outbox (
          id, account_id, router_id, operation_type, aggregate_type, aggregate_id,
          idempotency_key, correlation_id, payload_json, status, priority,
          attempt_count, max_attempts, next_attempt_at, locked_at, last_attempt_at,
          completed_at, last_error_code, last_error_message, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
        [
          id,
          input.account_id,
          input.router_id,
          input.operation_type,
          input.aggregate_type,
          input.aggregate_id,
          input.idempotency_key,
          input.correlation_id,
          payloadJson,
          input.status ?? "pending",
          input.priority ?? 100,
          0,
          input.max_attempts ?? 8,
          input.next_attempt_at ?? now,
          null,
          null,
          null,
          null,
          null,
          now,
          input.updated_at ?? now
        ]
      );
    } catch (error) {
      // A second window may have inserted the same key between the read and
      // write. SQLite uniqueness is the final idempotency guard.
      const concurrentlyCreated = await this.findByIdempotencyKey(
        input.account_id,
        input.idempotency_key
      );
      if (concurrentlyCreated) return concurrentlyCreated;
      throw error;
    }

    const created = await this.findById(id);
    if (!created) throw new Error("L'opération de synchronisation n'a pas pu être enregistrée.");
    return created;
  }

  /**
   * Enregistre un grand lot sans relire toute la file pour chaque opération.
   * Les lectures sont faites une fois par compte et les écritures par
   * transactions bornées afin de ne pas saturer l'IPC Tauri.
   */
  async enqueueMany(inputs: EnqueueSyncOperationInput[]): Promise<SyncOutboxRecord[]> {
    if (inputs.length === 0) return [];
    inputs.forEach((input) => assertSecretFreePayload(input.payload));

    const accountIds = [...new Set(inputs.map((input) => input.account_id))];
    const compositeKey = (accountId: string, idempotencyKey: string) => `${accountId}\u0000${idempotencyKey}`;
    const recordsByKey = new Map<string, SyncOutboxRecord>();
    for (const accountId of accountIds) {
      const records = await this.listByAccount(accountId);
      records.forEach((record) => {
        recordsByKey.set(compositeKey(record.account_id, record.idempotency_key), record);
      });
    }

    const missingByKey = new Map<string, EnqueueSyncOperationInput>();
    for (const input of inputs) {
      const key = compositeKey(input.account_id, input.idempotency_key);
      if (!recordsByKey.has(key) && !missingByKey.has(key)) missingByKey.set(key, input);
    }

    const missing = [...missingByKey.values()];
    for (let offset = 0; offset < missing.length; offset += OUTBOX_ENQUEUE_CHUNK_SIZE) {
      const chunk = missing.slice(offset, offset + OUTBOX_ENQUEUE_CHUNK_SIZE);
      try {
        await this.database.transaction(chunk.map(buildEnqueueStatement));
      } catch {
        // Une autre fenêtre peut gagner la course sur une clé UNIQUE. Le
        // chemin unitaire conserve alors la garantie d'idempotence finale.
        for (const input of chunk) await this.enqueue(input);
      }
    }

    recordsByKey.clear();
    for (const accountId of accountIds) {
      const records = await this.listByAccount(accountId);
      records.forEach((record) => {
        recordsByKey.set(compositeKey(record.account_id, record.idempotency_key), record);
      });
    }

    return inputs.map((input) => {
      const record = recordsByKey.get(compositeKey(input.account_id, input.idempotency_key));
      if (!record) {
        throw new Error("L'opération de synchronisation en lot n'a pas pu être enregistrée.");
      }
      return record;
    });
  }

  async findById(id: string): Promise<SyncOutboxRecord | null> {
    const rows = await this.database.query<SyncOutboxRecord>(
      "SELECT * FROM sync_outbox WHERE id = ?1",
      [id]
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(
    accountId: string,
    idempotencyKey: string
  ): Promise<SyncOutboxRecord | null> {
    const records = await this.database.query<SyncOutboxRecord>(
      `SELECT * FROM sync_outbox
       WHERE account_id = ?1 AND idempotency_key = ?2
       LIMIT 1`,
      [accountId, idempotencyKey]
    );
    return records[0] ?? null;
  }

  async listByAccount(accountId: string): Promise<SyncOutboxRecord[]> {
    return this.database.query<SyncOutboxRecord>(
      "SELECT * FROM sync_outbox WHERE account_id = ?1 ORDER BY created_at ASC",
      [accountId]
    );
  }

  async listReady(input: {
    accountId: string;
    limit?: number;
    now?: string;
    operationTypes?: string[];
    routerId?: string;
  }): Promise<SyncOutboxRecord[]> {
    const now = Date.parse(input.now ?? new Date().toISOString());
    const operationTypes = input.operationTypes ? new Set(input.operationTypes) : null;
    return (await this.listByAccount(input.accountId))
      .filter((record) => record.status === "pending" || record.status === "retry")
      .filter((record) => !input.routerId || record.router_id === input.routerId)
      .filter((record) => !operationTypes || operationTypes.has(record.operation_type))
      .filter((record) => {
        const dueAt = Date.parse(record.next_attempt_at);
        return !Number.isFinite(dueAt) || dueAt <= now;
      })
      .sort((left, right) => left.priority - right.priority
        || left.created_at.localeCompare(right.created_at))
      .slice(0, input.limit ?? 50);
  }

  async claim(id: string, accountId: string, now = new Date().toISOString()): Promise<SyncOutboxRecord | null> {
    const current = await this.findById(id);
    if (!current || current.account_id !== accountId || !nonTerminalStatuses.has(current.status)) return null;
    if (current.status === "processing") return null;
    await this.database.execute(
      `UPDATE sync_outbox SET
        status = ?1, attempt_count = ?2, locked_at = ?3, last_attempt_at = ?4,
        last_error_code = ?5, last_error_message = ?6, updated_at = ?7
      WHERE id = ?8 AND account_id = ?9`,
      ["processing", current.attempt_count + 1, now, now, null, null, now, id, accountId]
    );
    return this.findById(id);
  }

  async markSucceeded(id: string, accountId: string, now = new Date().toISOString()): Promise<void> {
    await this.updateState(id, accountId, {
      completedAt: now,
      errorCode: null,
      errorMessage: null,
      lockedAt: null,
      nextAttemptAt: now,
      status: "succeeded",
      updatedAt: now
    });
  }

  async markConflict(
    id: string,
    accountId: string,
    code: string,
    message: string,
    now = new Date().toISOString()
  ): Promise<void> {
    await this.updateState(id, accountId, {
      completedAt: now,
      errorCode: code,
      errorMessage: sanitizeOutboxError(message),
      lockedAt: null,
      nextAttemptAt: now,
      status: "conflict",
      updatedAt: now
    });
  }

  async markFailed(
    id: string,
    accountId: string,
    code: string,
    message: string,
    now = new Date().toISOString()
  ): Promise<void> {
    await this.updateState(id, accountId, {
      completedAt: now,
      errorCode: code,
      errorMessage: sanitizeOutboxError(message),
      lockedAt: null,
      nextAttemptAt: now,
      status: "failed",
      updatedAt: now
    });
  }

  async markRetry(
    id: string,
    accountId: string,
    input: { code: string; message: string; nextAttemptAt: string },
    now = new Date().toISOString()
  ): Promise<SyncOutboxStatus> {
    const current = await this.findById(id);
    if (!current || current.account_id !== accountId) return "failed";
    if (!nonTerminalStatuses.has(current.status)) return current.status;
    const status: SyncOutboxStatus = current.attempt_count >= current.max_attempts ? "failed" : "retry";
    await this.updateState(id, accountId, {
      completedAt: status === "failed" ? now : null,
      errorCode: input.code,
      errorMessage: sanitizeOutboxError(input.message),
      lockedAt: null,
      nextAttemptAt: input.nextAttemptAt,
      status,
      updatedAt: now
    });
    return status;
  }

  async recoverStale(
    accountId: string,
    staleBefore: string,
    now = new Date().toISOString()
  ): Promise<number> {
    const threshold = Date.parse(staleBefore);
    const stale = (await this.listByAccount(accountId)).filter((record) => {
      if (record.status !== "processing" || !record.locked_at) return false;
      const lockedAt = Date.parse(record.locked_at);
      return Number.isFinite(lockedAt) && lockedAt <= threshold;
    });
    for (const record of stale) {
      await this.updateState(record.id, accountId, {
        completedAt: null,
        errorCode: "STALE_PROCESS_RECOVERED",
        errorMessage: "Opération reprise après interruption de TicketPro.",
        lockedAt: null,
        nextAttemptAt: now,
        status: "retry",
        updatedAt: now
      });
    }
    return stale.length;
  }

  async health(accountId: string, routerId?: string): Promise<SyncOutboxHealth> {
    const records = (await this.listByAccount(accountId))
      .filter((record) => !routerId || record.router_id === routerId);
    const count = (status: SyncOutboxStatus) => records.filter((record) => record.status === status).length;
    const pendingRecords = records.filter((record) => nonTerminalStatuses.has(record.status));
    return {
      conflict: count("conflict"),
      failed: count("failed"),
      oldestPendingAt: pendingRecords.sort((left, right) => left.created_at.localeCompare(right.created_at))[0]?.created_at ?? null,
      pending: count("pending"),
      processing: count("processing"),
      retry: count("retry"),
      succeeded: count("succeeded"),
      total: records.length
    };
  }

  private async updateState(
    id: string,
    accountId: string,
    input: {
      completedAt: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      lockedAt: string | null;
      nextAttemptAt: string;
      status: SyncOutboxStatus;
      updatedAt: string;
    }
  ): Promise<void> {
    await this.database.execute(
      `UPDATE sync_outbox SET
        status = ?1, next_attempt_at = ?2, locked_at = ?3, completed_at = ?4,
        last_error_code = ?5, last_error_message = ?6, updated_at = ?7
      WHERE id = ?8 AND account_id = ?9`,
      [
        input.status,
        input.nextAttemptAt,
        input.lockedAt,
        input.completedAt,
        input.errorCode,
        input.errorMessage,
        input.updatedAt,
        id,
        accountId
      ]
    );
  }
}

const OUTBOX_ENQUEUE_CHUNK_SIZE = 500;

function buildEnqueueStatement(input: EnqueueSyncOperationInput): DatabaseStatement {
  const now = input.created_at ?? new Date().toISOString();
  const id = input.id ?? createOutboxId(input.idempotency_key);
  return {
    params: [
      id,
      input.account_id,
      input.router_id,
      input.operation_type,
      input.aggregate_type,
      input.aggregate_id,
      input.idempotency_key,
      input.correlation_id,
      JSON.stringify(input.payload),
      input.status ?? "pending",
      input.priority ?? 100,
      0,
      input.max_attempts ?? 8,
      input.next_attempt_at ?? now,
      null,
      null,
      null,
      null,
      null,
      now,
      input.updated_at ?? now
    ],
    sql: `INSERT INTO sync_outbox (
      id, account_id, router_id, operation_type, aggregate_type, aggregate_id,
      idempotency_key, correlation_id, payload_json, status, priority,
      attempt_count, max_attempts, next_attempt_at, locked_at, last_attempt_at,
      completed_at, last_error_code, last_error_message, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`
  };
}

export function parseOutboxPayload<T>(record: SyncOutboxRecord): T {
  return JSON.parse(record.payload_json) as T;
}

export function assertSecretFreePayload(payload: unknown): void {
  visitPayload(payload, []);
}

function visitPayload(value: unknown, path: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPayload(item, [...path, String(index)]));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    const referenceOnly = normalized.endsWith("secretref") || normalized === "passwordisusername";
    const forbidden = normalized.includes("privatekey")
      || normalized.includes("presharedkey")
      || normalized.includes("accesstoken")
      || normalized.includes("refreshtoken")
      || normalized.includes("activationtoken")
      || normalized === "password"
      || normalized === "passwordencrypted";
    if (forbidden && !referenceOnly && child !== null && child !== undefined && child !== "") {
      throw new Error(`OUTBOX_SECRET_REFUSED:${[...path, key].join(".")}`);
    }
    visitPayload(child, [...path, key]);
  });
}

function sanitizeOutboxError(message: string): string {
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function createOutboxId(idempotencyKey: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `outbox-${randomId}`;
  return `outbox-${stableHash(`${idempotencyKey}:${Date.now()}:${Math.random()}`)}`;
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
