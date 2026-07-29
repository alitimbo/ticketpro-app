import { describe, expect, it } from "vitest";
import {
  canEditRouterSensitiveSettings,
  canViewRouterSettings,
  defaultRouterSettings,
  validateRouterSettings
} from "./routerSettingsPageModel";

describe("routerSettingsPageModel", () => {
  it("valide des paramètres routeur complets", () => {
    expect(validateRouterSettings({
      ...defaultRouterSettings,
      hotspotAddress: "wifi.ticketpro.local",
      name: "TicketPro Lab"
    })).toBeNull();
  });

  it("refuse des ports invalides", () => {
    expect(validateRouterSettings({
      ...defaultRouterSettings,
      apiPort: "abc",
      hotspotAddress: "wifi.ticketpro.local",
      name: "TicketPro Lab"
    })).toBe("Renseignez des ports API valides.");
  });

  it("sépare lecture et édition sensible", () => {
    expect(canViewRouterSettings("operator")).toBe(true);
    expect(canEditRouterSensitiveSettings("operator")).toBe(false);
    expect(canEditRouterSensitiveSettings("admin")).toBe(true);
  });
});

