import type { AuthSession } from "../../domain/auth";
import type { HotspotPlanRecord, RouterConnectionRecord, RouterRecord } from "../../domain/database";
import type { DatabaseClient } from "../database/DatabaseClient";
import { DatabaseRouterActionLogger } from "../logging";
import { decryptLocalSecret, isEncryptedLocalSecret } from "../security/localSecrets";
import { MikroTikRouterAdapter } from "./MikroTikRouterAdapter";
import { PersistedPlanMappingRouterAdapter } from "./PersistedPlanMappingRouterAdapter";
import type { RouterAdapter } from "./RouterAdapter";
import { RouterService, type RouterActionLogger } from "./RouterService";

export async function createPersistedRouterService(input: {
  router: RouterRecord;
  connections?: RouterConnectionRecord[];
  authSession?: AuthSession | null;
  logger?: RouterActionLogger;
  database?: DatabaseClient;
}): Promise<RouterService> {
  const { router, connections = [] } = input;
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

  const mikrotikAdapter = await selectReachableAdapter(router, connections, password);
  const plans = input.database
    ? await input.database.query<HotspotPlanRecord>(
        "SELECT * FROM hotspot_plans WHERE router_id = ?1 AND deleted_at IS NULL",
        [router.id]
      )
    : [];
  const adapter: RouterAdapter = plans.length > 0
    ? new PersistedPlanMappingRouterAdapter(mikrotikAdapter, plans)
    : mikrotikAdapter;

  return new RouterService({
    adapter,
    authSession: input.authSession,
    logger
  });
}

async function resolvePersistedRouterPassword(value: string): Promise<string> {
  if (!isEncryptedLocalSecret(value)) {
    throw new Error("Le mot de passe du routeur doit être ressaisi avant la synchronisation.");
  }
  return decryptLocalSecret(value);
}

async function selectReachableAdapter(
  router: RouterRecord,
  storedConnections: RouterConnectionRecord[],
  password: string
): Promise<MikroTikRouterAdapter> {
  const connections = orderConnections(router, storedConnections);
  const adapters = connections.map((connection) =>
    new MikroTikRouterAdapter({
      connectionMode: connection.mode,
      host: connection.host,
      password,
      port: connection.port,
      timeoutMs: 5000,
      useSsl: connection.use_ssl === 1,
      username: router.username
    })
  );
  const fallback = adapters[0] ?? new MikroTikRouterAdapter({
    connectionMode: "local",
    host: router.local_ip,
    password,
    port: router.api_port,
    timeoutMs: 5000,
    useSsl: false,
    username: router.username
  });

  if (adapters.length <= 1) return fallback;

  for (const adapter of adapters) {
    try {
      await adapter.testConnection();
      return adapter;
    } catch {
      // Try the next known endpoint. The selected adapter exposes the exact
      // RouterOS error when the requested action is executed.
    }
  }

  return fallback;
}

function orderConnections(router: RouterRecord, storedConnections: RouterConnectionRecord[]): RouterConnectionRecord[] {
  const connections = storedConnections.map((connection) =>
    connection.mode === "vpn" ? { ...connection, port: 8728, use_ssl: 0 } : connection
  );
  if (!connections.some((connection) => connection.mode === "local")) {
    connections.push({
      created_at: "",
      deleted_at: null,
      host: router.local_ip,
      id: `${router.id}:local-runtime`,
      last_connected_at: null,
      last_error: null,
      mode: "local",
      port: router.api_port,
      router_id: router.id,
      status: "inactive",
      sync_status: "local",
      updated_at: "",
      use_ssl: 0
    });
  }

  const modeWeight = (connection: RouterConnectionRecord): number => {
    if (connection.mode === router.connection_mode) return 0;
    if (connection.mode === "local") return 1;
    if (connection.mode === "vpn") return 2;
    if (connection.mode === "distant_ip") return 3;
    return 4;
  };

  return connections
    .filter((connection) => connection.mode !== "agent_future" && connection.host.trim().length > 0)
    .sort((left, right) => modeWeight(left) - modeWeight(right));
}
