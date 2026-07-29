import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  duplicatePlan,
  emptyPlanFormValues,
  formValuesToPlanDraft,
  planFromHotspotPlan,
  quickPlanTemplates,
  validatePlanForm
} from "./plansPageModel";

describe("plansPageModel", () => {
  it("permet de créer un plan simple depuis un template sans champs avancés", () => {
    const values = applyTemplate(emptyPlanFormValues, quickPlanTemplates[1]);
    const draft = formValuesToPlanDraft(values);

    expect(validatePlanForm(values)).toBeNull();
    expect(draft).toMatchObject({
      dataLimitMb: 2048,
      downloadLimit: "5M",
      durationMinutes: 180,
      name: "3h-2Go",
      profileName: "3h-2go",
      sharedUsers: 1,
      uploadLimit: "2M",
      validityMinutes: 300
    });
  });

  it("distingue la durée consommable de la validité après activation", () => {
    const values = applyTemplate(emptyPlanFormValues, quickPlanTemplates[0]);
    const draft = formValuesToPlanDraft(values);

    expect(draft.durationMinutes).toBe(60);
    expect(draft.validityMinutes).toBe(180);
  });

  it("valide les champs obligatoires", () => {
    expect(validatePlanForm({ ...emptyPlanFormValues, name: "" })).toBe("Entrez le nom du plan.");
    expect(validatePlanForm({ ...emptyPlanFormValues, name: "Test", sharedUsers: "0" })).toBe(
      "Entrez un nombre d’appareils valide."
    );
  });

  it("duplique un plan sans tickets liés", () => {
    const plan = planFromHotspotPlan(
      {
        dataLimitMb: null,
        downloadLimit: "5M",
        durationMinutes: 60,
        id: "plan-1",
        name: "1h",
        priceHint: 100,
        profileName: "1h",
        sharedUsers: 1,
        status: "active",
        uploadLimit: "2M",
        validityMinutes: 60
      },
      5
    );

    expect(duplicatePlan(plan)).toMatchObject({
      linkedTickets: 0,
      name: "1h copie",
      status: "active"
    });
  });
});
