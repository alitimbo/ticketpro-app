import type { RouterConnectionMode } from "../../domain/router";

export type RouterSettings = {
  apiPort: string;
  apiSslPort: string;
  connectionMode: RouterConnectionMode;
  defaultPlanId: string;
  displayNameOnTickets: string;
  ipAddress: string;
  name: string;
  password: string;
  printerId: string;
  supportPhone: string;
  username: string;
};

export const defaultRouterSettings: RouterSettings = {
  apiPort: "8728",
  apiSslPort: "8729",
  connectionMode: "local",
  defaultPlanId: "plan-3h",
  displayNameOnTickets: "Boutique centre",
  ipAddress: "192.168.88.1",
  name: "Boutique centre",
  password: "",
  printerId: "pdf-export",
  supportPhone: "+227 90 00 00 00",
  username: "admin"
};

const routerSettingsStorageKey = "hotspot:router_settings";

export function loadRouterSettings(): RouterSettings {
  if (typeof localStorage === "undefined") {
    return defaultRouterSettings;
  }

  try {
    return { ...defaultRouterSettings, ...JSON.parse(localStorage.getItem(routerSettingsStorageKey) ?? "{}") };
  } catch {
    return defaultRouterSettings;
  }
}

export function saveRouterSettings(settings: RouterSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(routerSettingsStorageKey, JSON.stringify({ ...settings, password: "" }));
}

export function validateRouterSettings(settings: RouterSettings): string | null {
  if (!settings.name.trim()) {
    return "Renseignez le nom du routeur.";
  }

  if (!settings.ipAddress.trim()) {
    return "Renseignez l'adresse IP.";
  }

  if (!Number(settings.apiPort) || !Number(settings.apiSslPort)) {
    return "Renseignez des ports API valides.";
  }

  if (!settings.username.trim()) {
    return "Renseignez l'utilisateur MikroTik.";
  }

  return null;
}

export function canEditRouterSensitiveSettings(role: string | null | undefined): boolean {
  return role === "admin";
}

export function canViewRouterSettings(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}
