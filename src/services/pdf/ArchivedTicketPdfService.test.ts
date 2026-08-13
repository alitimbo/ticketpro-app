import { describe, expect, it } from "vitest";
import type {
  AccountRecord,
  GeneratedFileRecord,
  HotspotPlanRecord,
  RouterRecord,
  TicketBatchRecord,
  TicketRecord
} from "../../domain/database";
import { regenerateArchivedTicketPdf } from "./ArchivedTicketPdfService";

describe("ArchivedTicketPdfService", () => {
  it("régénère le PDF avec les paramètres archivés et les tickets du lot", async () => {
    const result = await regenerateArchivedTicketPdf({
      account,
      batch,
      file,
      plan,
      router,
      tickets: [ticket]
    });
    const text = new TextDecoder().decode(result.bytes);

    expect(result).toMatchObject({ format: "thermal80", ticketCount: 1 });
    const mediaBox = text.match(/\/MediaBox \[0 0 226\.77 ([0-9.]+)\]/);
    expect(Number(mediaBox?.[1])).toBeGreaterThan(0);
    expect(Number(mediaBox?.[1])).toBeLessThan(170.08);
    expect(text).toContain("(Ancienne Zone)");
    expect(text).toContain("(Portail : ancien.hotspot.test)");
    expect(text).toContain("(Contact : +227 90 00 00 01)");
    expect(text).toContain("(LOGIN)");
    expect(text).toContain("(TP1001)");
  });

  it("refuse de mélanger les données de deux comptes", async () => {
    await expect(
      regenerateArchivedTicketPdf({
        account,
        batch,
        file: { ...file, account_id: "account-b" },
        plan,
        router,
        tickets: [ticket]
      })
    ).rejects.toThrow("compte actif");
  });
});

const now = "2026-07-29T00:00:00.000Z";
const account: AccountRecord = {
  company_name: "TicketPro Client",
  created_at: now,
  display_name: "Client",
  email: "client@example.test",
  id: "account-a",
  last_login_at: null,
  password_hash: "hash",
  phone: "+227 90 00 00 99",
  status: "active",
  updated_at: now
};
const router: RouterRecord = {
  account_id: account.id,
  api_port: 8728,
  api_ssl_port: 8729,
  board_name: null,
  connection_mode: "local",
  created_at: now,
  created_by_profile_id: "account-a:internal-profile-operator",
  deleted_at: null,
  encrypted_password: "secret",
  hotspot_address: "nouveau.hotspot.test",
  id: "router-a",
  label: "Routeur A",
  last_seen_at: null,
  local_ip: "192.168.88.1",
  model: null,
  name: "Nouvelle Zone",
  notes: null,
  routeros_version: null,
  serial_number: null,
  status: "active",
  subscription_counted: 1,
  sync_status: "synced",
  updated_at: now,
  username: "admin",
  zone_id: null
};
const plan: HotspotPlanRecord = {
  created_at: now,
  created_by_profile_id: "profile-admin",
  currency: "EUR",
  data_limit_mb: 1024,
  deleted_at: null,
  download_limit: null,
  duration_minutes: 60,
  id: "plan-a",
  last_synced_at: now,
  mikrotik_id: "*1",
  mikrotik_profile_name: "1h",
  name: "Nouveau plan",
  price_hint: 200,
  router_id: router.id,
  revision: 2,
  shared_users: 1,
  status: "active",
  sync_status: "synced",
  updated_at: now,
  updated_by_profile_id: "profile-admin",
  upload_limit: null,
  validity_minutes: null
};
const batch: TicketBatchRecord = {
  account_id: account.id,
  code_length: 6,
  currency: "EUR",
  created_at: now,
  created_by_profile: "operator",
  created_by_profile_id: "account-a:internal-profile-operator",
  deleted_at: null,
  generated_file_id: "batch-a-pdf",
  id: "batch-a",
  operator_profile: "operator",
  plan_id: plan.id,
  price_snapshot: 200,
  prefix: "TP",
  quantity: 1,
  router_id: router.id,
  status: "created",
  sync_status: "synced",
  updated_at: now
};
const file: GeneratedFileRecord = {
  account_id: account.id,
  batch_id: batch.id,
  created_at: now,
  created_by_profile: "operator",
  created_by_profile_id: "account-a:internal-profile-operator",
  deleted_at: null,
  file_name: "tickets-batch-a.pdf",
  file_path: "files/tickets-batch-a.pdf",
  format: "pdf",
  id: "batch-a-pdf",
  metadata_json: JSON.stringify({
    dataLimitLabel: "500 Mo",
    durationLabel: "30 min",
    format: "thermal80",
    hotspotAddress: "ancien.hotspot.test",
    ownerPhone: "+227 90 00 00 01",
    planName: "Ancien plan",
    priceLabel: "100 CFA",
    qrCodeEnabled: false,
    template: "economy",
    zoneName: "Ancienne Zone"
  }),
  router_id: router.id,
  sync_status: "local",
  type: "tickets_pdf",
  updated_at: now
};
const ticket: TicketRecord = {
  account_id: account.id,
  activated_at: null,
  batch_id: batch.id,
  completed_at: null,
  created_at: now,
  created_by_profile: "operator",
  created_by_profile_id: "account-a:internal-profile-operator",
  deleted_at: null,
  downloaded_bytes: 0,
  expires_at: null,
  id: "ticket-a",
  ip_address: null,
  mac_address: null,
  mikrotik_id: "*1",
  password_encrypted: "secret://router-a/TP1001/password",
  plan_id: plan.id,
  printed_count: 0,
  router_id: router.id,
  status: "disponible",
  sync_status: "synced",
  updated_at: now,
  uploaded_bytes: 0,
  username: "TP1001"
};
