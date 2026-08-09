import type { DatabaseClient } from "../database";
import { AppSettingsRepository } from "../database/repositories";

export type TicketDisplaySettings = {
  showZoneName: boolean;
  showUsername: boolean;
  showPassword: boolean;
  showPrice: boolean;
  showDuration: boolean;
  showDataLimit: boolean;
  showCreatedAt: boolean;
  showExpiresAt: boolean;
  showContact: boolean;
  showLogo: boolean;
  showQrCode: boolean;
  showInstructions: boolean;
};

export const defaultTicketDisplaySettings: TicketDisplaySettings = {
  showContact: true,
  showCreatedAt: false,
  showDataLimit: true,
  showDuration: true,
  showExpiresAt: false,
  showInstructions: true,
  showLogo: true,
  showPassword: true,
  showPrice: true,
  showQrCode: false,
  showUsername: true,
  showZoneName: true
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
      return Object.fromEntries(
        Object.entries(defaultTicketDisplaySettings).map(([key, fallback]) => [
          key,
          typeof parsed[key as keyof TicketDisplaySettings] === "boolean"
            ? parsed[key as keyof TicketDisplaySettings]
            : fallback
        ])
      ) as TicketDisplaySettings;
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
