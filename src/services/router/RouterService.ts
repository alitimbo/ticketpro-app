import type {
  ActiveHotspotUser,
  CreatedTicket,
  HotspotPlan,
  HotspotPlanDraft,
  HotspotServer,
  HotspotUser,
  HotspotUserDraft,
  HotspotUsersBatchDraft,
  InterfaceTraffic,
  RouterConnectionTest,
  RouterDateTime,
  RouterErrorCode,
  RouterHealth,
  RouterVoucherDecommissionProgress,
  RouterVoucherDecommissionReport,
  RouterSummary,
  RouterSystemInfo,
  TicketDraft
} from "../../domain/router";
import type { AuthSession, Permission } from "../../domain/auth";
import { AuthorizationError, requireProfilePermission } from "../auth";
import { CompatibleMikroTikRouterAdapter } from "./CompatibleMikroTikRouterAdapter";
import { FakeRouterAdapter } from "./FakeRouterAdapter";
import {
  FakeLocalRouterDiscoveryProvider,
  type DiscoveredRouterCandidate,
  type LocalRouterDiscoveryProvider
} from "./LocalRouterDiscoveryProvider";
import type { MikroTikRouterAdapterOptions } from "./MikroTikRouterAdapter";
import {
  PreparedRemoteConnectionProvider,
  type RemoteConnectionProvider,
  type RemoteConnectionRequest
} from "./RemoteConnectionProvider";
import type {
  HotspotUserBatchCreationProgress,
  HotspotUserBatchCreationResult,
  HotspotUserBatchRemovalProgress,
  HotspotUserBatchRemovalResult,
  RouterAdapter
} from "./RouterAdapter";
import { runExactHotspotUserCreationFallback } from "./RouterAdapter";
import { isRouterAdapterError } from "./RouterAdapterError";

export type RouterAdapterMode = "fake" | "mikrotik";

export type RouterActionLog = {
  action: string;
  accountId?: string;
  internalProfileId?: string;
  internalProfileRole?: string;
  level: "error" | "info";
  routerId?: string;
  technicalCode?: RouterErrorCode;
  technicalMessage?: string;
  userMessage: string;
};

export interface RouterActionLogger {
  write(log: RouterActionLog): Promise<void> | void;
}

export type RouterServiceOptions = {
  adapter?: RouterAdapter;
  discoveryProvider?: LocalRouterDiscoveryProvider;
  logger?: RouterActionLogger;
  mikrotik?: MikroTikRouterAdapterOptions;
  mode?: RouterAdapterMode;
  authSession?: AuthSession | null;
  remoteProvider?: RemoteConnectionProvider;
};

export class RouterService {
  private readonly adapter: RouterAdapter;
  private readonly discoveryProvider: LocalRouterDiscoveryProvider;
  private readonly logger: RouterActionLogger;
  private readonly authSession: AuthSession | null | undefined;
  private readonly remoteProvider: RemoteConnectionProvider;

  constructor(options: RouterServiceOptions | RouterAdapter = {}) {
    if (isRouterAdapter(options)) {
      this.adapter = options;
      this.discoveryProvider = new FakeLocalRouterDiscoveryProvider();
      this.logger = new NoopRouterActionLogger();
      this.authSession = undefined;
      this.remoteProvider = new PreparedRemoteConnectionProvider();
      return;
    }

    const serviceOptions = options as RouterServiceOptions;
    this.adapter = serviceOptions.adapter ?? this.createAdapter(serviceOptions.mode ?? "fake", serviceOptions.mikrotik);
    this.discoveryProvider = serviceOptions.discoveryProvider ?? new FakeLocalRouterDiscoveryProvider();
    this.logger = serviceOptions.logger ?? new NoopRouterActionLogger();
    this.authSession = serviceOptions.authSession;
    this.remoteProvider = serviceOptions.remoteProvider ?? new PreparedRemoteConnectionProvider();
  }

  async listRouters(): Promise<RouterSummary[]> {
    if ("listRouters" in this.adapter && typeof this.adapter.listRouters === "function") {
      return this.adapter.listRouters();
    }

    return [
      {
        connectionMode: "local",
        host: "192.168.88.1",
        id: "routeur-demo",
        isReachable: true,
        name: "Routeur démo"
      }
    ];
  }

  testConnection() {
    return this.run("testConnection", () => this.adapter.testConnection());
  }

  resolveRemoteConnection(request: RemoteConnectionRequest) {
    return this.run("resolveRemoteConnection", () => this.remoteProvider.resolveEndpoint(request));
  }

  scanLocalRouters(): Promise<DiscoveredRouterCandidate[]> {
    return this.run("scanLocalRouters", () => this.discoveryProvider.scan());
  }

