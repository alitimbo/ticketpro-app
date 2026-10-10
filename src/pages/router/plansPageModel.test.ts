import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  describePlanChangeImpact,
  findPlanProfileConflict,
  routerProfileNameForPlan,
  duplicatePlan,
  emptyPlanFormValues,
  formatPlanDisplayName,
  formValuesToPlanDraft,
  planFromHotspotPlan,
  planToFormValues,
  quickPlanTemplates,
  validatePlanForm
} from "./plansPageModel";

describe("plansPageModel", () => {
  it.each(["0", "-1", "Infinity", "1e30", "invalid"])("refuse un quota ambigu ou non représentable %s", dataAmount => {
    const values = applyTemplate(emptyPlanFormValues, quickPlanTemplates[1]);
    expect(validatePlanForm({ ...values, dataAmount })).toBe("Entrez un volume data valide.");
  });
  it("permet de créer un plan simple depuis un template sans champs avancés", () => {
    const values = applyTemplate(emptyPlanFormValues, quickPlanTemplates[1]);
    const draft = formValuesToPlanDraft(values);

    expect(validatePlanForm(values)).toBeNull();
    expect(draft).toMatchObject({
      currency: "CFA",
      dataLimitMb: 2048,
      downloadLimit: "5M",
      durationMinutes: 180,
      name: "3h-2Go",
      profileName: "3h-2Go",
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
    expect(validatePlanForm({ ...emptyPlanFormValues, currency: "", name: "Test" })).toBe(
      "Choisissez une devise pour ce plan."
    );
    expect(validatePlanForm({ ...emptyPlanFormValues, currency: "€", name: "Test" })).toContain(
      "entre 2 et 12"
    );
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

  it("masque le suffixe monétaire du nom technique sans modifier le profil RouterOS", () => {
    expect(formatPlanDisplayName("1h-100-cfa")).toBe("1h-100");
    expect(formatPlanDisplayName("1h-100-CFA")).toBe("1h-100");
    expect(formatPlanDisplayName("Forfait soirée")).toBe("Forfait soirée");
  });
});

describe("describePlanChangeImpact", () => {
  const plan4h = { dataLimitMb: null, durationMinutes: 240, name: "4H", profileName: "4H", validityMinutes: 240 };

  it("précise qu'un renommage ne change ni la durée ni le quota", () => {
    expect(describePlanChangeImpact(plan4h, { ...plan4h, name: "6H" }))
      .toBe("Nom : « 4H » → « 6H ». Durée, validité et quota inchangés.");
  });

  it("indique que les tickets déjà utilisés conservent leurs conditions", () => {
    expect(describePlanChangeImpact(plan4h, { ...plan4h, durationMinutes: 360, name: "6H" },
      { immutableTicketsSkipped: 3, updatedRouterUsers: 5 }))
      .toBe("Nom : « 4H » → « 6H ». Nouvelles limites appliquées à 5 ticket(s) non utilisé(s) ; 3 ticket(s) déjà utilisé(s) conservent leurs conditions.");
  });
});

describe("concordance nom du plan / profil RouterOS", () => {
  it("le profil RouterOS porte le nom du plan, y compris après renommage", () => {
    const values = planToFormValues({ ...planFromHotspotPlan({ dataLimitMb: null, downloadLimit: null, durationMinutes: 240,
      id: "*P4", name: "4H", priceHint: 200, profileName: "4H", sharedUsers: 1, status: "active", uploadLimit: null,
      validityMinutes: 240 }, 0) });
    expect(formValuesToPlanDraft({ ...values, name: "6H" }).profileName).toBe("6H");
    expect(routerProfileNameForPlan('  Forfait  "VIP"; 1$  ')).toBe("Forfait -VIP-- 1-");
  });

  it("refuse un nom déjà utilisé par un autre profil du routeur", () => {
    const plans = [{ id: "a", name: "4H", profileName: "4H" }, { id: "b", name: "Jour", profileName: "jour" }];
    expect(findPlanProfileConflict("jour", plans, "a")).toBe("Le plan « Jour » utilise déjà ce nom sur le routeur.");
    expect(findPlanProfileConflict("4H", plans, "a")).toBeNull();
  });
});
