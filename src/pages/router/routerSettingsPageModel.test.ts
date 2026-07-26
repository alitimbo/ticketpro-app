import { describe, expect, it } from "vitest";
import {
  canEditRouterSensitiveSettings,
  canViewRouterSettings,
  defaultRouterSettings,
  validateRouterSettings
} from "./routerSettingsPageModel";

describe("routerSettingsPageModel", () => {
  it("valide les paramètres routeur par défaut", () => {
    expect(validateRouterSettings(defaultRouterSettings)).toBeNull();
  });

  it("refuse des ports invalides", () => {
    expect(validateRouterSettings({ ...defaultRouterSettings, apiPort: "abc" })).toBe("Renseignez des ports API valides.");
  });

  it("sépare lecture et édition sensible", () => {
    expect(canViewRouterSettings("operator")).toBe(true);
    expect(canEditRouterSensitiveSettings("operator")).toBe(false);
    expect(canEditRouterSensitiveSettings("admin")).toBe(true);
  });
});