  getSystemInfo() {
    return this.run("getSystemInfo", () => this.adapter.getSystemInfo());
  }

  getHotspotServers() {
    return this.run("getHotspotServers", () => this.adapter.getHotspotServers());
  }

  upsertHotspotDns(dnsName: string) {
    return this.run("upsertHotspotDns", () => this.adapter.upsertHotspotDns(dnsName));
  }

  getHotspotPlans() {
    return this.run("getHotspotPlans", () => this.adapter.getHotspotPlans());
  }

  ensureVoucherLifecycleEngine(options?: import("../../domain/router").VoucherLifecycleEngineOptions) {
    return this.run(
      "ensureVoucherLifecycleEngine",
      () => this.adapter.ensureVoucherLifecycleEngine(options)
    );
  }

  inspectManagedResources(options?: import("../../domain/router").RouterManagedResourceInspectionOptions) {
    return this.run(
      "inspectManagedResources",
      () => this.adapter.inspectManagedResources(options)
    );
  }

  upsertManagementAccount(config: import("../../domain/router").RouterManagementAccountConfig) {
    return this.run(
      "upsertManagementAccount",
      () => this.adapter.upsertManagementAccount(config),
      "router.settings.manage"
    );
  }

  applyManagementServicePolicy(policy: import("../../domain/router").RouterManagementServicePolicy) {
    return this.run(
      "applyManagementServicePolicy",
      () => this.adapter.applyManagementServicePolicy(policy),
      "router.settings.manage"
    );
  }

  createHotspotPlan(plan: HotspotPlanDraft) {
    return this.run("createHotspotPlan", () => this.adapter.createHotspotPlan(plan), "router.plans.write");
  }

  updateHotspotPlan(planId: string, updates: Partial<HotspotPlanDraft>) {
    return this.run("updateHotspotPlan", () => this.adapter.updateHotspotPlan(planId, updates), "router.plans.write");
  }

  deleteHotspotPlan(planId: string) {
    return this.run("deleteHotspotPlan", () => this.adapter.deleteHotspotPlan(planId), "router.plans.write");
  }

  listHotspotUsers() {
    return this.run("listHotspotUsers", () => this.adapter.listHotspotUsers());
  }

  listHotspotUsersForVerification() {
    return this.run("listHotspotUsersForVerification", () =>
      this.adapter.listHotspotUsersForVerification
        ? this.adapter.listHotspotUsersForVerification()
        : this.adapter.listHotspotUsers()
    );
  }

  setHotspotUserQuota(username: string, limitBytesTotal: number) {
    return this.run("setHotspotUserQuota", async () => {
      if (!this.adapter.setHotspotUserQuota) {
        throw new RouterServiceError("router_rejected", "Ce routeur ne permet pas de corriger le quota d'un voucher.");
      }
      return this.adapter.setHotspotUserQuota(username, limitBytesTotal);
    }, "router.tickets.sync");
  }

  listHotspotUsersByUsernames(usernames: string[]) {
    return this.run("listHotspotUsersByUsernames", async () => {
      if (usernames.length === 0) return [];
      if (this.adapter.listHotspotUsersByUsernames) {
        return this.adapter.listHotspotUsersByUsernames(usernames);
      }
      const requested = new Set(usernames);
      const users = this.adapter.listHotspotUsersForVerification
        ? await this.adapter.listHotspotUsersForVerification()
        : await this.adapter.listHotspotUsers();
      return users.filter((user) => requested.has(user.username));
    });
  }

  configureVoucherFirstMacLock(enabled: boolean, managedProfileNames: string[]) {
    return this.run("configureVoucherFirstMacLock", async () => {
      if (!this.adapter.configureVoucherFirstMacLock) {
        throw new RouterServiceError("router_rejected", "Ce routeur ne permet pas le verrouillage MAC automatique.");
      }
      return this.adapter.configureVoucherFirstMacLock(enabled, managedProfileNames);
    }, "router.settings.manage");
  }

  listHotspotUsernames() {
    return this.run("listHotspotUsernames", async () =>
      this.adapter.listHotspotUsernames
        ? this.adapter.listHotspotUsernames()
        : (await this.adapter.listHotspotUsers()).map((user) => ({ username: user.username }))
    );
  }

  findHotspotUser(username: string) {
    return this.run("findHotspotUser", () => this.adapter.findHotspotUser(username));
  }

  updateHotspotUser(
    username: string,
    planId: string,
    limits?: import("../../domain/router").HotspotUserLimits
  ) {
    return this.run(
      "updateHotspotUser",
      () => this.adapter.updateHotspotUser(username, planId, limits),
      "router.tickets.generate"
    );
  }

