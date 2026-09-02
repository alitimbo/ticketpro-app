import type { GeneratedFileRecord, TicketRecord } from "../../domain/database";
import {
  AccountRepository,
  GeneratedFileRepository,
  HotspotPlanRepository,
  RouterRepository,
  TicketBatchRepository,
  TicketRepository,
  type DatabaseClient
} from "../database";
import type { ManagedFileMetadata, ManagedFileResult } from "../files";
import {
  defaultTicketDisplaySettings,
  resolveTicketPasswordValue,
  resolveTicketTitle,
  TicketDisplaySettingsService
} from "../tickets";
import {
  buildGeneratedTicketPdfRecord,
  buildTicketPdfFileName,
  formatTicketValidityLabel,
  generateTicketPdf,
  type TicketPdfInput
} from "./TicketPdfService";
import { createTicketPrintArchivePayload, type TicketPrintArchivePayload } from "./TicketPrintArchive";

export type RecoveredVoucherBatchPdfStatus = "already_available" | "created" | "not_ready";

export type RecoveredVoucherBatchPdfResult = {
  batchId: string;
  cloudSyncPending: boolean;
  file: GeneratedFileRecord | null;
  status: RecoveredVoucherBatchPdfStatus;
  ticketCount: number;
};

export type RecoveredVoucherBatchPdfSweepResult = {
  failedBatchCount: number;
  results: RecoveredVoucherBatchPdfResult[];
};

export type RecoveredVoucherBatchFileStore = {
  metadata(relativePath: string): Promise<ManagedFileMetadata>;
  writeBytes(relativePath: string, bytes: Uint8Array): Promise<ManagedFileResult>;
};

export type RecoveredVoucherBatchCloudPublisher = {
  publishFile(routerId: string, fileId: string): Promise<void>;
  publishTicketPrintArchive(
    routerId: string,
    fileId: string,
    archive: TicketPrintArchivePayload
  ): Promise<void>;
};

type RecoveredVoucherBatchPdfOptions = {
  cloudPublisher?: RecoveredVoucherBatchCloudPublisher;
  generatePdf?: (input: TicketPdfInput) => Uint8Array;
  now?: () => Date;
  resolvePassword?: typeof resolveTicketPasswordValue;
};

/**
 * Rebuilds the printable artifact after an interrupted RouterOS batch.
 * It never creates vouchers and refuses to emit a partial PDF.
 */
export class RecoveredVoucherBatchPdfService {
  private readonly accounts: AccountRepository;
  private readonly batches: TicketBatchRepository;
  private readonly displaySettings: TicketDisplaySettingsService;
  private readonly files: GeneratedFileRepository;
  private readonly plans: HotspotPlanRepository;
  private readonly routers: RouterRepository;
  private readonly tickets: TicketRepository;

  constructor(
    database: DatabaseClient,
    private readonly fileStore: RecoveredVoucherBatchFileStore,
    private readonly options: RecoveredVoucherBatchPdfOptions = {}
  ) {
    this.accounts = new AccountRepository(database);
    this.batches = new TicketBatchRepository(database);
    this.displaySettings = new TicketDisplaySettingsService(database);
    this.files = new GeneratedFileRepository(database);
    this.plans = new HotspotPlanRepository(database);
    this.routers = new RouterRepository(database);
    this.tickets = new TicketRepository(database);
  }

  async recover(accountId: string, batchId: string): Promise<RecoveredVoucherBatchPdfResult> {
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.account_id !== accountId || batch.deleted_at) {
      return notReady(batchId);
    }

    const ticketRecords = await this.tickets.listByBatch(batch.id);
    if (!isExactlyConfirmedBatch(batch, ticketRecords)) {
      return notReady(batchId, ticketRecords.length);
    }

    const fileId = batch.generated_file_id?.trim() || `${batch.id}-pdf`;
    const existingFile = await this.files.findById(fileId);
    if (existingFile && existingFile.account_id !== accountId) {
      throw new Error("Le fichier de reprise appartient à un autre compte.");
    }
    if (existingFile && !existingFile.deleted_at && await this.fileExists(existingFile.file_path)) {
      await this.markExported(accountId, ticketRecords, existingFile.updated_at);
      return {
        batchId,
        cloudSyncPending: false,
        file: existingFile,
        status: "already_available",
        ticketCount: ticketRecords.length
      };
    }

    const [account, plan, router, storedSettings] = await Promise.all([
      this.accounts.findById(accountId),
      this.plans.findById(batch.plan_id),
      this.routers.findById(batch.router_id),
      this.displaySettings.get(accountId, batch.router_id)
    ]);
    if (!plan || !router || router.account_id !== accountId || plan.router_id !== router.id) {
      throw new Error("Les données locales du lot sont incomplètes pour reconstruire son PDF.");
    }
    const hotspotAddress = router.hotspot_address?.trim();
    if (!hotspotAddress) {
      throw new Error("L'adresse Hotspot du routeur est requise pour reconstruire le PDF.");
    }

