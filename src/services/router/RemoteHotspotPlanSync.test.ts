import { describe, expect, it, vi } from "vitest";
import type { HotspotPlan, HotspotPlanDraft } from "../../domain/router";
import { RouterServiceError } from "./RouterService";
import {
  createRemotePlanIdempotently,
  deleteRemotePlanIdempotently,
  updateRemotePlanIdempotently
} from "./RemoteHotspotPlanSync";

const draft: HotspotPlanDraft = {
  dataLimitMb: null,
  downloadLimit: "5M",
  durationMinutes: 60,
  name: "Forfait 1H",
  priceHint: 100,
  profileName: "forfait-1h",
  sharedUsers: 1,
  status: "active",
  uploadLimit: "2M",
  validityMinutes: 180
};

const remotePlan: HotspotPlan = { ...draft, id: "*1", status: "active" };

function service() {
  return {
    createHotspotPlan: vi.fn(async () => remotePlan),
    deleteHotspotPlan: vi.fn(async () => undefined),
    updateHotspotPlan: vi.fn(async () => remotePlan)
  };
}

describe("RemoteHotspotPlanSync", () => {
  it("crée un profil manquant lors de la reprise d'une synchronisation", async () => {
    const remote = service();
    remote.updateHotspotPlan.mockRejectedValueOnce(
      new RouterServiceError("hotspot_not_found", "Profil introuvable")
    );
    await expect(updateRemotePlanIdempotently(remote, draft.profileName, draft)).resolves.toEqual(remotePlan);
    expect(remote.createHotspotPlan).toHaveBeenCalledWith(draft);
  });

  it("met à jour un profil déjà créé après une réponse de doublon", async () => {
    const remote = service();
    remote.createHotspotPlan.mockRejectedValueOnce(
      new RouterServiceError("duplicate_user", "Profil déjà présent")
    );
    await expect(createRemotePlanIdempotently(remote, draft)).resolves.toEqual(remotePlan);
    expect(remote.updateHotspotPlan).toHaveBeenCalledWith(draft.profileName, draft);
  });

  it("considère un profil distant déjà absent comme supprimé", async () => {
    const remote = service();
    remote.deleteHotspotPlan.mockRejectedValueOnce(
      new RouterServiceError("hotspot_not_found", "Profil introuvable")
    );
    await expect(deleteRemotePlanIdempotently(remote, draft.profileName)).resolves.toBe("already_absent");
  });

  it("conserve les vraies erreurs de suppression", async () => {
    const remote = service();
    remote.deleteHotspotPlan.mockRejectedValueOnce(
      new RouterServiceError("permission_denied", "Permission refusée")
    );
    await expect(deleteRemotePlanIdempotently(remote, draft.profileName)).rejects.toMatchObject({
      code: "permission_denied"
    });
  });
});
