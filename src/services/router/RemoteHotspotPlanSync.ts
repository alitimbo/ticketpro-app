import type { HotspotPlan, HotspotPlanDraft } from "../../domain/router";
import { RouterService, RouterServiceError } from "./RouterService";

type RemotePlanService = Pick<
  RouterService,
  "createHotspotPlan" | "deleteHotspotPlan" | "updateHotspotPlan"
>;

export async function createRemotePlanIdempotently(
  service: RemotePlanService,
  draft: HotspotPlanDraft
): Promise<HotspotPlan> {
  try {
    return await service.createHotspotPlan(draft);
  } catch (error) {
    if (!hasRouterErrorCode(error, "duplicate_user")) throw error;
    return service.updateHotspotPlan(draft.profileName, draft);
  }
}

export async function updateRemotePlanIdempotently(
  service: RemotePlanService,
  profileReference: string,
  draft: HotspotPlanDraft
): Promise<HotspotPlan> {
  try {
    return await service.updateHotspotPlan(profileReference, draft);
  } catch (error) {
    if (!hasRouterErrorCode(error, "hotspot_not_found")) throw error;
    return createRemotePlanIdempotently(service, draft);
  }
}

export async function deleteRemotePlanIdempotently(
  service: RemotePlanService,
  profileReference: string
): Promise<"already_absent" | "deleted"> {
  try {
    await service.deleteHotspotPlan(profileReference);
    return "deleted";
  } catch (error) {
    if (hasRouterErrorCode(error, "hotspot_not_found")) return "already_absent";
    throw error;
  }
}

function hasRouterErrorCode(
  error: unknown,
  code: RouterServiceError["code"]
): error is RouterServiceError {
  return error instanceof RouterServiceError && error.code === code;
}
