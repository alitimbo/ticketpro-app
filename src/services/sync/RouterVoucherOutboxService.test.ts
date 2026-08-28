import { describe, expect, it, vi } from "vitest";
import type { CreateTicketInput } from "../../domain/database";
import type { HotspotUser, HotspotUserDraft } from "../../domain/router";
import {
  HotspotPlanRepository,
  InMemoryDatabaseClient,
  SyncOutboxRepository,
  TicketBatchRepository,
  TicketRepository
} from "../database";
import { RouterServiceError } from "../router";
import { RouterVoucherOutboxService } from "./RouterVoucherOutboxService";

describe("RouterVoucherOutboxService", () => {
  it("crée chaque voucher une seule fois puis confirme la base locale", async () => {
    const context = await setup([ticket("ticket-1", "100001")]);
    const users: HotspotUser[] = [];
    const createHotspotUser = vi.fn(async (draft: HotspotUserDraft) => {
      const user = routerUser(draft, "*1");
      users.push(user);
      return user;
    });
    const service = new RouterVoucherOutboxService(context.database, "account-1", {
      createHotspotUser,
      findHotspotUser: async (username) => users.find((user) => user.username === username) ?? null
    });
    await service.enqueueTickets(context.inputs);

    expect(await service.resume("router-1")).toMatchObject({ succeeded: 1 });
    expect(await service.resume("router-1")).toMatchObject({ processed: 0 });
    expect(createHotspotUser).toHaveBeenCalledTimes(1);
    expect(await context.tickets.findById("ticket-1")).toMatchObject({
      last_router_sync_at: expect.any(String),
      mikrotik_id: "*1",
      sync_status: "synced"
    });
  });

  it("réconcilie un timeout survenu après la création RouterOS sans recréer", async () => {
    const context = await setup([ticket("ticket-timeout", "100002")]);
    const users: HotspotUser[] = [];
    const createHotspotUser = vi.fn(async (draft: HotspotUserDraft) => {
      users.push(routerUser(draft, "*timeout"));
      throw new RouterServiceError("timeout", "Le routeur ne répond plus.");
    });
    const service = new RouterVoucherOutboxService(context.database, "account-1", {
      createHotspotUser,
      findHotspotUser: async (username) => users.find((user) => user.username === username) ?? null
    });
    await service.enqueueTickets(context.inputs);

    expect(await service.resume("router-1")).toMatchObject({ succeeded: 1 });
    expect(createHotspotUser).toHaveBeenCalledTimes(1);
    expect(users).toHaveLength(1);
    expect(await context.tickets.findById("ticket-timeout")).toMatchObject({
      mikrotik_id: "*timeout",
      sync_status: "synced"
    });
  });

  it("refuse définitivement de recréer un voucher déjà activé", async () => {
    const used = {
      ...ticket("ticket-used", "100003"),
      activated_at: "2026-08-28T09:00:00.000Z",
      status: "activé",
      uptime_seconds: 60
    };
    const context = await setup([used]);
    const createHotspotUser = vi.fn(async (draft: HotspotUserDraft) => routerUser(draft, "*used"));
    const service = new RouterVoucherOutboxService(context.database, "account-1", {
      createHotspotUser,
      findHotspotUser: async () => null
    });
    const operations = await service.enqueueTickets(context.inputs);

    expect(await service.resume("router-1")).toMatchObject({ conflicts: 1 });
    expect(createHotspotUser).not.toHaveBeenCalled();
    expect(await new SyncOutboxRepository(context.database).findById(
      operations.get("ticket-used")!.id
    )).toMatchObject({
      last_error_code: "VOUCHER_RECREATION_REFUSED",
      status: "conflict"
    });
  });

  it("refuse d'adopter le voucher créé simultanément par un autre opérateur", async () => {
    const context = await setup([ticket("ticket-collision", "100004")]);
    const foreignUser: HotspotUser = {
      ...routerUser({
        comment: "TicketProBatch:other-batch",
        passwordSecretRef: "secret://foreign",
        planId: "plan-1",
        username: "100004"
      }, "*foreign"),
      profileName: "plan-profile"
    };
    const createHotspotUser = vi.fn();
    const service = new RouterVoucherOutboxService(context.database, "account-1", {
      createHotspotUser,
      findHotspotUser: async () => foreignUser
    });
    const operations = await service.enqueueTickets(context.inputs);

    expect(await service.resume("router-1")).toMatchObject({ conflicts: 1 });
    expect(createHotspotUser).not.toHaveBeenCalled();
    expect(await new SyncOutboxRepository(context.database).findById(
      operations.get("ticket-collision")!.id
    )).toMatchObject({
      last_error_code: "ROUTER_VOUCHER_OWNERSHIP_CONFLICT",
      status: "conflict"
    });
  });

  it("reprend uniquement le voucher échoué d'un lot partiel", async () => {
    const context = await setup([
      ticket("ticket-a", "200001"),
      ticket("ticket-b", "200002"),
      ticket("ticket-c", "200003")
    ]);
    const users: HotspotUser[] = [];
    let failSecond = true;
    const createHotspotUser = vi.fn(async (draft: HotspotUserDraft) => {
      if (draft.username === "200002" && failSecond) {
        throw new RouterServiceError("timeout", "Coupure injectée.");
      }
      const user = routerUser(draft, `*${draft.username}`);
      users.push(user);
      return user;
    });
    const service = new RouterVoucherOutboxService(context.database, "account-1", {
      createHotspotUser,
      findHotspotUser: async (username) => users.find((user) => user.username === username) ?? null
    });
    const operations = await service.enqueueTickets(context.inputs);

    expect(await service.resume("router-1")).toMatchObject({ succeeded: 2, retried: 1 });
    failSecond = false;
    const secondOperation = operations.get("ticket-b")!;
    await new SyncOutboxRepository(context.database).markRetry(secondOperation.id, "account-1", {
      code: "LAB_RETRY",
      message: "Relance laboratoire",
      nextAttemptAt: "2026-01-01T00:00:00.000Z"
    });
    expect(await service.resume("router-1")).toMatchObject({ succeeded: 1 });

    expect(createHotspotUser.mock.calls.map(([draft]) => draft.username)).toEqual([
      "200001",
      "200002",
      "200003",
      "200002"
    ]);
    expect(users.map((user) => user.username).sort()).toEqual(["200001", "200002", "200003"]);
  });
});