  createHotspotUser(user: HotspotUserDraft) {
    return this.run("createHotspotUser", () => this.adapter.createHotspotUser(user), "router.tickets.generate");
  }

  createHotspotUsersExactBatch(
    users: HotspotUserDraft[],
    onProgress?: (progress: HotspotUserBatchCreationProgress) => void
  ): Promise<HotspotUserBatchCreationResult[]> {
    return this.run("createHotspotUsersExactBatch", async () => {
      if (this.adapter.createHotspotUsersExactBatch) {
        return this.adapter.createHotspotUsersExactBatch(users, onProgress);
      }

      return runExactHotspotUserCreationFallback(this.adapter, users, onProgress);
    }, "router.tickets.generate");
  }

  createHotspotUsersBatch(batch: HotspotUsersBatchDraft) {
    return this.run("createHotspotUsersBatch", () => this.adapter.createHotspotUsersBatch(batch), "router.tickets.generate");
  }

  async createTickets(_routerId: string, draft: TicketDraft): Promise<CreatedTicket[]> {
    this.ensurePermission("router.tickets.generate");
    const users = await this.createHotspotUsersBatch({
      codeLength: draft.codeLength ?? 6,
      planId: draft.planId,
      prefix: draft.prefix ?? "",
      quantity: draft.quantity
    });

    return users.map((user) => ({
      createdAt: user.createdAt,
      id: user.id,
      passwordSecretRef: user.passwordSecretRef,
      planId: user.planId,
      username: user.username
    }));
  }

  disableHotspotUser(username: string) {
    return this.run("disableHotspotUser", () => this.adapter.disableHotspotUser(username), "router.tickets.disable");
  }

  enableHotspotUser(username: string) {
    return this.run("enableHotspotUser", () => this.adapter.enableHotspotUser(username), "router.tickets.disable");
  }

  removeHotspotUser(username: string) {
    return this.run("removeHotspotUser", () => this.adapter.removeHotspotUser(username), "router.tickets.delete");
  }

  removeHotspotUsersBatch(
    usernames: string[],
    batchId?: string,
    onProgress?: (progress: HotspotUserBatchRemovalProgress) => void
  ): Promise<HotspotUserBatchRemovalResult[]> {
    return this.run("removeHotspotUsersBatch", async () => {
      if (this.adapter.removeHotspotUsersBatch) {
        return this.adapter.removeHotspotUsersBatch(usernames, batchId, onProgress);
      }

      const results: HotspotUserBatchRemovalResult[] = [];
      onProgress?.({ completed: 0, phase: "removing", total: usernames.length });
      for (const username of usernames) {
        try {
          await this.adapter.removeHotspotUser(username);
          results.push({ status: "removed", username });
        } catch (error) {
          results.push({
            message: error instanceof Error ? error.message : "Suppression RouterOS impossible.",
            status: "error",
            username
          });
        }
        onProgress?.({ completed: results.length, phase: "removing", total: usernames.length });
      }
      onProgress?.({ completed: results.length, phase: "verifying", total: usernames.length });
      return results;
    }, "router.tickets.delete");
  }

  decommissionTicketProVouchers(
    onProgress?: (progress: RouterVoucherDecommissionProgress) => void
  ): Promise<RouterVoucherDecommissionReport> {
    return this.run("decommissionTicketProVouchers", async () => {
      onProgress?.({ completed: 0, phase: "inventory", total: 0 });
      const usernames = this.adapter.listTicketProManagedVoucherUsernames
        ? await this.adapter.listTicketProManagedVoucherUsernames()
        : (await this.adapter.listHotspotUsers())
          .filter((user) => user.comment?.startsWith("TicketPro:v1;"))
          .map((user) => user.username);
      onProgress?.({ completed: 0, phase: "removing", total: usernames.length });

      const results = usernames.length === 0
        ? []
        : this.adapter.removeHotspotUsersBatch
          ? await this.adapter.removeHotspotUsersBatch(usernames, undefined, (progress) => {
              onProgress?.({
                completed: progress.completed,
                phase: progress.phase,
                total: progress.total
              });
            })
          : await removeHotspotUsersFallback(this.adapter, usernames, onProgress);

      onProgress?.({ completed: usernames.length, phase: "verifying", total: usernames.length });
      const remainingManagedUserCount = this.adapter.listTicketProManagedVoucherUsernames
        ? (await this.adapter.listTicketProManagedVoucherUsernames()).length
        : (this.adapter.listHotspotUsersForVerification
            ? await this.adapter.listHotspotUsersForVerification()
            : await this.adapter.listHotspotUsers())
          .filter((user) => user.comment?.startsWith("TicketPro:v1;"))
          .length;
      const failedCount = results.filter((result) => result.status === "error").length;

      return {
        cleanupVersion: 1,
        failedCount,
        remainingAuthorizationCount: failedCount,
        remainingManagedUserCount,
        removedCount: results.filter((result) => result.status === "removed").length,
        requestedCount: usernames.length,
        verifiedAt: new Date().toISOString()
      };
    }, "global.routers.delete");
  }

