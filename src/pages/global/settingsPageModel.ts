import type { UserRole } from "../../domain/auth";

export type AppSettings = {
  backupFolder: string;
  currency: "CFA";
  exportFolder: string;
  language: "fr";
  pdfFolder: string;
  printEconomical: boolean;
  printFormat: "a4" | "thermal58" | "thermal80";
  sessionTimeoutMinutes: number;
  theme: "light";
};

export type ProfilePasswordDraft = Partial<Record<UserRole, string>>;

export const defaultAppSettings: AppSettings = {
  backupFolder: "C:\\TicketPro\\backups",
  currency: "CFA",
  exportFolder: "C:\\TicketPro\\exports",
  language: "fr",
  pdfFolder: "C:\\TicketPro\\pdf",
  printEconomical: true,
  printFormat: "thermal80",
  sessionTimeoutMinutes: 30,
  theme: "light"
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
  if (!settings.pdfFolder.trim()) {
    return "Renseignez le dossier PDF.";
  }

  if (!settings.exportFolder.trim()) {
    return "Renseignez le dossier exports.";
  }

  if (!settings.backupFolder.trim()) {
    return "Renseignez le dossier de sauvegarde.";
  }

  if (settings.sessionTimeoutMinutes < 5 || settings.sessionTimeoutMinutes > 480) {
    return "Le délai de session doit être entre 5 et 480 minutes.";
  }

  return null;
}

export function countPasswordChanges(passwords: ProfilePasswordDraft): number {
  return Object.values(passwords).filter((password) => password?.trim()).length;
}

export function canEditSensitiveSettings(role: UserRole | null | undefined): boolean {
  return role === "admin";
}
