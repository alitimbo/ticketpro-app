import { describe, expect, it } from "vitest";
import type { TicketListItem } from "./ticketsPageModel";
import { mergeTicketUpdate, ticketToCreateInput } from "./ticketSyncPersistence";

const ticket: TicketListItem = {
  accountId: "account-1",
  activatedAt: null,
  archivedAt: null,
  batchId: "batch-1",
  code: "ABC123",
  completedAt: null,
  createdAt: "2026-08-13T08:00:00.000Z",
  createdByProfileId: "account-1:profile-1",
  dataLimitMb: 100,
  dataRemainingBytes: null,
  deletedAt: null,
  downloadedBytes: 0,
  expiresAt: null,
  exportedAt: null,
  generatedFileName: null,
  hasPdf: false,
  id: "ticket-1",
  ipAddress: null,
  lastRouterSyncAt: null,
  macAddress: null,
  mikrotikId: null,
  operatorProfile: "admin",
  passwordSecretRef: "secret-ref",
  planDurationMinutes: 60,
  planId: "plan-1",
  planName: "1 heure",
  planPrice: 100,
  planProfileName: "1h",
  planValidityMinutes: 180,
  printedCount: 0,
  profileName: "1h",
  remainingSeconds: 3600,
  routerDeletedAt: null,
  routerId: "router-1",
  routerName: "WiFi Test",
  serverName: "hotspot1",
  status: "disponible",
  syncStatus: "local_only",
  uploadedBytes: 0,
  uptimeSeconds: 0
};

describe("ticketSyncPersistence", () => {
  it("fusionne tous les compteurs et états lus en direct depuis RouterOS", () => {
    const synchronized = mergeTicketUpdate(ticket, {
      activatedAt: "2026-08-13T09:00:00.000Z",
      dataRemainingBytes: 75_000_000,
      downloadedBytes: 20_000_000,
      expiresAt: "2026-08-13T12:00:00.000Z",
      id: ticket.id,
      ipAddress: "192.168.88.101",
      lastRouterSyncAt: "2026-08-13T09:15:00.000Z",
      macAddress: "AA:BB:CC:DD:EE:FF",
      mikrotikId: "*42",
      profileName: "1h",
      remainingSeconds: 2400,
      serverName: "hotspot1",
      status: "en_cours_utilisation",
      syncStatus: "router_synced",
      uploadedBytes: 5_000_000,
      uptimeSeconds: 1200
    });

    expect(synchronized).toMatchObject({
      activatedAt: "2026-08-13T09:00:00.000Z",
      dataRemainingBytes: 75_000_000,
      downloadedBytes: 20_000_000,
      ipAddress: "192.168.88.101",
      macAddress: "AA:BB:CC:DD:EE:FF",
      remainingSeconds: 2400,
      status: "en_cours_utilisation",
      syncStatus: "router_synced",
      uploadedBytes: 5_000_000,
      uptimeSeconds: 1200
    });
  });

  it("conserve une date de suppression stable pendant les synchronisations suivantes", () => {
    const deletedAt = "2026-08-13T10:00:00.000Z";
    const deletedTicket = mergeTicketUpdate({ ...ticket, deletedAt }, {
      id: ticket.id,
      routerDeletedAt: "2026-08-13T10:00:02.000Z",
      status: "supprimé",
      syncStatus: "router_synced"
    });

    expect(deletedTicket.deletedAt).toBe(deletedAt);
    expect(ticketToCreateInput(deletedTicket).deleted_at).toBe(deletedAt);
  });

  it("persiste les détails live sans exposer ni transformer le secret local", () => {
    const input = ticketToCreateInput({
      ...ticket,
      downloadedBytes: 123,
      lastRouterSyncAt: "2026-08-13T11:00:00.000Z",
      syncStatus: "router_synced",
      uploadedBytes: 456
    });

    expect(input).toMatchObject({
      downloaded_bytes: 123,
      last_router_sync_at: "2026-08-13T11:00:00.000Z",
      password_encrypted: "secret-ref",
      sync_status: "synced",
      uploaded_bytes: 456
    });
  });
});
