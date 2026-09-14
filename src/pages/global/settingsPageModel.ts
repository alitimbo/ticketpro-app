import type { UserRole } from "../../domain/auth";

export type AppSettings = {
  sessionTimeoutMinutes: number;
};

export const defaultAppSettings: AppSettings = {
  sessionTimeoutMinutes: 15 * 24 * 60
};

const appSettingsStorageKey = "hotspot:app_settings";

export function loadAppSettings(): AppSettings {
  if (typeof localStorage === "undefined") {
    return defaultAppSettings;
  }

  try {
    return { ...defaultAppSettings, ...JSON.parse(localStorage.getItem(appSettingsStorageKey) ?? "{}") };
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings));
}

export function validateAppSettings(settings: AppSettings): string | null {
  if (settings.sessionTimeoutMinutes < 5 || settings.sessionTimeoutMinutes > 30 * 24 * 60) {
    return "Le délai de session doit être entre 5 minutes et 1 mois.";
  }

  return null;
}

export function canEditSensitiveSettings(role: UserRole | null | undefined): boolean {
  return role === "admin";
}
