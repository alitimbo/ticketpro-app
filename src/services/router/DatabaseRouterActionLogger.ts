import type { DatabaseClient } from "../database";
import { assertAccountProfileOwnership } from "../database/ownership";
import type { RouterActionLog, RouterActionLogger } from "./RouterService";
import { serializeTechnicalMessage } from "../logging/technicalMessage";

type DatabaseRouterActionLoggerOptions = {
  accountId?: string;
  internalProfileRole?: string;
  internalProfileId?: string;
};

export class DatabaseRouterActionLogger implements RouterActionLogger {
  constructor(
    private readonly database: DatabaseClient,
    private readonly options: DatabaseRouterActionLoggerOptions = {}
  ) {}

  async write(log: RouterActionLog): Promise<void> {
    const { accountId, internalProfileId } = assertAccountProfileOwnership(
      log.accountId ?? this.options.accountId,
      log.internalProfileId ?? this.options.internalProfileId
    );

    await this.database.execute(
      `INSERT INTO app_logs (
        id, account_id, level, category, user_message, technical_message, router_id, created_by_profile, internal_profile_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      [
        crypto.randomUUID(),
        accountId,
        log.level,
        "router",
        log.userMessage,
        serializeTechnicalMessage({
          action: log.action,
          code: log.technicalCode,
          detail: log.technicalMessage
        }),
        log.routerId ?? null,
        log.internalProfileRole ?? this.options.internalProfileRole ?? null,
        internalProfileId
      ]
    );
  }
}
