import type { TicketRecord } from "../../domain/database";
import type { HotspotPlanDraft, HotspotUserLimits } from "../../domain/router";
import type { RouterService } from "./RouterService";

type PlanVoucherRouterService = Pick<
  RouterService,
  "configureHotspotUserLifecycle" | "listHotspotUsers" | "updateHotspotUser"
>;

export type PlanVoucherSyncResult = {
  linkedLocalTickets: number;
  missingFromRouter: number;
  updatedRouterUsers: number;
};

/**
 * Applies the enforceable parts of a plan to vouchers that still exist on
 * RouterOS. Historical/expired tickets remain untouched in SQLite.
 */
export async function synchronizePlanVouchers(input: {
  draft: HotspotPlanDraft;
  localPlanId: string;
  localTickets: TicketRecord[];
  service: PlanVoucherRouterService;
}): Promise<PlanVoucherSyncResult> {
  const linkedTickets = input.localTickets.filter(
    (ticket) => ticket.plan_id === input.localPlanId && ticket.deleted_at === null
  );
  const linkedUsernames = new Set(linkedTickets.map((ticket) => ticket.username));
  const routerUsers = await input.service.listHotspotUsers();
  const targets = routerUsers.filter((user) => linkedUsernames.has(user.username));
  const limits: HotspotUserLimits = {
    limitBytesTotal: dataLimitMbToBytes(input.draft.dataLimitMb),
    limitUptime: durationMinutesToRouterOs(input.draft.durationMinutes)
  };
  const validityMinutes = input.draft.validityMinutes && input.draft.validityMinutes > 0
    ? input.draft.validityMinutes
    : null;

  for (const user of targets) {
    await input.service.updateHotspotUser(user.username, input.draft.profileName, limits);
    await input.service.configureHotspotUserLifecycle(user.username, validityMinutes);
  }

  return {
    linkedLocalTickets: linkedTickets.length,
    missingFromRouter: linkedTickets.length - targets.length,
    updatedRouterUsers: targets.length
  };
}

function dataLimitMbToBytes(value: number | null | undefined): number | null {
  if (!value || value <= 0) return null;
  return Math.round(value * 1024 * 1024);
}

function durationMinutesToRouterOs(value: number | null | undefined): string | null {
  if (!value || value <= 0) return null;
  if (value >= 1440 && value % 1440 === 0) return `${value / 1440}d`;
  if (value >= 60 && value % 60 === 0) return `${value / 60}h`;
  return `${value}m`;
}
