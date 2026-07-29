import type { UserRole } from "../../domain/auth";
import type { ActiveHotspotUser, HotspotPlan, HotspotUser } from "../../domain/router";
import { hasAnyPermission } from "../../services/auth";
import type { RouterAccessPolicy } from "../../services/access";

export type RouterQuickActionId = "clients" | "createTickets" | "report" | "testRouter" | "tickets";

export type RouterQuickAction = {
  id: RouterQuickActionId;
  label: string;
  to?: string;
};

export type RouterHomeIndicators = {
  activePlanCount: number;
  connectedClientCount: number;
  generatedPdfCount: number;
  localVoucherCount: number;
  routerPlanCount: number;
  routerVoucherCount: number;
};

export function getRouterQuickActions(role: UserRole, routerId: string): RouterQuickAction[] {
  const basePath = `/routeurs/${routerId}`;
  const actions: RouterQuickAction[] = [];

  if (hasAnyPermission(role, ["router.tickets.generate"])) {
    actions.push({
      id: "createTickets",
      label: "Créer des tickets",
      to: `${basePath}/tickets/generation`
    });
  }

  if (hasAnyPermission(role, ["router.tickets.read", "router.tickets.own"])) {
    actions.push({
      id: "tickets",
      label: role === "agent" ? "Voir mes tickets" : "Voir tickets",
      to: `${basePath}/tickets`
    });
  }

  if (hasAnyPermission(role, ["router.clients.read"])) {
    actions.push({
      id: "clients",
      label: "Voir clients connectés",
      to: `${basePath}/clients-connectes`
    });
  }

  if (hasAnyPermission(role, ["router.report.read", "router.report.own"])) {
    actions.push({
      id: "report",
      label: "Ouvrir rapport",
      to: `${basePath}/rapport`
    });
  }

  if (role !== "guest") {
    actions.push({
      id: "testRouter",
      label: "Tester routeur"
    });
  }

  return actions;
}

export function formatBytes(value: number): string {
  const units = ["o", "Ko", "Mo", "Go"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${Math.round(size)} ${units[unitIndex]}`;
}

export function shouldShowDeviceProtectionNotice(
  policy: Pick<
    RouterAccessPolicy,
    "antiSharingMode" | "lockVoucherToFirstMac"
  > | null
): boolean {
  return Boolean(
    policy &&
      (!policy.lockVoucherToFirstMac || policy.antiSharingMode !== "strict")
  );
}

export function buildRouterHomeIndicators(input: {
  activeUsers: ActiveHotspotUser[];
  generatedPdfCount: number;
  localVoucherCount: number;
  plans: HotspotPlan[];
  routerUsers: HotspotUser[];
}): RouterHomeIndicators {
  return {
    activePlanCount: input.plans.filter((plan) => plan.status === "active").length,
    connectedClientCount: input.activeUsers.length,
    generatedPdfCount: input.generatedPdfCount,
    localVoucherCount: input.localVoucherCount,
    routerPlanCount: input.plans.length,
    routerVoucherCount: input.routerUsers.length
  };
}
