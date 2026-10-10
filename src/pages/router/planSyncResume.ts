import type { HotspotPlanRecord, TicketRecord } from "../../domain/database";
import type { HotspotPlan, HotspotPlanDraft } from "../../domain/router";
import type { HotspotPlanRepository, TicketRepository } from "../../services/database";
import {
  synchronizePlanVouchers,
  updateRemotePlanIdempotently,
  type RouterService
} from "../../services/router";

type PlanResumeService = Pick<
  RouterService,
  | "configureHotspotUserLifecycle"
  | "createHotspotPlan"
  | "deleteHotspotPlan"
  | "listHotspotUsers"
  | "updateHotspotPlan"
  | "updateHotspotUser"
>;

export type PlanResumeResult = {
  failed: Array<{ message: string; plan: HotspotPlanRecord }>;
  synced: HotspotPlanRecord[];
};

/**
 * Pushes plans left "pending" by an earlier failed RouterOS write, once the
 * router answers again. Each plan is written by its RouterOS .id (stable across
 * renames), its pristine vouchers are aligned, the local voucher references
 * follow a profile rename, and the plan is marked synchronized only after
 * RouterOS confirmed the write.
 */
export async function resumePendingPlans(input: {
  accountId: string;
  actorProfileId: string | null;
  pending: HotspotPlanRecord[];
  planRepository: Pick<HotspotPlanRepository, "update">;
  remotePlans: HotspotPlan[];
  routerId: string;
  service: PlanResumeService;
  ticketRepository: Pick<TicketRepository, "listByRouter" | "renameProfileReference">;
}): Promise<PlanResumeResult> {
  const result: PlanResumeResult = { failed: [], synced: [] };
  let tickets: TicketRecord[] | null = null;
  for (const plan of input.pending.filter((record) => !record.deleted_at)) {
    try {
      const draft = planRecordToDraft(plan);
      const reference = plan.mikrotik_id?.trim() || plan.mikrotik_profile_name?.trim() || plan.name;
      const previousProfileName = input.remotePlans.find((remote) => remote.id === plan.mikrotik_id)?.profileName ?? null;
      const remote = await updateRemotePlanIdempotently(input.service, reference, draft);
      tickets ??= await input.ticketRepository.listByRouter(input.routerId);
      await synchronizePlanVouchers({ draft, localPlanId: plan.id, localTickets: tickets, service: input.service });
      if (previousProfileName && previousProfileName !== remote.profileName) {
        await input.ticketRepository.renameProfileReference({
          accountId: input.accountId,
          planId: plan.id,
          previousProfileName,
          profileName: remote.profileName,
          routerId: input.routerId
        });
      }
      result.synced.push(await input.planRepository.update({
        ...plan,
        last_synced_at: new Date().toISOString(),
        mikrotik_id: remote.id,
        mikrotik_profile_name: remote.profileName,
        sync_status: "synced"
      }, {
        action: "synchronized",
        actorProfileId: input.actorProfileId,
        source: "routeros-resume"
      }));
    } catch (error) {
      result.failed.push({ message: error instanceof Error ? error.message : "Écriture RouterOS impossible.", plan });
    }
  }
  return result;
}

function planRecordToDraft(plan: HotspotPlanRecord): HotspotPlanDraft {
  return {
    dataLimitMb: plan.data_limit_mb,
    downloadLimit: plan.download_limit,
    durationMinutes: plan.duration_minutes,
    name: plan.name,
    priceHint: plan.price_hint,
    profileName: plan.mikrotik_profile_name?.trim() || plan.name,
    sharedUsers: plan.shared_users,
    status: plan.status === "disabled" ? "disabled" : "active",
    uploadLimit: plan.upload_limit,
    validityMinutes: plan.validity_minutes
  };
}