async function setup(inputs: CreateTicketInput[]) {
  const database = new InMemoryDatabaseClient();
  const plans = new HotspotPlanRepository(database);
  const batches = new TicketBatchRepository(database);
  const tickets = new TicketRepository(database);
  await plans.create({
    created_by_profile_id: "account-1:profile-admin",
    currency: "CFA",
    data_limit_mb: null,
    download_limit: "5M",
    duration_minutes: 60,
    id: "plan-1",
    mikrotik_id: "*P1",
    mikrotik_profile_name: "plan-profile",
    name: "Plan test",
    price_hint: 100,
    router_id: "router-1",
    shared_users: 1,
    status: "active",
    upload_limit: "2M",
    validity_minutes: 180
  }, { actorProfileId: "account-1:profile-admin", source: "sprint-4-test" });
  await batches.createWithTickets({
    account_id: "account-1",
    code_length: 6,
    currency: "CFA",
    created_by_profile: "operator",
    created_by_profile_id: "account-1:profile-operator",
    generated_file_id: null,
    id: "batch-1",
    operator_profile: "operator",
    plan_id: "plan-1",
    price_snapshot: 100,
    prefix: null,
    quantity: inputs.length,
    router_id: "router-1",
    status: "terminé",
    sync_status: "pending"
  }, inputs);
  return { database, inputs, tickets };
}

function ticket(id: string, username: string): CreateTicketInput {
  return {
    account_id: "account-1",
    activated_at: null,
    batch_id: "batch-1",
    completed_at: null,
    created_by_profile: "operator",
    created_by_profile_id: "account-1:profile-operator",
    data_limit_mb_snapshot: null,
    data_remaining_bytes: null,
    deleted_at: null,
    downloaded_bytes: 0,
    download_limit_snapshot: "5M",
    duration_minutes_snapshot: 60,
    expires_at: null,
    id,
    ip_address: null,
    last_router_sync_at: null,
    mac_address: null,
    mikrotik_id: null,
    mikrotik_profile_name: "plan-profile",
    password_encrypted: `secret://router-1/${username}/password`,
    plan_id: "plan-1",
    printed_count: 0,
    remaining_seconds: 3600,
    router_id: "router-1",
    shared_users_snapshot: 1,
    status: "disponible",
    sync_status: "pending",
    uploaded_bytes: 0,
    upload_limit_snapshot: "2M",
    uptime_seconds: 0,
    username,
    validity_minutes_snapshot: 180
  };
}

function routerUser(draft: HotspotUserDraft, id: string): HotspotUser {
  return {
    comment: draft.comment ?? null,
    createdAt: "2026-08-28T10:00:00.000Z",
    id,
    passwordSecretRef: draft.passwordSecretRef,
    planId: draft.planId,
    profileName: "plan-profile",
    serverName: draft.serverName,
    status: "available",
    username: draft.username
  };
}
