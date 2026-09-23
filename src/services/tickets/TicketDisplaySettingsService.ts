import type { DatabaseClient } from "../database";
import { AppSettingsRepository } from "../database/repositories";

export type TicketDisplaySettings = {
  titleMode: "wifi" | "company" | "custom";
  customTitle: string;
  showTicketNumber: boolean;
  showPlanName: boolean;
  showZoneName: boolean;
  showUsername: boolean;
  showPassword: boolean;
  showPrice: boolean;
  currency: string;
  showDuration: boolean;
  showValidity: boolean;
  showDataLimit: boolean;
  showCreatedAt: boolean;
  showExpiresAt: boolean;
  showContact: boolean;
  contactNumber: string;
  showLogo: boolean;
  showQrCode: boolean;
  showInstructions: boolean;
  showNote: boolean;
  noteText: string;
  showPoweredBy: boolean;
};

export const defaultTicketDisplaySettings: TicketDisplaySettings = {
  contactNumber: "",
  currency: "CFA",
  customTitle: "",
  noteText: "Conservez ce ticket jusqu'à expiration",
  showContact: false,
  showCreatedAt: false,
  showDataLimit: true,
  showDuration: true,
  showExpiresAt: true,
  showInstructions: true,
  showLogo: false,
  showNote: false,
  showPassword: true,
  showPlanName: false,
  showPoweredBy: true,
  showPrice: true,
  showQrCode: false,
  showTicketNumber: true,
  showUsername: true,
  showValidity: true,
  showZoneName: true,
  titleMode: "wifi"
};

export class TicketDisplaySettingsService {
  private readonly settings: AppSettingsRepository;

  constructor(database: DatabaseClient) {
    this.settings = new AppSettingsRepository(database);
  }

  async get(accountId: string, routerId: string): Promise<TicketDisplaySettings> {
    const stored = await this.settings.get(this.key(accountId, routerId));
    if (!stored) return { ...defaultTicketDisplaySettings };
    try {
      const parsed = JSON.parse(stored) as Partial<TicketDisplaySettings>;
      return normalizeTicketDisplaySettings(parsed);
    } catch {
      return { ...defaultTicketDisplaySettings };
    }
  }

  async save(accountId: string, routerId: string, value: TicketDisplaySettings): Promise<void> {
    await this.settings.set(this.key(accountId, routerId), JSON.stringify(value));
  }

  private key(accountId: string, routerId: string): string {
    return `router.ticket_display_settings.${accountId}.${routerId}`;
  }
}

export function normalizeTicketDisplaySettings(
  value: Partial<TicketDisplaySettings>
): TicketDisplaySettings {
  const normalized = { ...defaultTicketDisplaySettings };
  const booleanKeys: Array<keyof TicketDisplaySettings> = [
    "showContact",
    "showCreatedAt",
    "showDataLimit",
    "showDuration",
    "showExpiresAt",
    "showInstructions",
    "showLogo",
    "showNote",
    "showPassword",
    "showPlanName",
    "showPoweredBy",
    "showPrice",
    "showQrCode",
    "showTicketNumber",
    "showUsername",
    "showValidity",
    "showZoneName"
  ];

  for (const key of booleanKeys) {
    if (typeof value[key] === "boolean") {
      Object.assign(normalized, { [key]: value[key] });
    }
  }

  normalized.titleMode = ["wifi", "company", "custom"].includes(value.titleMode ?? "")
    ? value.titleMode as TicketDisplaySettings["titleMode"]
    : "wifi";
  normalized.customTitle = typeof value.customTitle === "string" ? value.customTitle.slice(0, 80) : "";
  normalized.currency = typeof value.currency === "string" && value.currency.trim()
    ? value.currency.trim().slice(0, 12)
    : "CFA";
  normalized.contactNumber = typeof value.contactNumber === "string" ? value.contactNumber.slice(0, 40) : "";
  normalized.noteText = typeof value.noteText === "string" && value.noteText.trim()
    ? value.noteText.trim().slice(0, 140)
    : defaultTicketDisplaySettings.noteText;

  // Ces informations sont structurelles : elles ne peuvent pas être masquées.
  normalized.showUsername = true;
  normalized.showPassword = true;
  normalized.showDuration = true;
  normalized.showValidity = true;
  return normalized;
}

export function resolveTicketTitle(
  settings: TicketDisplaySettings,
  wifiName: string,
  companyName: string | null | undefined
): string {
  if (settings.titleMode === "custom" && settings.customTitle.trim()) {
    return settings.customTitle.trim();
  }
  if (settings.titleMode === "company" && companyName?.trim()) {
    return companyName.trim();
  }
  return wifiName.trim() || "Accès WiFi";
}
