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
      sessionTimeoutMinutes: 15 * 24 * 60
    });
  });

  it("refuse un délai de session trop court", () => {
    expect(validateAppSettings({ ...defaultAppSettings, sessionTimeoutMinutes: 1 })).toBe(
      "Le délai de session doit être entre 5 minutes et 1 mois."
    );
  });

  it("accepte les durées longues proposées dans l'interface", () => {
    expect(validateAppSettings({ ...defaultAppSettings, sessionTimeoutMinutes: 7 * 24 * 60 })).toBeNull();
    expect(validateAppSettings({ ...defaultAppSettings, sessionTimeoutMinutes: 30 * 24 * 60 })).toBeNull();
  });

  it("réserve les paramètres sensibles à l'Admin", () => {
    expect(canEditSensitiveSettings("admin")).toBe(true);
    expect(canEditSensitiveSettings("operator")).toBe(false);
  });
});
