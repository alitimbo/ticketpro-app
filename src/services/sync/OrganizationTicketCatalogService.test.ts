import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTicketInput } from "../../domain/database";
import {
  HotspotPlanRepository,
  InMemoryDatabaseClient,
  RouterRepository,
  SyncOutboxRepository,
  TicketBatchRepository
} from "../database";
import { OrganizationTicketCatalogService } from "./OrganizationTicketCatalogService";

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  saveCatalog: vi.fn()
}));

vi.mock("../saas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../saas")>();
  return {
    ...actual,
    getSaasRouterTicketCatalog: mocks.getCatalog,
    saveSaasRouterTicketCatalog: mocks.saveCatalog
  };
});

describe("OrganizationTicketCatalogService outbox", () => {
  beforeEach(() => {
    mocks.getCatalog.mockReset();
    mocks.saveCatalog.mockReset();
  });

  it("reprend uniquement le fragment cloud échoué d'un grand lot", async () => {
    const database = await setupCatalog(81);
    mocks.saveCatalog
      .mockResolvedValueOnce({ batches: [], router_id: "cloud-router-1", tickets: [] })
      .mockRejectedValueOnce(new Error("Coupure réseau injectée"))
      .mockResolvedValue({ batches: [], router_id: "cloud-router-1", tickets: [] });
    const service = new OrganizationTicketCatalogService(
      database,
      "account-1",
      "account-1:profile-operator",
      "operator"
    );

    await expect(service.publishBatch("router-1", "batch-cloud"))
      .rejects.toThrow("conservée(s) dans la file de reprise");
    const outbox = new SyncOutboxRepository(database);
    const firstPass = await outbox.listByAccount("account-1");
    expect(firstPass.map((operation) => operation.status).sort()).toEqual([
      "retry",
      "succeeded",
      "succeeded"
    ]);
    const retry = firstPass.find((operation) => operation.status === "retry")!;
    await outbox.markRetry(retry.id, "account-1", {
      code: "LAB_RETRY",
      message: "Reprise laboratoire",
      nextAttemptAt: "2026-01-01T00:00:00.000Z"
    });

    expect(await service.resumePending("router-1")).toMatchObject({ succeeded: 1 });
    expect(mocks.saveCatalog.mock.calls.map(([payload]) => payload.tickets.length)).toEqual([
      40,
      40,
      1,
      40
    ]);
    expect((await outbox.listByAccount("account-1"))
      .every((operation) => operation.status === "succeeded")).toBe(true);
  });
});

async function setupCatalog(quantity: number) {
  const database = new InMemoryDatabaseClient();
  await new RouterRepository(database).create({
    account_id: "account-1",
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: "hAP",
    cloud_router_id: "cloud-router-1",
    connection_mode: "vpn",
    created_by_profile_id: "account-1:profile-admin",
    encrypted_password: "secret://router-1/credential",
    id: "router-1",
    label: "Lab",
    last_seen_at: "2026-08-28T10:00:00.000Z",
    local_ip: "192.168.88.1",
    model: "MikroTik",
    name: "TicketPro Lab",
    routeros_version: "7.21.5",
    serial_number: "LAB-1",
    status: "active",
    username: "ticketpro-api",
    zone_id: null
  });
  await new HotspotPlanRepository(database).create({
    created_by_profile_id: "account-1:profile-admin",
    currency: "CFA",
    data_limit_mb: null,
    download_limit: "5M",
    duration_minutes: 60,
    id: "plan-cloud",
    mikrotik_id: "*P1",
    mikrotik_profile_name: "plan-cloud",
    name: "Plan Cloud",
    price_hint: 100,
    router_id: "router-1",
    shared_users: 1,
    status: "active",
    upload_limit: "2M",
    validity_minutes: 180
  }, { actorProfileId: "account-1:profile-admin", source: "sprint-4-test" });
  const tickets = Array.from({ length: quantity }, (_, index) => cloudTicket(index));
  await new TicketBatchRepository(database).createWithTickets({
    account_id: "account-1",
    code_length: 6,
    currency: "CFA",
    created_by_profile: "operator",
    created_by_profile_id: "account-1:profile-operator",
    generated_file_id: null,
    id: "batch-cloud",
    operator_profile: "operator",
    plan_id: "plan-cloud",
    price_snapshot: 100,
    prefix: null,
    quantity,
    router_id: "router-1",
    status: "terminé",
    sync_status: "synced"
  }, tickets);
  return database;
}

function cloudTicket(index: number): CreateTicketInput {
  const code = String(300000 + index);
  return {
    account_id: "account-1",
    activated_at: null,
    batch_id: "batch-cloud",
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
    id: `ticket-cloud-${index}`,
    ip_address: null,
    last_router_sync_at: "2026-08-28T10:00:00.000Z",
    mac_address: null,
    mikrotik_id: `*${index}`,
    mikrotik_profile_name: "plan-cloud",
    password_encrypted: `secret://router-1/${code}/password`,
    plan_id: "plan-cloud",
    printed_count: 0,
    remaining_seconds: 3600,
    router_id: "router-1",
    shared_users_snapshot: 1,
    status: "disponible",
    sync_status: "synced",
    uploaded_bytes: 0,
    upload_limit_snapshot: "2M",
    uptime_seconds: 0,
    username: code,
    validity_minutes_snapshot: 180
  };
}
