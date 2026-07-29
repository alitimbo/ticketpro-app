import type { DatabaseClient } from "../database";
import { AppLogRepository } from "../database/repositories/AppLogRepository";
import type { RouterActionLog } from "../router";
import { serializeTechnicalMessage } from "./technicalMessage";

export class DatabaseRouterActionLogger {
  private readonly repository: AppLogRepository;

  constructor(private readonly database: DatabaseClient) {
    this.repository = new AppLogRepository(database);
  }

  async write(log: RouterActionLog): Promise<void> {
    try {
      await this.repository.create({
        account_id: log.accountId ?? null,
        category: categoryForAction(log.action),
        created_by_profile: log.internalProfileRole ?? null,
        id: createId("log"),
        internal_profile_id: log.internalProfileId ?? null,
        level: log.level,
        router_id: log.routerId ?? null,
        technical_message: serializeTechnicalMessage({
          action: log.action,
          code: log.technicalCode,
          detail: log.technicalMessage
        }),
        user_message: log.userMessage
      });
    } catch {
      // Une panne de journalisation ne doit jamais faire échouer l'action métier.
    }
  }
}

function categoryForAction(action: string): string {
  const normalized = action.toLowerCase();

  if (normalized.includes("client") || normalized.includes("activeuser")) {
    return "clients_connectes";
  }

  if (normalized.includes("monitor") || normalized.includes("health") || normalized.includes("traffic")) {
    return "monitoring";
  }

  if (normalized.includes("plan")) {
    return "plans";
  }

  if (normalized.includes("sync") || normalized.includes("compare")) {
    return "synchronisation";
  }

  if (normalized.includes("ticket") || normalized.includes("user")) {
    return "tickets";
  }

  return "routeur";
}

function createId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
