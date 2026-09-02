import { describe, expect, it, vi } from "vitest";
import type { CreateTicketInput } from "../../domain/database";
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  InMemoryDatabaseClient,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository
} from "../database";
import type { RecoveredVoucherBatchFileStore } from "./RecoveredVoucherBatchPdfService";
import { RecoveredVoucherBatchPdfService } from "./RecoveredVoucherBatchPdfService";

describe("RecoveredVoucherBatchPdfService", () => {
  it("reconstruit une seule fois le PDF d'un lot exactement confirme", async () => {
    const context = await setupConfirmedBatch();
    const fileStore = memoryFileStore();
    const generatePdf = vi.fn(() => new Uint8Array([1, 2, 3]));
    const resolvePassword = vi.fn(async ({ username }: { username: string }) => `password-${username}`);
    const service = new RecoveredVoucherBatchPdfService(context.database, fileStore, {
      generatePdf,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      resolvePassword
    });

    const first = await service.recover("account-1", "batch-1");
    const second = await service.recover("account-1", "batch-1");

    expect(first).toMatchObject({
      batchId: "batch-1",
      cloudSyncPending: false,
      status: "created",
      ticketCount: 2
    });
    expect(second).toMatchObject({ status: "already_available", ticketCount: 2 });
    expect(fileStore.writeBytes).toHaveBeenCalledTimes(1);
    expect(generatePdf).toHaveBeenCalledTimes(1);
    expect(resolvePassword).toHaveBeenCalledTimes(2);
    expect(generatePdf).toHaveBeenCalledWith(expect.objectContaining({
      durationLabel: "1 h",
      tickets: expect.arrayContaining([
        expect.objectContaining({ password: "password-700001", username: "700001" })
      ]),
      validityLabel: "3H"
    }));
    expect(JSON.stringify(first)).not.toContain("password-700001");
    expect(JSON.stringify(first)).not.toContain("secret://");
    await expect(new GeneratedFileRepository(context.database).findById("batch-1-pdf"))
      .resolves.toMatchObject({ batch_id: "batch-1", format: "a4" });
    expect((await new TicketRepository(context.database).listByBatch("batch-1"))
      .every((ticket) => Boolean(ticket.exported_at))).toBe(true);
  });

  it("refuse tout PDF tant que le lot reste partiel", async () => {
    const context = await setupConfirmedBatch();
    await new TicketBatchRepository(context.database).updateState(
      "batch-1",
      "account-1",
      "partiel",
      "pending"
    );
    const fileStore = memoryFileStore();
    const generatePdf = vi.fn(() => new Uint8Array([1]));
    const resolvePassword = vi.fn();
    const service = new RecoveredVoucherBatchPdfService(context.database, fileStore, {
      generatePdf,
      resolvePassword
    });

    await expect(service.recover("account-1", "batch-1")).resolves.toMatchObject({
      file: null,
      status: "not_ready"
    });
    expect(fileStore.writeBytes).not.toHaveBeenCalled();
    expect(generatePdf).not.toHaveBeenCalled();
    expect(resolvePassword).not.toHaveBeenCalled();
  });

  it("reste relancable si l'ecriture du fichier est interrompue", async () => {
    const context = await setupConfirmedBatch();
    const fileStore = memoryFileStore();
    fileStore.writeBytes.mockRejectedValueOnce(new Error("coupure disque injectee"));
    const service = new RecoveredVoucherBatchPdfService(context.database, fileStore, {
      generatePdf: () => new Uint8Array([7, 8, 9]),
      resolvePassword: async () => "password-test"
    });

    await expect(service.recover("account-1", "batch-1")).rejects.toThrow("coupure disque injectee");
    await expect(new GeneratedFileRepository(context.database).findById("batch-1-pdf"))
      .resolves.toBeNull();

    await expect(service.recover("account-1", "batch-1")).resolves.toMatchObject({ status: "created" });
    expect(fileStore.writeBytes).toHaveBeenCalledTimes(2);
  });

  it("conserve le PDF local si la publication multi-PC echoue", async () => {
    const context = await setupConfirmedBatch();
    const fileStore = memoryFileStore();
    const publishFile = vi.fn(async () => { throw new Error("VPS indisponible"); });
    const publishTicketPrintArchive = vi.fn();
    const service = new RecoveredVoucherBatchPdfService(context.database, fileStore, {
      cloudPublisher: { publishFile, publishTicketPrintArchive },
      generatePdf: () => new Uint8Array([4, 5, 6]),
      resolvePassword: async () => "password-test"
    });

    await expect(service.recover("account-1", "batch-1")).resolves.toMatchObject({
      cloudSyncPending: true,
      status: "created"
    });
    expect(publishFile).toHaveBeenCalledTimes(1);
    expect(publishTicketPrintArchive).not.toHaveBeenCalled();
    await expect(new GeneratedFileRepository(context.database).findById("batch-1-pdf"))
      .resolves.toMatchObject({ batch_id: "batch-1" });
  });

  it("retrouve un lot confirme meme si l'application a coupe apres la reconciliation", async () => {
    const context = await setupConfirmedBatch();
    const fileStore = memoryFileStore();
    const service = new RecoveredVoucherBatchPdfService(context.database, fileStore, {
      generatePdf: () => new Uint8Array([1, 1, 1]),
      resolvePassword: async () => "password-test"
    });

    await expect(service.recoverMissingForRouter("account-1", "router-1")).resolves.toMatchObject({
      failedBatchCount: 0,
      results: [expect.objectContaining({ batchId: "batch-1", status: "created" })]
    });
    await expect(service.recoverMissingForRouter("account-1", "router-1")).resolves.toEqual({
      failedBatchCount: 0,
      results: []
    });
    expect(fileStore.writeBytes).toHaveBeenCalledTimes(1);
  });
});

