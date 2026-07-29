import type { DatabaseClient } from "../database";
import { AppSettingsRepository } from "../database/repositories";
import {
  getSaasRouterAccessPolicy,
  SaasRequestError,
  syncSaasRouterAccessPolicy,
  type SaasRouterAccessPolicy
} from "../saas";
import {
  defaultRouterAccessPolicy,
  RouterAccessPolicyService,
  type RouterAccessPolicy
} from "./RouterAccessPolicyService";

export type RouterAccessPolicySyncStatus =
  | "conflict"
  | "offline"
  | "pending"
  | "synced";

export type RouterAccessPolicySyncResult = {
  policy: RouterAccessPolicy;
  remotePolicy: RouterAccessPolicy | null;
  revision: number;
  status: RouterAccessPolicySyncStatus;
};

type SyncMetadata = {
  lastAttemptAt: string;
  lastSyncedPolicyJson: string | null;
  revision: number;
  status: RouterAccessPolicySyncStatus;
};

type PolicyCloudClient = {
  get(routerId: string): Promise<SaasRouterAccessPolicy | null>;
  put(input: {
    baseRevision: number;
    policy: RouterAccessPolicy;
    routerId: string;
  }): Promise<SaasRouterAccessPolicy>;
};

const defaultCloudClient: PolicyCloudClient = {
  get: getSaasRouterAccessPolicy,
  put: syncSaasRouterAccessPolicy
};

export class RouterAccessPolicySyncService {
  private readonly local: RouterAccessPolicyService;
  private readonly settings: AppSettingsRepository;

  constructor(
    database: DatabaseClient,
    private readonly cloud: PolicyCloudClient = defaultCloudClient
  ) {
    this.local = new RouterAccessPolicyService(database);
    this.settings = new AppSettingsRepository(database);
  }

  async load(
    accountId: string,
    routerId: string,
    cloudRouterId = routerId
  ): Promise<RouterAccessPolicySyncResult> {
    const [localPolicy, metadata] = await Promise.all([
      this.local.get(accountId, routerId),
      this.getMetadata(accountId, routerId)
    ]);
    let remote: SaasRouterAccessPolicy | null;
    try {
      remote = await this.cloud.get(cloudRouterId);
    } catch {
      await this.setMetadata(accountId, routerId, {
        lastAttemptAt: new Date().toISOString(),
        lastSyncedPolicyJson: metadata?.lastSyncedPolicyJson ?? null,
        revision: metadata?.revision ?? 0,
        status: "offline"
      });
      return result(localPolicy, null, metadata?.revision ?? 0, "offline");
    }

    if (!remote) {
      if (policyJson(localPolicy) === policyJson(defaultRouterAccessPolicy)) {
        await this.markSynced(accountId, routerId, localPolicy, 0);
        return result(localPolicy, null, 0, "synced");
      }
      return this.push(
        accountId,
        routerId,
        cloudRouterId,
        localPolicy,
        metadata?.revision ?? 0
      );
    }

    const localJson = policyJson(localPolicy);
    const remoteJson = policyJson(remote.policy);
    if (localJson === remoteJson) {
      await this.markSynced(accountId, routerId, remote.policy, remote.revision);
      return result(remote.policy, remote.policy, remote.revision, "synced");
    }

    const localWasNotChanged = metadata?.lastSyncedPolicyJson === localJson;
    if (localWasNotChanged || (!metadata && localJson === policyJson(defaultRouterAccessPolicy))) {
      const saved = await this.local.save(accountId, routerId, remote.policy);
      await this.markSynced(accountId, routerId, saved, remote.revision);
      return result(saved, saved, remote.revision, "synced");
    }

    if (metadata?.status === "pending" && metadata.revision === remote.revision) {
      return this.push(accountId, routerId, cloudRouterId, localPolicy, metadata.revision);
    }

    await this.setMetadata(accountId, routerId, {
      lastAttemptAt: new Date().toISOString(),
      lastSyncedPolicyJson: metadata?.lastSyncedPolicyJson ?? null,
      revision: remote.revision,
      status: "conflict"
    });
    return result(localPolicy, remote.policy, remote.revision, "conflict");
  }

