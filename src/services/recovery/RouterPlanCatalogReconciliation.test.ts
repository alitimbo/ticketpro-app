import { describe, expect, it } from "vitest";
import type { HotspotPlan } from "../../domain/router";
import { HotspotPlanRepository, InMemoryDatabaseClient } from "../database";
import { reconcileRouterPlanCatalog } from "./RouterPlanCatalogReconciliation";

const livePlan = (overrides: Partial<HotspotPlan> = {}): HotspotPlan => ({
  dataLimitMb: null,
  downloadLimit: "5M",
  durationMinutes: 180,
  id: "routeros-3h",
  name: "3h",
  priceHint: null,
  profileName: "3h",
  sharedUsers: 1,
  status: "active",
  uploadLimit: "2M",
  validityMinutes: 240,
  ...overrides
});

describe("reconcileRouterPlanCatalog", () => {
  it("reflète RouterOS, retire un profil supprimé et conserve un brouillon local", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const repository = new HotspotPlanRepository(database);
    await repository.create({
      data_limit_mb: 500,
      download_limit: "1M",
      duration_minutes: 60,
      id: "commercial-3h",
      mikrotik_profile_name: "3h",
      name: "Formule soirée",
      price_hint: 500,
      router_id: "router-1",
      shared_users: 2,
      status: "disabled",
      sync_status: "synced",
      upload_limit: "512K",
      validity_minutes: 180
    });
    await repository.create({
      data_limit_mb: null,
      download_limit: null,
      duration_minutes: 60,
      id: "deleted-in-winbox",
      mikrotik_profile_name: "ancien",
      name: "Ancien",
      price_hint: 100,
      router_id: "router-1",
      shared_users: 1,
      status: "active",
      sync_status: "synced",
      upload_limit: null,
      validity_minutes: 60
    });
    await repository.create({
      data_limit_mb: null,
      download_limit: null,
      duration_minutes: 30,
      id: "pending-local",
      mikrotik_profile_name: "a-envoyer",
      name: "À envoyer",
      price_hint: 50,
      router_id: "router-1",
      shared_users: 1,
      status: "active",
      sync_status: "pending",
      upload_limit: null,
      validity_minutes: 30
    });

    const result = await reconcileRouterPlanCatalog({
      plans: [livePlan(), livePlan({ id: "routeros-day", name: "jour", profileName: "jour" })],
      repository,
      routerId: "router-1"
    });

    expect(result).toMatchObject({
      createdCount: 1,
      identityUpdatedCount: 1,
      removedCount: 1,
      updatedCount: 1
    });
    expect(result.retainedPendingRecords).toEqual([
      expect.objectContaining({ id: "pending-local", sync_status: "pending" })
    ]);
    expect(result.liveRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        duration_minutes: 180,
        currency: "CFA",
        id: "commercial-3h",
        data_limit_mb: 500,
        mikrotik_id: "routeros-3h",
        name: "Formule soirée",
        price_hint: 500,
        sync_status: "synced",
        validity_minutes: 240
      }),
      expect.objectContaining({ mikrotik_profile_name: "jour", sync_status: "synced" })
    ]));

    const visible = await repository.listByRouter("router-1");
    expect(visible.some((plan) => plan.id === "deleted-in-winbox")).toBe(false);
    expect(visible.some((plan) => plan.id === "pending-local")).toBe(true);
    const unlimited = await reconcileRouterPlanCatalog({
      plans: [livePlan({ dataLimitMb: null, dataLimitSource: "routeros" })], repository, routerId: "router-1"
    });
    expect(unlimited.liveRecords[0].data_limit_mb).toBeNull();
  });
});
