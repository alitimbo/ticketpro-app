import type { HotspotPlanRecord } from "../../domain/database";
import type { HotspotPlan } from "../../domain/router";
import { HotspotPlanRepository } from "../database";

export type RouterPlanCatalogReconciliationResult = {
  createdCount: number;
  identityUpdatedCount: number;
  liveRecords: HotspotPlanRecord[];
  removedCount: number;
  retainedPendingRecords: HotspotPlanRecord[];
  updatedCount: number;
};

type RouterPlanCatalogReconciliationInput = {
  plans: HotspotPlan[];
  repository: HotspotPlanRepository;
  routerId: string;
};

/**
 * Makes the successfully-read RouterOS profile catalog authoritative locally.
 *
 * Plans that were once synchronized but no longer exist on the MikroTik are
 * soft-deleted: historical tickets keep their plan id, while sales screens no
 * longer offer a profile that RouterOS cannot use. A local pending plan is
 * retained because it may still need to be pushed to the router.
 */
export async function reconcileRouterPlanCatalog({
  plans,
  repository,
  routerId
}: RouterPlanCatalogReconciliationInput): Promise<RouterPlanCatalogReconciliationResult> {
  const localPlans = await repository.listByRouter(routerId);
  const localByProfile = new Map<string, HotspotPlanRecord>();
  for (const local of localPlans) {
    localByProfile.set(local.mikrotik_profile_name ?? local.name, local);
  }

  const liveRecords: HotspotPlanRecord[] = [];
  const liveProfileNames = new Set(plans.map((plan) => plan.profileName));
  let createdCount = 0;
  let identityUpdatedCount = 0;
  let updatedCount = 0;

  for (const plan of plans) {
    const local = localByProfile.get(plan.profileName);
    if (local) {
      if (local.mikrotik_id !== plan.id) identityUpdatedCount += 1;
      const updated = await repository.update({
        ...local,
        data_limit_mb: plan.dataLimitMb,
        download_limit: plan.downloadLimit,
        duration_minutes: plan.durationMinutes,
        currency: local.currency,
        mikrotik_id: plan.id,
        mikrotik_profile_name: plan.profileName,
        // The commercial label and price belong to TicketPro. RouterOS only
        // remains authoritative for the technical profile values.
        name: local.name,
        price_hint: plan.priceHint ?? local.price_hint,
        shared_users: plan.sharedUsers,
        status: plan.status,
        sync_status: "synced",
        upload_limit: plan.uploadLimit,
        validity_minutes: plan.validityMinutes ?? local.validity_minutes
      }, {
        source: "routeros-catalog"
      });
      liveRecords.push(updated);
      updatedCount += 1;
      continue;
    }

    const created = await repository.create({
      data_limit_mb: plan.dataLimitMb,
      download_limit: plan.downloadLimit,
      duration_minutes: plan.durationMinutes,
      currency: "CFA",
      id: `plan-recovered-${crypto.randomUUID()}`,
      mikrotik_id: plan.id,
      mikrotik_profile_name: plan.profileName,
      name: plan.name,
      price_hint: plan.priceHint,
      router_id: routerId,
      shared_users: plan.sharedUsers,
      status: plan.status,
      sync_status: "synced",
      upload_limit: plan.uploadLimit,
      validity_minutes: plan.validityMinutes
    }, {
      action: "restored",
      source: "routeros-catalog"
    });
    liveRecords.push(created);
    createdCount += 1;
  }

  const retainedPendingRecords: HotspotPlanRecord[] = [];
  let removedCount = 0;
  for (const local of localPlans) {
    const profileName = local.mikrotik_profile_name ?? local.name;
    if (liveProfileNames.has(profileName)) continue;

    if (local.sync_status === "pending" || local.sync_status === "local") {
      retainedPendingRecords.push(local);
      continue;
    }

    await repository.remove(local.id, {
      source: "routeros-catalog"
    });
    removedCount += 1;
  }

  return {
    createdCount,
    identityUpdatedCount,
    liveRecords,
    removedCount,
    retainedPendingRecords,
    updatedCount
  };
}