  bindHotspotUserToMac(username: string, macAddress: string) {
    return this.run(
      "bindHotspotUserToMac",
      () => this.adapter.bindHotspotUserToMac(username, macAddress),
      "router.tickets.sync"
    );
  }

  clearHotspotUserMac(username: string) {
    return this.run(
      "clearHotspotUserMac",
      () => this.adapter.clearHotspotUserMac(username),
      "router.tickets.sync"
    );
  }

  configureHotspotUserLifecycle(username: string, validityMinutes: number | null) {
    return this.run(
      "configureHotspotUserLifecycle",
      () => this.adapter.configureHotspotUserLifecycle(username, validityMinutes)
    );
  }

  configureHotspotAntiTethering(
    config: import("../../domain/router").HotspotAntiTetheringConfig
  ) {
    return this.run(
      "configureHotspotAntiTethering",
      () => this.adapter.configureHotspotAntiTethering(config),
      "router.settings.manage"
    );
  }

  getHotspotAntiTetheringState() {
    return this.run(
      "getHotspotAntiTetheringState",
      () => this.adapter.getHotspotAntiTetheringState()
    );
  }

  upsertHotspotBypass(binding: import("../../domain/router").HotspotBypassBinding) {
    return this.run(
      "upsertHotspotBypass",
      () => this.adapter.upsertHotspotBypass(binding),
      "router.settings.manage"
    );
  }

  listManagedHotspotBypasses() {
    return this.run(
      "listManagedHotspotBypasses",
      () => this.adapter.listManagedHotspotBypasses()
    );
  }

  removeHotspotBypass(id: string, macAddress: string) {
    return this.run(
      "removeHotspotBypass",
      () => this.adapter.removeHotspotBypass(id, macAddress),
      "router.settings.manage"
    );
  }

  listActiveUsers() {
    return this.run("listActiveUsers", () => this.adapter.listActiveUsers());
  }

  disconnectActiveUser(username: string) {
    return this.run("disconnectActiveUser", () => this.adapter.disconnectActiveUser(username), "router.clients.disconnect");
  }

  getRouterHealth() {
    return this.run("getRouterHealth", () => this.adapter.getRouterHealth());
  }

  getInterfaceTraffic() {
    return this.run("getInterfaceTraffic", () => this.adapter.getInterfaceTraffic());
  }

  getRouterDateTime() {
    return this.run("getRouterDateTime", () => this.adapter.getRouterDateTime());
  }

  upsertHotspotBlockedDevice(binding: import("../../domain/router").HotspotBypassBinding) {
    return this.run(
      "upsertHotspotBlockedDevice",
      () => this.adapter.upsertHotspotBlockedDevice(binding),
      "router.settings.manage"
    );
  }

  listManagedHotspotBlockedDevices() {
    return this.run(
      "listManagedHotspotBlockedDevices",
      () => this.adapter.listManagedHotspotBlockedDevices()
    );
  }

  removeHotspotBlockedDevice(id: string, macAddress: string) {
    return this.run(
      "removeHotspotBlockedDevice",
      () => this.adapter.removeHotspotBlockedDevice(id, macAddress),
      "router.settings.manage"
    );
  }

  getWireGuardInstallation(interfaceName: string) {
    return this.run("getWireGuardInstallation", () => this.adapter.getWireGuardInstallation(interfaceName));
  }

  provisionWireGuard(config: import("../../domain/router").RouterWireGuardConfig) {
    return this.run("provisionWireGuard", () => this.adapter.provisionWireGuard(config));
  }

  removeWireGuardPeer(reference: import("../../domain/router").RouterWireGuardPeerReference) {
    return this.run("removeWireGuardPeer", () => this.adapter.removeWireGuardPeer(reference));
  }

  private createAdapter(mode: RouterAdapterMode, mikrotikOptions?: MikroTikRouterAdapterOptions): RouterAdapter {
    if (mode === "fake") {
      return new FakeRouterAdapter();
    }

    if (!mikrotikOptions) {
      throw new Error("Configuration routeur manquante.");
    }

    return new CompatibleMikroTikRouterAdapter(mikrotikOptions);
  }