  async saveAndSync(
    accountId: string,
    routerId: string,
    policy: RouterAccessPolicy,
    cloudRouterId = routerId
  ): Promise<RouterAccessPolicySyncResult> {
    const saved = await this.local.save(accountId, routerId, policy);
    const metadata = await this.getMetadata(accountId, routerId);
    return this.push(
      accountId,
      routerId,
      cloudRouterId,
      saved,
      metadata?.revision ?? 0
    );
  }

  async acceptRemote(
    accountId: string,
    routerId: string,
    remotePolicy: RouterAccessPolicy,
    remoteRevision: number,
    _cloudRouterId = routerId
  ): Promise<RouterAccessPolicySyncResult> {
    const saved = await this.local.save(accountId, routerId, remotePolicy);
    await this.markSynced(accountId, routerId, saved, remoteRevision);
    return result(saved, saved, remoteRevision, "synced");
  }

  async overwriteRemote(
    accountId: string,
    routerId: string,
    localPolicy: RouterAccessPolicy,
    remoteRevision: number,
    cloudRouterId = routerId
  ): Promise<RouterAccessPolicySyncResult> {
    const saved = await this.local.save(accountId, routerId, localPolicy);
    return this.push(accountId, routerId, cloudRouterId, saved, remoteRevision);
  }

  private async push(
    accountId: string,
    routerId: string,
    cloudRouterId: string,
    policy: RouterAccessPolicy,
    baseRevision: number
  ): Promise<RouterAccessPolicySyncResult> {
    try {
      const remote = await this.cloud.put({
        baseRevision,
        policy,
        routerId: cloudRouterId
      });
      const saved = await this.local.save(accountId, routerId, remote.policy);
      await this.markSynced(accountId, routerId, saved, remote.revision);
      return result(saved, saved, remote.revision, "synced");
    } catch (error) {
      const remote = conflictRemotePolicy(error);
      const status: RouterAccessPolicySyncStatus = remote ? "conflict" : "pending";
      await this.setMetadata(accountId, routerId, {
        lastAttemptAt: new Date().toISOString(),
        lastSyncedPolicyJson: null,
        revision: remote?.revision ?? baseRevision,
        status
      });
      return result(policy, remote?.policy ?? null, remote?.revision ?? baseRevision, status);
    }
  }

  private async markSynced(
    accountId: string,
    routerId: string,
    policy: RouterAccessPolicy,
    revision: number
  ): Promise<void> {
    await this.setMetadata(accountId, routerId, {
      lastAttemptAt: new Date().toISOString(),
      lastSyncedPolicyJson: policyJson(policy),
      revision,
      status: "synced"
    });
  }

  private async getMetadata(
    accountId: string,
    routerId: string
  ): Promise<SyncMetadata | null> {
    const stored = await this.settings.get(metadataKey(accountId, routerId));
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as SyncMetadata;
      if (!Number.isInteger(parsed.revision) || parsed.revision < 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async setMetadata(
    accountId: string,
    routerId: string,
    metadata: SyncMetadata
  ): Promise<void> {
    await this.settings.set(metadataKey(accountId, routerId), JSON.stringify(metadata));
  }
}

function conflictRemotePolicy(error: unknown): SaasRouterAccessPolicy | null {
  if (!(error instanceof SaasRequestError) || error.status !== 409) return null;
  const remote = error.details?.remote_policy;
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return null;
  return remote as SaasRouterAccessPolicy;
}

function policyJson(policy: RouterAccessPolicy): string {
  return JSON.stringify(policy);
}

function metadataKey(accountId: string, routerId: string): string {
  return `router.access_policy_sync.${accountId}.${routerId}`;
}

function result(
  policy: RouterAccessPolicy,
  remotePolicy: RouterAccessPolicy | null,
  revision: number,
  status: RouterAccessPolicySyncStatus
): RouterAccessPolicySyncResult {
  return { policy, remotePolicy, revision, status };
}
