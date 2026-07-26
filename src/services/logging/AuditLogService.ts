import { AppLogRepository } from "../database/repositories/AppLogRepository";
import type { DatabaseClient } from "../database";

export type AuditLogInput = {
  accountId: string;
  action: string;
  category: string;
  internalProfileId: string | null;
  level?: "critical" | "error" | "info" | "warning";
  message: string;
  technicalMessage?: string | null;
};

export class AuditLogService {
  private readonly repository: AppLogRepository;

  constructor(private readonly database: DatabaseClient) {
    this.repository = new AppLogRepository(database);
  }

  async write(input: AuditLogInput): Promise<void> {
    try {
      await this.repository.create({
        account_id: input.accountId,
        category: input.category,
        created_by_profile: input.internalProfileId,
        id: `audit-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        internal_profile_id: input.internalProfileId,
        level: input.level ?? "info",
        router_id: null,
        technical_message: input.technicalMessage ?? null,
        user_message: `[${input.action}] ${input.message}`
      });
    } catch {
      // Une panne d'audit ne doit pas bloquer l'action métier déjà réalisée.
    }
  }
}
