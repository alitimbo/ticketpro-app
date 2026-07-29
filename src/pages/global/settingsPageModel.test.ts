import { describe, expect, it } from "vitest";
import {
  canEditSensitiveSettings,
  defaultAppSettings,
  validateAppSettings
} from "./settingsPageModel";

describe("settingsPageModel", () => {
  it("valide les paramètres globaux par défaut", () => {
    expect(validateAppSettings(defaultAppSettings)).toBeNull();
    expect(defaultAppSettings).toMatchObject({
      sessionTimeoutMinutes: 30
    });
  });

  it("refuse un délai de session trop court", () => {
    expect(validateAppSettings({ ...defaultAppSettings, sessionTimeoutMinutes: 1 })).toBe(
      "Le délai de session doit être entre 5 et 480 minutes."
    );
  });

  it("réserve les paramètres sensibles à l'Admin", () => {
    expect(canEditSensitiveSettings("admin")).toBe(true);
    expect(canEditSensitiveSettings("operator")).toBe(false);
  });
});