  private async run<T>(action: string, callback: () => Promise<T>, permission?: Permission): Promise<T> {
    try {
      if (permission) {
        this.ensurePermission(permission);
      }
      const result = await callback();
      await this.logger.write({
        action,
        accountId: this.authSession?.account_id,
        internalProfileId: this.authSession?.internal_profile_id,
        internalProfileRole: this.authSession?.internal_profile_role,
        level: "info",
        userMessage: "Action terminée."
      });
      return result;
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw error;
      }

      const technicalCode = isRouterAdapterError(error) ? error.code : "timeout";
      const technicalMessage = error instanceof Error ? sanitizeTechnicalMessage(error.message) : undefined;
      const translatedMessage = translateRouterError(technicalCode);
      const userMessage =
        technicalCode === "router_rejected" && technicalMessage
          ? `${translatedMessage} Détail RouterOS : ${extractRouterOsDetail(technicalMessage)}`
          : translatedMessage;

      await this.logger.write({
        action,
        accountId: this.authSession?.account_id,
        internalProfileId: this.authSession?.internal_profile_id,
        internalProfileRole: this.authSession?.internal_profile_role,
        level: "error",
        technicalCode,
        technicalMessage,
        userMessage
      });

      throw new RouterServiceError(technicalCode, userMessage, technicalMessage);
    }
  }

  private ensurePermission(permission: Permission): void {
    if (this.authSession !== undefined) {
      requireProfilePermission(this.authSession, permission);
    }
  }
}

export class RouterServiceError extends Error {
  constructor(
    public readonly code: RouterErrorCode,
    message: string,
    public readonly technicalMessage?: string
  ) {
    super(message);
    this.name = "RouterServiceError";
  }
}

export function translateRouterError(code: RouterErrorCode): string {
  const messages: Partial<Record<RouterErrorCode, string>> = {
    api_disabled: "Le service du routeur n'est pas activé.",
    authentication_failed: "Identifiants du routeur incorrects.",
    device_mode_flagged: "RouterOS signale ce routeur comme suspect (Device Mode flagged). Auditez et sécurisez le routeur avant de poursuivre.",
    device_mode_restricted: "RouterOS bloque l'automatisation TicketPro. Dans WinBox, exécutez /system device-mode update scheduler=yes hotspot=yes, confirmez physiquement la demande, puis réessayez l'ajout.",
    duplicate_user: "Ce ticket existe déjà.",
    hotspot_not_found: "Le service de tickets est introuvable sur ce routeur.",
    permission_denied: "Vous n'avez pas l'autorisation d'effectuer cette action.",
    remote_not_configured: "La connexion a distance n'est pas configuree.",
    remote_unavailable: "La connexion distante securisee n'est pas encore disponible.",
    router_rejected: "Le routeur a refusé la commande.",
    router_offline: "Le routeur est hors ligne.",
    timeout: "Le routeur ne répond pas. Réessayez dans un instant."
  };

  return messages[code] ?? "La connexion distante n'est pas encore disponible.";
}

function sanitizeTechnicalMessage(message: string): string {
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

function extractRouterOsDetail(message: string): string {
  return message
    .replace(/^RouterOS API error:\s*router_rejected:\s*/i, "")
    .replace(/^router rejected:\s*/i, "")
    .slice(0, 180);
}

async function removeHotspotUsersFallback(
  adapter: RouterAdapter,
  usernames: string[],
  onProgress?: (progress: RouterVoucherDecommissionProgress) => void
): Promise<HotspotUserBatchRemovalResult[]> {
  const results: HotspotUserBatchRemovalResult[] = [];
  for (const username of usernames) {
    try {
      await adapter.removeHotspotUser(username);
      results.push({ status: "removed", username });
    } catch (error) {
      results.push({
        message: error instanceof Error ? error.message : "Suppression RouterOS impossible.",
        status: "error",
        username
      });
    }
    onProgress?.({ completed: results.length, phase: "removing", total: usernames.length });
  }
  return results;
}

class NoopRouterActionLogger implements RouterActionLogger {
  write(): void {
    return undefined;
  }
}

function isRouterAdapter(value: unknown): value is RouterAdapter & { listRouters?: () => Promise<RouterSummary[]> } {
  return Boolean(value && typeof value === "object" && "testConnection" in value);
}

export type RouterServiceReadModel =
  | ActiveHotspotUser
  | HotspotPlan
  | HotspotServer
  | HotspotUser
  | InterfaceTraffic
  | RouterConnectionTest
  | RouterDateTime
  | RouterHealth
  | RouterSystemInfo;
