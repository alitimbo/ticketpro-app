import { describe, expect, it, vi } from "vitest";
import type { TicketRecord } from "../../domain/database";
import { synchronizePlanVouchers } from "./HotspotPlanVoucherSync";

function ticket(username: string, planId = "plan-local"): TicketRecord {
  return {
    account_id: "account-1",
    activated_at: null,
    batch_id: "batch-1",
    completed_at: null,
    created_at: "2026-08-11T10:00:00.000Z",
    created_by_profile: "admin",
    created_by_profile_id: "profile-1",
    deleted_at: null,
    downloaded_bytes: 0,
    expires_at: null,
    id: `ticket-${username}`,
    ip_address: null,
    mac_address: null,
    mikrotik_id: `*${username}`,
    password_encrypted: `secret://${username}`,
    plan_id: planId,
    printed_count: 0,
    router_id: "router-1",
    status: "disponible",
    sync_status: "synced",
    updated_at: "2026-08-11T10:00:00.000Z",
    uploaded_bytes: 0,
    username
  };
}

describe("synchronizePlanVouchers", () => {
  it("propage profil, temps, quota et validité aux seuls vouchers locaux encore présents", async () => {
    const updateHotspotUser = vi.fn(async () => ({} as never));
    const configureHotspotUserLifecycle = vi.fn(async () => ({} as never));

    const result = await synchronizePlanVouchers({
      draft: {
        dataLimitMb: 2048,
        downloadLimit: "10M",
        durationMinutes: 180,
        name: "Nouveau plan",
        priceHint: 500,
        profileName: "nouveau-profil",
        sharedUsers: 2,
        status: "active",
        uploadLimit: "5M",
        validityMinutes: 300
      },
      localPlanId: "plan-local",
      localTickets: [ticket("100001"), ticket("100002"), ticket("hors-plan", "autre-plan")],
      service: {
        configureHotspotUserLifecycle,
        listHotspotUsers: vi.fn(async () => [
          { id: "*1", username: "100001" },
          { id: "*9", username: "inconnu" }
        ] as never),
        updateHotspotUser
      }
    });

    expect(updateHotspotUser).toHaveBeenCalledOnce();
    expect(updateHotspotUser).toHaveBeenCalledWith("100001", "nouveau-profil", {
      limitBytesTotal: 2_147_483_648,
      limitUptime: "3h"
    });
    expect(configureHotspotUserLifecycle).toHaveBeenCalledWith("100001", 300);
    expect(result).toEqual({
      linkedLocalTickets: 2,
      missingFromRouter: 1,
      updatedRouterUsers: 1
    });
  });
});
