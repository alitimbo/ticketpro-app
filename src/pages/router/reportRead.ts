import type { AuthSession } from "../../domain/auth";
import type { HotspotPlanRecord, TicketRecord } from "../../domain/database";
import type { SaasRouterTicketCatalog } from "../../services/saas";
import { ticketFromRecord } from "./ticketsPageModel";
import type { ReportTicket } from "./reportPageModel";

/** Bound read-only work. Late native replies are ignored by the caller, not treated as cancellation. */
export async function reportRead<T>(signal: AbortSignal, label: string, read: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  if (signal.aborted) throw new Error("Lecture annulée.");
  let timer: ReturnType<typeof setTimeout>;
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Lecture annulée."));
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé. Réessayez.`)), timeoutMs);
  });
  try {
    return await Promise.race([read(), interrupted]);
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", abort);
  }
}

/** No SQLite import is necessary to display an authorized cloud report. */
export function cloudReportTickets(catalog: SaasRouterTicketCatalog, session: AuthSession,
  userId: string | undefined, routerId: string, routerName: string, plans: HotspotPlanRecord[]): ReportTicket[] {
  const batches = new Map(catalog.batches.map(batch => [batch.id, batch]));
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  const byProfile = new Map(plans.map(plan => [plan.mikrotik_profile_name, plan]));
  return catalog.tickets.filter(ticket => session.permissions.includes("router.report.read") ||
    (session.permissions.includes("router.report.own") && !!userId && ticket.created_by_user_id === userId))
    .map(remote => {
      const batch = batches.get(remote.batch_id);
      const plan = byId.get(remote.plan_id) ?? (remote.mikrotik_profile_name ? byProfile.get(remote.mikrotik_profile_name) : null) ?? null;
      const record: TicketRecord = { ...remote, account_id: session.account_id, router_id: routerId,
        plan_id: plan?.id ?? remote.plan_id, password_encrypted: "report-only://unavailable",
        created_by_profile: remote.created_by_role,
        created_by_profile_id: remote.created_by_user_id === userId ? session.internal_profile_id
          : `${session.account_id}:cloud-user:${remote.created_by_user_id}`,
        sync_status: "synced" };
      return { ...ticketFromRecord(record, plan, routerName),
        currency: batch?.currency ?? plan?.currency ?? "CFA", priceHint: batch ? batch.price_snapshot : plan?.price_hint ?? null,
        printedAt: [], deletedAt: remote.deleted_at };
    });
}