async function setupConfirmedBatch() {
  const database = new InMemoryDatabaseClient();
  await database.initialize();
  await database.execute(
    `INSERT INTO accounts (
      id, email, password_hash, display_name, company_name, phone, status,
      created_at, updated_at, last_login_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    [
      "account-1",
      "test@ticketpro-ne.com",
      "hash",
      "Test",
      "TicketPro Test",
      "+22370000000",
      "active",
      "2026-09-02T10:00:00.000Z",
      "2026-09-02T10:00:00.000Z",
      null
    ]
  );
  await new RouterRepository(database).create({
    account_id: "account-1",
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: "hEX",
    connection_mode: "vpn",
    created_by_profile_id: "account-1:profile-admin",
    encrypted_password: "secret://router/password",
    hotspot_address: "wifi.ticketpro.test",
    id: "router-1",
    label: "Zone test",
    last_seen_at: null,
    local_ip: "192.168.88.1",
    model: "RB750Gr3",
    name: "Routeur Test",
    routeros_version: "7.21",
    serial_number: "TEST",
    status: "active",
    username: "ticketpro-api",
    zone_id: "zone-1"
  });
  await new HotspotPlanRepository(database).create({
    created_by_profile_id: "account-1:profile-admin",
    currency: "CFA",
    data_limit_mb: null,
    download_limit: "5M",
    duration_minutes: 60,
    id: "plan-1",
    mikrotik_id: "*P1",
    mikrotik_profile_name: "plan-profile",
    name: "Plan 1 heure",
    price_hint: 500,
    router_id: "router-1",
    shared_users: 1,
    status: "active",
    upload_limit: "2M",
    validity_minutes: 180
  });
  const tickets = [ticket("ticket-1", "700001"), ticket("ticket-2", "700002")];
  await new TicketBatchRepository(database).createWithTickets({
    account_id: "account-1",
    code_length: 6,
    currency: "CFA",
    created_at: "2026-09-02T10:30:00.000Z",
    created_by_profile: "operator",
    created_by_profile_id: "account-1:profile-operator",
    generated_file_id: "batch-1-pdf",
    id: "batch-1",
    operator_profile: "operator",
    plan_id: "plan-1",
    price_snapshot: 500,
    prefix: null,
    quantity: tickets.length,
    router_id: "router-1",
    status: "termine",
    sync_status: "synced"
  }, tickets);
  return { database };
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
    hotspot_server_name: "hotspot-1",
    id,
    ip_address: null,
    last_router_sync_at: "2026-09-02T10:31:00.000Z",
    mac_address: null,
    mikrotik_id: `*${id}`,
    mikrotik_profile_name: "plan-profile",
    password_encrypted: `secret://router-1/${username}/password`,
    plan_id: "plan-1",
    printed_count: 0,
    remaining_seconds: 3600,
    router_id: "router-1",
    shared_users_snapshot: 1,
    status: "disponible",
    sync_status: "synced",
    uploaded_bytes: 0,
    upload_limit_snapshot: "2M",
    uptime_seconds: 0,
    username,
    validity_minutes_snapshot: 180
  };
}

function memoryFileStore() {
  const files = new Map<string, Uint8Array>();
  const metadata = vi.fn(async (relativePath: string) => ({
    absolute_path: `C:/TicketPro/${relativePath}`,
    exists: files.has(relativePath),
    relative_path: relativePath,
    size_bytes: files.get(relativePath)?.byteLength ?? 0
  }));
  const writeBytes = vi.fn(async (relativePath: string, bytes: Uint8Array) => {
    files.set(relativePath, bytes);
    return {
      absolute_path: `C:/TicketPro/${relativePath}`,
      bytes_written: bytes.byteLength,
      relative_path: relativePath
    };
  });
  return { metadata, writeBytes } satisfies RecoveredVoucherBatchFileStore & {
    metadata: ReturnType<typeof vi.fn>;
    writeBytes: ReturnType<typeof vi.fn>;
  };
}
