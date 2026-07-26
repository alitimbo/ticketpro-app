import type { AuthSession } from "../../domain/auth";
import type { RouterConnectionRecord, RouterRecord } from "../../domain/database";
import type { DatabaseClient } from "../database/DatabaseClient";
import { DatabaseRouterActionLogger } from "../logging";
import { decryptLocalSecret, isEncryptedLocalSecret } from "../security/localSecrets";
import { RouterService, type RouterActionLogger } from "./RouterService";

export async function createPersistedRouterService(input: {
  router: RouterRecord;
  connections?: RouterConnectionRecord[];
  authSession?: AuthSession | null;
  logger?: RouterActionLogger;
  database?: DatabaseClient;
}): Promise<RouterService> {
  const { router, connections = [] } = input;
  const connection = selectConnection(router, connections);
  const password = await resolvePersistedRouterPassword(router.encrypted_password);

  const databaseLogger = input.database ? new DatabaseRouterActionLogger(input.database) : null;
  const logger = input.logger || databaseLogger
    ? {
        write: async (log: Parameters<RouterActionLogger["write"]>[0]) => {
          await Promise.all([
            input.logger?.write(log),
            databaseLogger?.write(log)
          ]);
        }
      }
    : undefined;

  return new RouterService({
    authSession: input.authSession,
    logger,
    mikrotik: {
      connectionMode: router.connection_mode,
      host: connection?.host ?? router.local_ip,
      password,
      port: connection?.port ?? router.api_port,
      timeoutMs: 5000,
      useSsl: connection ? connection.use_ssl === 1 : false,
      username: router.username
    },
    mode: "mikrotik"
  });
}

async function resolvePersistedRouterPassword(value: string): Promise<string> {
  if (!isEncryptedLocalSecret(value)) {
    throw new Error("Le mot de passe du routeur doit être ressaisi avant la synchronisation.");
  }

  return decryptLocalSecret(value);
}

function selectConnection(router: RouterRecord, connections: RouterConnectionRecord[]): RouterConnectionRecord | undefined {
  if (router.connection_mode === "local") {
    return connections.find((connection) => connection.mode === "local");
  }

  return (
    connections.find((connection) => connection.mode === router.connection_mode) ??
    connections.find((connection) => connection.mode !== "local")
  );
}
