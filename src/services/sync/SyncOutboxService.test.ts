import { describe, expect, it, vi } from "vitest";
import { InMemoryDatabaseClient, SyncOutboxRepository } from "../database";
import { SyncOutboxError, SyncOutboxService } from "./SyncOutboxService";

describe("SyncOutboxService", () => {
  it("confirme une opération exactement une fois", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    await repository.enqueue(operation("once"));
    const handler = vi.fn(async () => undefined);
    const service = new SyncOutboxService(repository).register("test.operation", handler);

    expect((await service.drain({ accountId: "account-1" })).succeeded).toBe(1);
    expect((await service.drain({ accountId: "account-1" })).processed).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reprend une erreur réseau avec backoff sans dupliquer l'opération", async () => {
    let now = new Date("2026-08-28T10:00:00.000Z");
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const record = await repository.enqueue(operation("retry", { next_attempt_at: now.toISOString() }));
    const handler = vi.fn()
      .mockRejectedValueOnce(new SyncOutboxError("Réseau coupé", "NETWORK_OFFLINE", "retry"))
      .mockResolvedValue(undefined);
    const service = new SyncOutboxService(repository, {
      baseRetryMs: 1_000,
      now: () => now
    }).register("test.operation", handler);

    expect((await service.drain({ accountId: "account-1" })).retried).toBe(1);
    expect(await repository.findById(record.id)).toMatchObject({
      attempt_count: 1,
      status: "retry"
    });
    expect((await service.drain({ accountId: "account-1" })).processed).toBe(0);

    now = new Date("2026-08-28T10:00:01.000Z");
    expect((await service.drain({ accountId: "account-1" })).succeeded).toBe(1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect((await repository.listByAccount("account-1"))).toHaveLength(1);
  });

  it("rend un conflit explicite et ne le rejoue pas", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const record = await repository.enqueue(operation("conflict"));
    const service = new SyncOutboxService(repository).register("test.operation", async () => {
      throw new SyncOutboxError("Profil différent sur RouterOS", "ROUTER_PROFILE_CONFLICT", "conflict");
    });

    expect((await service.drain({ accountId: "account-1" })).conflicts).toBe(1);
    expect(await repository.findById(record.id)).toMatchObject({
      last_error_code: "ROUTER_PROFILE_CONFLICT",
      status: "conflict"
    });
    expect((await service.drain({ accountId: "account-1" })).processed).toBe(0);
  });

  it("reprend une opération restée processing après redémarrage", async () => {
    let now = new Date("2026-08-28T10:03:00.000Z");
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const record = await repository.enqueue(operation("stale", {
      next_attempt_at: "2026-08-28T10:00:00.000Z"
    }));
    await repository.claim(record.id, "account-1", "2026-08-28T10:00:00.000Z");
    const handler = vi.fn(async () => undefined);
    const service = new SyncOutboxService(repository, {
      now: () => now,
      staleLockMs: 120_000
    }).register("test.operation", handler);

    const report = await service.drain({ accountId: "account-1" });
    expect(report).toMatchObject({ recovered: 1, succeeded: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    now = new Date("2026-08-28T10:04:00.000Z");
    expect((await service.drain({ accountId: "account-1" })).processed).toBe(0);
  });
});

function operation(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    account_id: "account-1",
    aggregate_id: suffix,
    aggregate_type: "test",
    correlation_id: `correlation-${suffix}`,
    id: `operation-${suffix}`,
    idempotency_key: `test:${suffix}`,
    max_attempts: 3,
    operation_type: "test.operation",
    payload: { value: suffix },
    priority: 100,
    router_id: "router-1",
    ...overrides
  } as Parameters<SyncOutboxRepository["enqueue"]>[0];
}
