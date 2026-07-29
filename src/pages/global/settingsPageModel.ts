import type { UserRole } from "../../domain/auth";

export type AppSettings = {
  sessionTimeoutMinutes: number;
};

export const defaultAppSettings: AppSettings = {
  sessionTimeoutMinutes: 30
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
  if (settings.sessionTimeoutMinutes < 5 || settings.sessionTimeoutMinutes > 480) {
    return "Le délai de session doit être entre 5 et 480 minutes.";
  }

  return null;
}

export function canEditSensitiveSettings(role: UserRole | null | undefined): boolean {
  return role === "admin";
}
