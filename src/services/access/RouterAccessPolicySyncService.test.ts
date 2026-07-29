import { describe, expect, it, vi } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import { SaasRequestError, type SaasRouterAccessPolicy } from "../saas";
import {
  defaultRouterAccessPolicy,
  RouterAccessPolicyService,
  type RouterAccessPolicy
} from "./RouterAccessPolicyService";
import { RouterAccessPolicySyncService } from "./RouterAccessPolicySyncService";

describe("RouterAccessPolicySyncService", () => {
  it("envoie automatiquement une configuration locale existante vers un VPS vide", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const local = new RouterAccessPolicyService(database);
    const policy = configuredPolicy();
    await local.save("account-1", "router-1", policy);
    const get = vi.fn(async () => null);
    const put = vi.fn(async () => remotePolicy(policy, 1));
    const sync = new RouterAccessPolicySyncService(database, { get, put });

    const result = await sync.load("account-1", "router-1");

    expect(put).toHaveBeenCalledWith({
      baseRevision: 0,
      policy,
      routerId: "router-1"
    });
    expect(result.status).toBe("synced");
    expect(result.revision).toBe(1);
  });

  it("récupère la version VPS lorsqu'aucune modification locale n'est en attente", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const remote = configuredPolicy();
    const sync = new RouterAccessPolicySyncService(database, {
      get: vi.fn(async () => remotePolicy(remote, 3)),
      put: vi.fn()
    });

    const result = await sync.load("account-1", "router-1");

    expect(result.status).toBe("synced");
    expect(result.revision).toBe(3);
    await expect(
      new RouterAccessPolicyService(database).get("account-1", "router-1")
    ).resolves.toEqual(remote);
  });

  it("conserve la version locale en attente lorsqu'Internet est indisponible", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const policy = configuredPolicy();
    const sync = new RouterAccessPolicySyncService(database, {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    });

    const result = await sync.saveAndSync("account-1", "router-1", policy);

    expect(result.status).toBe("pending");
    await expect(
      new RouterAccessPolicyService(database).get("account-1", "router-1")
    ).resolves.toEqual(policy);
  });

  it("détecte un conflit et permet de conserver explicitement la version locale", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const local = configuredPolicy();
    const remote = {
      ...configuredPolicy(),
      lockVoucherToFirstMac: false
    };
    const put = vi
      .fn()
      .mockRejectedValueOnce(new SaasRequestError(
        "Conflit",
        409,
        { remote_policy: remotePolicy(remote, 4) }
      ))
      .mockResolvedValueOnce(remotePolicy(local, 5));
    const sync = new RouterAccessPolicySyncService(database, {
      get: vi.fn(async () => remotePolicy(remote, 4)),
      put
    });

    const conflicted = await sync.saveAndSync("account-1", "router-1", local);
    expect(conflicted.status).toBe("conflict");
    expect(conflicted.remotePolicy).toEqual(remote);

    const resolved = await sync.overwriteRemote(
      "account-1",
      "router-1",
      local,
      conflicted.revision
    );
    expect(resolved.status).toBe("synced");
    expect(put).toHaveBeenLastCalledWith({
      baseRevision: 4,
      policy: local,
      routerId: "router-1"
    });
  });
});

function configuredPolicy(): RouterAccessPolicy {
  return {
    ...structuredClone(defaultRouterAccessPolicy),
    infrastructureDevices: [{
      id: "antenna-1",
      internetBypass: true,
      ipAddress: "192.168.88.10",
      macAddress: "AA:BB:CC:DD:EE:10",
      mode: "bridge",
      name: "Antenne nord",
      type: "antenna"
    }],
    lockVoucherToFirstMac: true
  };
}

function remotePolicy(
  policy: RouterAccessPolicy,
  revision: number
): SaasRouterAccessPolicy {
  return {
    organization_id: "organization-1",
    policy,
    revision,
    router_id: "router-1",
    updated_at: "2026-07-29T00:00:00.000Z"
  };
}
