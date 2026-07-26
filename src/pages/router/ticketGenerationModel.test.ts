import { describe, expect, it } from "vitest";
import {
  buildTicketBatch,
  createInitialTicketGenerationState,
  defaultTicketGenerationOptions,
  getTicketSummary,
  validateTicketGeneration
} from "./ticketGenerationModel";

const routers = [
  {
    connectionMode: "local" as const,
    host: "192.168.88.1",
    id: "routeur-demo",
    isReachable: true,
    name: "Routeur démo"
  }
];

const plans = [
  {
    dataLimitMb: 2048,
    downloadLimit: "5M",
    durationMinutes: 180,
    id: "plan-3h",
    name: "3h-2Go",
    priceHint: 500,
    profileName: "plan-3h",
    sharedUsers: 1,
    status: "active" as const,
    uploadLimit: "2M",
    validityMinutes: 180
  }
];

describe("ticketGenerationModel", () => {
  it("valide un lot simple de 20 tickets pour opérateur", () => {
    const state = {
      ...createInitialTicketGenerationState("routeur-demo"),
      selectedPlanId: "plan-3h"
    };

    expect(validateTicketGeneration(state, routers, plans)).toBeNull();
    expect(
      validateTicketGeneration({ ...state, quantity: "custom", customQuantity: "0" }, routers, plans)
    ).toBe("Choisissez une quantité entre 1 et 500.");
  });

  it("prépare le lot local et le résumé sans secret en clair", () => {
    const batch = buildTicketBatch({
      accountId: "account-douma-demo",
      id: "batch-test",
      operatorProfileId: "account-douma-demo:internal-profile-operator",
      operatorRole: "operator",
      options: {
        ...defaultTicketGenerationOptions,
        codeLength: 6,
        createPdf: true,
        excludeAmbiguous: true,
        generateQrCode: false,
        prefix: "",
        usernameEqualsPassword: true
      },
      planId: "plan-3h",
      quantity: 20,
      routerId: "routeur-demo",
      syncStatus: "synced"
    });
    const summary = getTicketSummary({
      operatorRole: "operator",
      plan: plans[0],
      quantity: 20,
      router: routers[0],
      syncStatus: "synced"
    });

    expect(batch).toMatchObject({
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      quantity: 20,
      status: "terminé",
      sync_status: "synced"
    });
    expect(summary).toMatchObject({
      operator: "Opérateur",
      plan: "3h-2Go",
      router: "Routeur démo",
      totalValue: 10000
    });
    expect(JSON.stringify(batch)).not.toContain("password");
  });
});
