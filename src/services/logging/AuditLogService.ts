import { AppLogRepository } from "../database/repositories/AppLogRepository";
import type { DatabaseClient } from "../database";
import type { UserRole } from "../../domain/auth";
import { serializeTechnicalMessage } from "./technicalMessage";

export type AuditLogInput = {
  accountId: string;
  action: string;
  category: string;
  internalProfileId: string | null;
  internalProfileRole?: UserRole | null;
  level?: "critical" | "error" | "info" | "warning";
  message: string;
  routerId?: string | null;
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
        created_by_profile:
          input.internalProfileRole ?? roleFromProfileId(input.internalProfileId),
        id: `audit-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        internal_profile_id: input.internalProfileId,
        level: input.level ?? "info",
        router_id: input.routerId ?? null,
        technical_message: serializeTechnicalMessage({
          action: input.action,
          detail: input.technicalMessage
        }),
        user_message: input.message
      });
    } catch {
      // Une panne d'audit ne doit pas bloquer l'action métier déjà réalisée.
    }
  }
}

function roleFromProfileId(profileId: string | null): string | null {
  if (!profileId) return null;
  const role = ["admin", "operator", "agent", "guest"].find(
    (candidate) =>
      profileId === candidate ||
      profileId.endsWith(`-${candidate}`) ||
      profileId.endsWith(`:${candidate}`)
  );
  return role ?? null;
}