    const generatedAt = (this.options.now?.() ?? new Date()).toISOString();
    const settings = { ...defaultTicketDisplaySettings, ...storedSettings, currency: batch.currency || "CFA" };
    const firstTicket = ticketRecords[0];
    const durationMinutes = positiveMinutes(firstTicket.duration_minutes_snapshot) ?? plan.duration_minutes;
    const validityMinutes = positiveMinutes(firstTicket.validity_minutes_snapshot)
      ?? positiveMinutes(plan.validity_minutes)
      ?? durationMinutes;
    const dataLimitMb = firstTicket.data_limit_mb_snapshot ?? plan.data_limit_mb;
    const ownerPhone = settings.showContact
      ? settings.contactNumber.trim() || account?.phone?.trim() || ""
      : "";
    const price = batch.price_snapshot ?? plan.price_hint;
    const fileName = existingFile?.file_name || buildTicketPdfFileName({
      batchId: batch.id,
      currency: batch.currency,
      generatedAt: validDate(batch.created_at) ?? (this.options.now?.() ?? new Date()),
      planName: plan.name,
      price,
      quantity: batch.quantity,
      routerName: router.name
    });
    const resolvePassword = this.options.resolvePassword ?? resolveTicketPasswordValue;
    const pdfTickets = await mapWithConcurrency(ticketRecords, 8, async (ticket) => ({
      password: await resolvePassword({
        passwordSecretRef: ticket.password_encrypted,
        username: ticket.username
      }),
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    }));
    const pdfInput: TicketPdfInput = {
      accountId,
      batchId: batch.id,
      createdByProfile: batch.created_by_profile,
      createdByProfileId: batch.created_by_profile_id,
      currency: batch.currency || "CFA",
      dataLimitLabel: formatDataLimit(dataLimitMb),
      displaySettings: settings,
      durationLabel: formatDuration(durationMinutes),
      fileName,
      format: "a4",
      generatedAt,
      hotspotAddress,
      ownerPhone,
      planName: plan.name,
      priceLabel: price === null || !settings.showPrice
        ? null
        : `${price.toLocaleString("fr-FR")} ${batch.currency || "CFA"}`,
      qrCodeEnabled: settings.showQrCode,
      routerId: router.id,
      template: settings.showQrCode ? "qr" : "economy",
      tickets: pdfTickets,
      titleLabel: resolveTicketTitle(settings, router.name, account?.company_name),
      validityLabel: formatTicketValidityLabel(validityMinutes),
      zoneName: router.name
    };

    const pdfBytes = (this.options.generatePdf ?? generateTicketPdf)(pdfInput);
    let fileInput = buildGeneratedTicketPdfRecord(pdfInput);
    fileInput = { ...fileInput, id: fileId };
    const written = await this.fileStore.writeBytes(fileInput.file_path, pdfBytes);
    const savedFile = await this.files.upsert({
      ...fileInput,
      deleted_at: null,
      file_path: written.relative_path
    });
    await this.markExported(accountId, ticketRecords, generatedAt);

    let cloudSyncPending = false;
    if (this.options.cloudPublisher) {
      try {
        await this.options.cloudPublisher.publishFile(router.id, savedFile.id);
        await this.options.cloudPublisher.publishTicketPrintArchive(
          router.id,
          savedFile.id,
          createTicketPrintArchivePayload(pdfInput)
        );
      } catch {
        cloudSyncPending = true;
      }
    }

    return {
      batchId,
      cloudSyncPending,
      file: savedFile,
      status: "created",
      ticketCount: ticketRecords.length
    };
  }

  async recoverMissingForRouter(
    accountId: string,
    routerId: string,
    limit = 3
  ): Promise<RecoveredVoucherBatchPdfSweepResult> {
    const [batches, files] = await Promise.all([
      this.batches.listByRouter(routerId),
      this.files.listByRouterIncludingDeleted(routerId, accountId)
    ]);
    const activeFileIds = new Set(
      files
        .filter((file) => !file.deleted_at)
        .map((file) => file.id)
    );
    const missingBatchIds = batches
      .filter((batch) =>
        batch.account_id === accountId
        && !batch.deleted_at
        && batch.sync_status === "synced"
        && Boolean(batch.generated_file_id)
        && !activeFileIds.has(batch.generated_file_id!)
      )
      .slice(0, Math.max(1, Math.min(10, Math.round(limit))))
      .map((batch) => batch.id);

    const results: RecoveredVoucherBatchPdfResult[] = [];
    let failedBatchCount = 0;
    for (const missingBatchId of missingBatchIds) {
      try {
        results.push(await this.recover(accountId, missingBatchId));
      } catch {
        failedBatchCount += 1;
      }
    }
    return { failedBatchCount, results };
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    try {
      const metadata = await this.fileStore.metadata(relativePath);
      return metadata.exists && metadata.size_bytes > 0;
    } catch {
      return false;
    }
  }

  private async markExported(accountId: string, tickets: TicketRecord[], exportedAt: string): Promise<void> {
    await this.tickets.markExportedMany(tickets.map((ticket) => ticket.id), accountId, exportedAt);
  }
}

function isExactlyConfirmedBatch(
  batch: { account_id: string; id: string; quantity: number; router_id: string; sync_status: string },
  tickets: TicketRecord[]
): boolean {
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));
  const usernames = new Set(tickets.map((ticket) => ticket.username));
  return batch.sync_status === "synced"
    && tickets.length === batch.quantity
    && ticketIds.size === batch.quantity
    && usernames.size === batch.quantity
    && tickets.every((ticket) =>
      ticket.account_id === batch.account_id
      && ticket.batch_id === batch.id
      && ticket.router_id === batch.router_id
      && ticket.deleted_at === null
      && ticket.sync_status === "synced"
      && Boolean(ticket.mikrotik_id)
      && Boolean(ticket.last_router_sync_at)
    );
}

function notReady(batchId: string, ticketCount = 0): RecoveredVoucherBatchPdfResult {
  return { batchId, cloudSyncPending: false, file: null, status: "not_ready", ticketCount };
}

function positiveMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function formatDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function formatDataLimit(megabytes: number | null): string | null {
  if (megabytes === null) return null;
  if (megabytes >= 1024 && megabytes % 1024 === 0) return `${megabytes / 1024} Go`;
  return `${megabytes} Mo`;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}
