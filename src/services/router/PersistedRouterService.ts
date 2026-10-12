import type { AuthSession } from "../../domain/auth";
import type { HotspotPlanRecord, RouterConnectionRecord, RouterRecord } from "../../domain/database";
import type { DatabaseClient } from "../database/DatabaseClient";
import { DatabaseRouterActionLogger } from "../logging";
import { decryptLocalSecret, isEncryptedLocalSecret } from "../security/localSecrets";
import { CompatibleMikroTikRouterAdapter } from "./CompatibleMikroTikRouterAdapter";
import { PersistedPlanMappingRouterAdapter } from "./PersistedPlanMappingRouterAdapter";
import type { RouterAdapter } from "./RouterAdapter";
import { RouterService, type RouterActionLogger } from "./RouterService";

export async function createPersistedRouterService(input: {
  router: RouterRecord;
  connections?: RouterConnectionRecord[];
  authSession?: AuthSession | null;
  logger?: RouterActionLogger;
  database?: DatabaseClient;
  logActions?: boolean;
}): Promise<RouterService> {
  const { router, connections = [] } = input;
  const current = input.database
    ? (await input.database.query<RouterRecord>("SELECT * FROM routers WHERE id = ?1", [router.id]))[0]
    : router;
  if (!current || current.deleted_at || router.deleted_at) {
    throw new Error("Ce routeur a été supprimé. Actualisez la liste des routeurs.");
  }
  const password = await resolvePersistedRouterPassword(router.encrypted_password);

  const databaseLogger = input.database && input.logActions !== false
    ? new DatabaseRouterActionLogger(input.database)
    : null;
  const logger = input.logger || databaseLogger
    ? {
        write: async (log: Parameters<RouterActionLogger["write"]>[0]) => {
          const routerLog = { ...log, routerId: log.routerId ?? router.id };
          await Promise.all([
            input.logger?.write(routerLog),
            databaseLogger?.write(routerLog)
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
): Promise<CompatibleMikroTikRouterAdapter> {
  const connections = orderConnections(router, storedConnections);
  const adapters = connections.map((connection) =>
    new CompatibleMikroTikRouterAdapter({
      connectionMode: connection.mode,
      host: connection.host,
      password,
      port: connection.port,
      retries: connection.mode === "local" ? 1 : 2,
      timeoutMs: connection.mode === "local" ? 5000 : 10000,
      useSsl: connection.use_ssl === 1,
      username: router.username
    })
  );
  const fallback = adapters[0] ?? new CompatibleMikroTikRouterAdapter({
    connectionMode: "local",
    host: router.local_ip,
    password,
    port: router.api_port,
    timeoutMs: 5000,
    useSsl: false,
    username: router.username
  });

  if (adapters.length <= 1) return fallback;
  return pickReachableAdapter(router.id, connections.map(endpointKey), adapters, fallback);
}

/** Endpoint that answered last, per router, so the next page opens on it at once. */
const reachableEndpointByRouter = new Map<string, { key: string; at: number }>();
const REACHABLE_ENDPOINT_TTL_MS = 10 * 60_000;
/** Once a lower-priority endpoint answers, how long a preferred one may still win. */
const PREFERRED_ENDPOINT_GRACE_MS = 1_500;
const REMEMBERED_ENDPOINT_PROBE_MS = 4_000;

function endpointKey(connection: Pick<RouterConnectionRecord, "host" | "mode" | "port">): string {
  return `${connection.mode}|${connection.host.trim()}|${connection.port}`;
}

/** Test helper: forget the endpoints remembered by previous connections. */
export function resetReachableEndpointCache(): void {
  reachableEndpointByRouter.clear();
}

/**
 * Selects the endpoint to use. The one that answered last is tried alone
 * first (one round trip on a pooled connection). Otherwise every endpoint is
 * tested at the same time instead of one after the other, so a dead local
 * address no longer delays the VPN by its whole timeout: the preferred
 * endpoint wins if it answers, a working one is used as soon as the preferred
 * ones failed or stayed silent for a short grace period.
 */
export async function pickReachableAdapter<T extends { testConnection(): Promise<unknown> }>(
  routerId: string,
  keys: string[],
  adapters: T[],
  fallback: T,
  now: () => number = Date.now
): Promise<T> {
  const remembered = reachableEndpointByRouter.get(routerId);
  const rememberedIndex = remembered && now() - remembered.at <= REACHABLE_ENDPOINT_TTL_MS
    ? keys.indexOf(remembered.key)
    : -1;
  if (rememberedIndex >= 0) {
    try {
      // A remembered endpoint that went silent must not cost its full
      // timeout: past a few seconds every endpoint is tested again.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        adapters[rememberedIndex].testConnection(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), REMEMBERED_ENDPOINT_PROBE_MS);
        })
      ]).finally(() => clearTimeout(timer));
      reachableEndpointByRouter.set(routerId, { at: now(), key: keys[rememberedIndex] });
      return adapters[rememberedIndex];
    } catch {
      reachableEndpointByRouter.delete(routerId);
    }
  }

  const outcomes: Array<"pending" | "ok" | "failed"> = adapters.map(() => "pending");
  return new Promise<T>((resolve) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const choose = (index: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      if (index === null) {
        resolve(fallback);
        return;
      }
      reachableEndpointByRouter.set(routerId, { at: now(), key: keys[index] });
      resolve(adapters[index]);
    };
    const decide = (graceElapsed: boolean) => {
      const firstOk = outcomes.indexOf("ok");
      if (firstOk === -1) {
        if (outcomes.every((outcome) => outcome === "failed")) choose(null);
        return;
      }
      const preferredStillPending = outcomes.slice(0, firstOk).some((outcome) => outcome === "pending");
      if (!preferredStillPending || graceElapsed) {
        choose(firstOk);
      } else if (graceTimer === undefined) {
        graceTimer = setTimeout(() => decide(true), PREFERRED_ENDPOINT_GRACE_MS);
      }
    };
    adapters.forEach((adapter, index) => {
      adapter.testConnection().then(
        () => { outcomes[index] = "ok"; decide(false); },
        () => { outcomes[index] = "failed"; decide(false); }
      );
    });
  });
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

