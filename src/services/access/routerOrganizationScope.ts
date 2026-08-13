import type { RouterRecord } from "../../domain/database";

export function canAccessRouterInOrganization(input: {
  accountId: string;
  accessMode: "all" | "selected";
  organizationId: string;
  router: RouterRecord | null;
  selectedRouterIds: string[];
}): boolean {
  const { accountId, accessMode, organizationId, router, selectedRouterIds } = input;
  if (!router || router.deleted_at) return false;
  if (router.account_id !== accountId || router.organization_id !== organizationId) return false;
  return accessMode === "all"
    || selectedRouterIds.includes(router.cloud_router_id ?? router.id);
}
