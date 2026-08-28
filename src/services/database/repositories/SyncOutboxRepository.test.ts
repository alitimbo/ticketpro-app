import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { SyncOutboxRepository } from "./SyncOutboxRepository";

describe("SyncOutboxRepository", () => {
  it("enregistre une seule opération pour une même clé d'idempotence", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const first = await repository.enqueue(operation({ id: "op-1" }));
    const duplicate = await repository.enqueue(operation({ id: "op-2" }));

    expect(duplicate.id).toBe(first.id);
    expect((await repository.listByAccount("account-1"))).toHaveLength(1);
  });

  it("enregistre un lot important sans dupliquer les clés lors d'une reprise", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const inputs = Array.from({ length: 1_000 }, (_, index) => operation({
      aggregate_id: `ticket-${index}`,
      id: `bulk-${index}`,
      idempotency_key: `routeros:create:bulk-${index}`,
      payload: { ticketId: `ticket-${index}` }
    }));

    const first = await repository.enqueueMany(inputs);
    const resumed = await repository.enqueueMany(inputs.map((input) => ({
      ...input,
      id: `retry-${input.id}`
    })));

    expect(first).toHaveLength(1_000);
    expect(resumed.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(await repository.listByAccount("account-1")).toHaveLength(1_000);
  });

  it("refuse les secrets dans la charge durable", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    await expect(repository.enqueue(operation({
      id: "secret-op",
      payload: { private_key: "interdit" }
    }))).rejects.toThrow("OUTBOX_SECRET_REFUSED");

    await expect(repository.enqueue(operation({
      id: "reference-op",
      idempotency_key: "routeros:create:ticket-2",
      payload: { passwordSecretRef: "ticket-secret://ticket-2" }
    }))).resolves.toMatchObject({ aggregate_id: "ticket-1" });
  });

  it("récupère un verrou abandonné après un arrêt brutal", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    const created = await repository.enqueue(operation({ id: "stale-op" }));
    await repository.claim(created.id, "account-1", "2026-08-28T10:00:00.000Z");

    expect(await repository.recoverStale(
      "account-1",
      "2026-08-28T10:01:00.000Z",
      "2026-08-28T10:02:00.000Z"
    )).toBe(1);
    expect(await repository.findById(created.id)).toMatchObject({
      last_error_code: "STALE_PROCESS_RECOVERED",
      locked_at: null,
      status: "retry"
    });
  });

  it("expose l'état de santé et l'opération la plus ancienne", async () => {
    const repository = new SyncOutboxRepository(new InMemoryDatabaseClient());
    await repository.enqueue(operation({
      created_at: "2026-08-28T09:00:00.000Z",
      id: "health-1",
      idempotency_key: "routeros:create:health-1"
    }));
    const second = await repository.enqueue(operation({
      created_at: "2026-08-28T09:01:00.000Z",
      id: "health-2",
      idempotency_key: "routeros:create:health-2"
    }));
    await repository.markSucceeded(second.id, "account-1", "2026-08-28T09:02:00.000Z");

    expect(await repository.health("account-1")).toEqual({
      conflict: 0,
      failed: 0,
      oldestPendingAt: "2026-08-28T09:00:00.000Z",
      pending: 1,
      processing: 0,
      retry: 0,
      succeeded: 1,
      total: 2
    });
  });
});

function operation(overrides: Record<string, unknown> = {}) {
  return {
    account_id: "account-1",
    aggregate_id: "ticket-1",
    aggregate_type: "ticket",
    correlation_id: "batch-1",
    id: "op-1",
    idempotency_key: "routeros:create:ticket-1",
    max_attempts: 3,
    operation_type: "routeros.voucher.create",
    payload: { ticketId: "ticket-1" },
    priority: 10,
    router_id: "router-1",
    ...overrides
  } as Parameters<SyncOutboxRepository["enqueue"]>[0];
}
