import { describe, expect, it, vi } from "vitest";
import type { HotspotPlanRecord } from "../../domain/database";
import type { HotspotPlan } from "../../domain/router";
import { resumePendingPlans } from "./planSyncResume";

const pendingRename = {
  created_at: "2026-10-01T00:00:00Z", created_by_profile_id: null, currency: "CFA", data_limit_mb: null,
  deleted_at: null, download_limit: null, duration_minutes: 240, id: "plan-6h", last_synced_at: null,
  mikrotik_id: "*P4", mikrotik_profile_name: "6H", name: "6H", price_hint: 300, revision: 2,
  router_id: "router-1", shared_users: 1, status: "active", sync_status: "pending",
  updated_at: "2026-10-01T00:00:00Z", updated_by_profile_id: null, upload_limit: null, validity_minutes: 240
} as HotspotPlanRecord;
const remote4h = { id: "*P4", profileName: "4H" } as HotspotPlan;

function setup(updateHotspotPlan: ReturnType<typeof vi.fn>) {
  const planRepository = { update: vi.fn(async (record: HotspotPlanRecord) => record) };
  const ticketRepository = { listByRouter: vi.fn(async () => []), renameProfileReference: vi.fn(async () => 0) };
  const service = {
    configureHotspotUserLifecycle: vi.fn(), createHotspotPlan: vi.fn(), deleteHotspotPlan: vi.fn(),
    listHotspotUsers: vi.fn(async () => []), updateHotspotPlan, updateHotspotUser: vi.fn()
  };
  return { planRepository, service, ticketRepository };
}

describe("resumePendingPlans", () => {
  it("pousse un renommage en attente par .id RouterOS puis aligne les tickets locaux", async () => {
    const { planRepository, service, ticketRepository } = setup(vi.fn(async () => ({ id: "*P4", profileName: "6H" })));
    const result = await resumePendingPlans({
      accountId: "acc", actorProfileId: null, pending: [pendingRename], planRepository: planRepository as never,
      remotePlans: [remote4h], routerId: "router-1", service: service as never, ticketRepository: ticketRepository as never
    });

    expect(service.updateHotspotPlan).toHaveBeenCalledWith("*P4", expect.objectContaining({ name: "6H", profileName: "6H" }));
    expect(service.createHotspotPlan).not.toHaveBeenCalled();
    expect(ticketRepository.renameProfileReference).toHaveBeenCalledWith(expect.objectContaining({
      planId: "plan-6h", previousProfileName: "4H", profileName: "6H"
    }));
    expect(result.synced.map((plan) => plan.sync_status)).toEqual(["synced"]);
  });

  it("laisse le plan en attente si RouterOS refuse, sans le marquer synchronisé", async () => {
    const { planRepository, service, ticketRepository } = setup(vi.fn(async () => { throw new Error("router offline"); }));
    const result = await resumePendingPlans({
      accountId: "acc", actorProfileId: null, pending: [pendingRename], planRepository: planRepository as never,
      remotePlans: [remote4h], routerId: "router-1", service: service as never, ticketRepository: ticketRepository as never
    });
    expect(result.failed.map((item) => item.message)).toEqual(["router offline"]);
    expect(planRepository.update).not.toHaveBeenCalled();
  });
});
