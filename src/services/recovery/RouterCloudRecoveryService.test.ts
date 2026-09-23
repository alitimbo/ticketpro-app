import { describe, expect, it, vi } from "vitest";
import {
  HotspotPlanRepository,
  InMemoryDatabaseClient,
  RouterConnectionRepository,
  RouterRepository,
  VpnPeerRepository
} from "../database";
import { decryptLocalSecret } from "../security/localSecrets";
import type { SaasRouterRecoverySnapshot } from "../saas";
import { RouterCloudRecoveryService } from "./RouterCloudRecoveryService";

describe("RouterCloudRecoveryService", () => {
  it("reconstruit routeur, secret local, connexions, plans et pair VPN en attente de validation", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const snapshot = recoverySnapshot();
    const cloud = {
      bootstrapVpn: vi.fn(async () => ({
        address_pool: "10.250.0.0/24",
        server_endpoint: "vpn.ticketpro-ne.com",
        server_port: 51820,
        server_public_key: "server-public-key"
      })),
      getSnapshots: vi.fn(async () => [snapshot]),
      saveSnapshot: vi.fn(async (router: SaasRouterRecoverySnapshot) => router)
    };
    const service = new RouterCloudRecoveryService(
      database,
      "account-recovery",
      "account-recovery:profile-admin",
      cloud,
      "organization-recovery"
    );
    const concurrentService = new RouterCloudRecoveryService(
      database,
      "account-recovery",
      "account-recovery:profile-admin",
      cloud,
      "organization-recovery"
    );

    const [result, concurrentResult] = await Promise.all([
      service.restoreMissingRouters(),
      concurrentService.restoreMissingRouters()
    ]);

    expect(result).toEqual({
      restoredRouterIds: ["router-cloud-1"],
      skippedRouterIds: []
    });
    expect(concurrentResult).toEqual(result);
    expect(cloud.getSnapshots).toHaveBeenCalledTimes(1);
    expect(cloud.bootstrapVpn).toHaveBeenCalledTimes(1);
    const router = await new RouterRepository(database).findById("router-cloud-1");
    expect(router).toMatchObject({
      hotspot_address: "wifi.client.test",
      notes: "",
      organization_id: "organization-recovery",
      serial_number: "SERIAL-CLOUD-1",
      status: "warning"
    });
    await expect(decryptLocalSecret(router?.encrypted_password ?? "")).resolves.toBe("router-secret");
    expect(await new RouterConnectionRepository(database).listByRouter("router-cloud-1")).toEqual([
      expect.objectContaining({
        host: "10.250.0.2",
        mode: "vpn",
        status: "inactive"
      })
    ]);
    expect(await new HotspotPlanRepository(database).listByRouter("router-cloud-1")).toEqual([
      expect.objectContaining({
        currency: "CFA",
        mikrotik_id: "*1",
        mikrotik_profile_name: "6h",
        name: "Forfait 6 heures",
        revision: 2
      })
    ]);
    expect(await new VpnPeerRepository(database).findByRouter(
      "account-recovery",
      "router-cloud-1"
    )).toMatchObject({
      assigned_address: "10.250.0.2/32",
      private_key_encrypted: null,
      status: "draft"
    });

    await expect(service.restoreMissingRouters()).resolves.toEqual({
      restoredRouterIds: [],
      skippedRouterIds: ["router-cloud-1"]
    });
  });

  it("restaure le mÃªme routeur cloud dans deux comptes locaux sans collision d'identifiants", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const snapshot = recoverySnapshot();
    const cloud = {
      bootstrapVpn: vi.fn(async () => ({
        address_pool: "10.250.0.0/24",
        server_endpoint: "vpn.ticketpro-ne.com",
        server_port: 51820,
        server_public_key: "server-public-key"
      })),
      getSnapshots: vi.fn(async () => [snapshot]),
      saveSnapshot: vi.fn(async (router: SaasRouterRecoverySnapshot) => router)
    };

    await new RouterCloudRecoveryService(
      database,
      "account-owner",
      "account-owner:profile-admin",
      cloud
    ).restoreMissingRouters();
    const operatorResult = await new RouterCloudRecoveryService(
      database,
      "account-operator",
      "account-operator:profile-operator",
      cloud
    ).restoreMissingRouters();

    expect(operatorResult.restoredRouterIds).toHaveLength(1);
    expect(operatorResult.restoredRouterIds[0]).not.toBe(snapshot.id);
    const operatorRouter = await new RouterRepository(database).findById(
      operatorResult.restoredRouterIds[0]
    );
    expect(operatorRouter).toMatchObject({
      account_id: "account-operator",
      cloud_router_id: snapshot.id,
      name: snapshot.name
    });
    expect(await new HotspotPlanRepository(database).listByRouter(operatorRouter?.id ?? "")).toEqual([
      expect.objectContaining({
        mikrotik_profile_name: "6h",
        router_id: operatorRouter?.id
      })
    ]);
  });
  it("retire la copie d’un autre PC sans toucher à un autre compte ni aux routeurs simplement absents", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const snapshot = recoverySnapshot();
    const cloud = {
      bootstrapVpn: vi.fn(async () => ({ address_pool: "10.250.0.0/24", server_endpoint: "vpn.test", server_port: 51820, server_public_key: "key" })),
      getSnapshots: vi.fn(async () => [snapshot]),
      saveSnapshot: vi.fn(async (router: SaasRouterRecoverySnapshot) => router)
    };
    await new RouterCloudRecoveryService(database, "owner", "owner:admin", cloud, "org").restoreMissingRouters();
    const second = new RouterCloudRecoveryService(database, "pc2", "pc2:admin", cloud, "org");
    const restored = await second.restoreMissingRouters();
    const localId = restored.restoredRouterIds[0];
    expect(localId).not.toBe(snapshot.id);
    const retiredAt = "2026-09-06T10:00:00.000Z";
    await new RouterRepository(database).setCloudId("pc2", localId, "legacy-local-id");
    const retiringCloud = { ...cloud, getState: vi.fn(async () => ({ organization_id: "org", routers: [], retired: [{ router_id: snapshot.id, stable_identity: snapshot.stable_identity.toLowerCase(), retired_at: retiredAt }] })) };
    const retiring = new RouterCloudRecoveryService(database, "pc2", "pc2:admin", retiringCloud, "org");
    await retiring.restoreMissingRouters();
    await retiring.restoreMissingRouters();
    const routers = new RouterRepository(database);
    expect(await routers.listByAccount("pc2")).toEqual([]);
    expect(await routers.findById(localId)).toMatchObject({ deleted_at: retiredAt, subscription_counted: 0 });
    expect(await routers.listByAccount("owner")).toHaveLength(1);
    expect(await new RouterConnectionRepository(database).listByRouter(localId)).toEqual([]);
    expect(await new VpnPeerRepository(database).findByRouter("pc2", localId)).toBeNull();
    expect(await database.query("SELECT * FROM vpn_peers WHERE router_id = ?1", [localId])).toEqual([expect.objectContaining({ status: "revoked" })]);
    await expect(retiring.backupRouter(localId)).rejects.toThrow("introuvable");
    expect(cloud.saveSnapshot).not.toHaveBeenCalled();
    // An empty inventory alone is not a deletion instruction (offline/local-only router).
    await new RouterCloudRecoveryService(database, "owner", "owner:admin", {
      ...cloud, getState: async () => ({ organization_id: "org", routers: [], retired: [] })
    }, "org").restoreMissingRouters();
    expect(await routers.listByAccount("owner")).toHaveLength(1);
  });

  it("refuse les suppressions provenant d’une autre organisation", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const cloud = {
      bootstrapVpn: vi.fn(), getSnapshots: vi.fn(), saveSnapshot: vi.fn(),
      getState: async () => ({ organization_id: "other-org", routers: [], retired: [] })
    };
    await expect(new RouterCloudRecoveryService(database, "owner", "owner:admin", cloud, "org")
      .restoreMissingRouters()).rejects.toThrow("organisation");
  });

  it("rejoue une restauration avec plan dupliqué ou archivé et adopte le nom cloud plus récent", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const baseSnapshot = recoverySnapshot();
    const updatedSnapshot: SaasRouterRecoverySnapshot = {
      ...baseSnapshot,
      label: "IB WIFI ZONE",
      name: "IB WIFI ZONE",
      plans: [baseSnapshot.plans[0], { ...baseSnapshot.plans[0] }],
      updated_at: "2099-01-01T00:00:00.000Z"
    };
    const cloud = {
      bootstrapVpn: vi.fn(async () => ({
        address_pool: "10.250.0.0/24",
        server_endpoint: "vpn.ticketpro-ne.com",
        server_port: 51820,
        server_public_key: "server-public-key"
      })),
      getSnapshots: vi.fn(async () => [updatedSnapshot]),
      saveSnapshot: vi.fn(async (router: SaasRouterRecoverySnapshot) => router)
    };
    const service = new RouterCloudRecoveryService(
      database,
      "account-recovery",
      "account-recovery:profile-admin",
      cloud,
      "organization-recovery"
    );

    await expect(service.restoreMissingRouters()).resolves.toMatchObject({
      restoredRouterIds: ["router-cloud-1"]
    });

    const routers = new RouterRepository(database);
    const plans = new HotspotPlanRepository(database);
    const restoredRouter = await routers.findById("router-cloud-1");
    expect(await plans.listByRouter("router-cloud-1")).toHaveLength(1);

    await routers.update({
      ...restoredRouter!,
      label: "Ancien nom local",
      name: "Ancien nom local",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    await plans.remove("plan-cloud-1");
    expect(await plans.findById("plan-cloud-1")).toBeNull();

    await expect(service.restoreMissingRouters()).resolves.toMatchObject({
      skippedRouterIds: ["router-cloud-1"]
    });
    expect(await routers.findById("router-cloud-1")).toMatchObject({
      label: "IB WIFI ZONE",
      name: "IB WIFI ZONE"
    });
    await expect(plans.listByRouter("router-cloud-1")).resolves.toEqual([
      expect.objectContaining({ id: "plan-cloud-1", deleted_at: null })
    ]);
  });
});

function recoverySnapshot(): SaasRouterRecoverySnapshot {
  return {
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: "RB5009",
    connection_mode: "vpn",
    connections: [{
      host: "10.250.0.2",
      mode: "vpn",
      port: 8728,
      status: "active",
      use_ssl: false
    }],
    credential: "router-secret",
    hotspot_address: "wifi.client.test",
    id: "router-cloud-1",
    label: "Routeur client",
    last_seen_at: "2026-07-29T12:00:00.000Z",
    local_ip: "192.168.88.1",
    model: "RB5009",
    name: "Routeur client",
    notes: null,
    plans: [{
      created_at: "2026-07-29T10:00:00.000Z",
      created_by_profile_id: "profile-owner",
      currency: "CFA",
      data_limit_mb: null,
      download_limit: "5M",
      duration_minutes: 360,
      id: "plan-cloud-1",
      last_synced_at: "2026-07-29T11:00:00.000Z",
      mikrotik_id: "*1",
      mikrotik_profile_name: "6h",
      name: "Forfait 6 heures",
      price_hint: 500,
      revision: 2,
      shared_users: 1,
      status: "active",
      upload_limit: "2M",
      updated_at: "2026-07-29T11:00:00.000Z",
      updated_by_profile_id: "profile-owner",
      validity_minutes: 1440
    }],
    routeros_version: "7.15",
    serial_number: "SERIAL-CLOUD-1",
    stable_identity: "serial:SERIAL-CLOUD-1",
    status: "active",
    username: "admin",
    vpn: {
      assigned_address: "10.250.0.2/32",
      public_key: "router-public-key",
      status: "active"
    }
  };
}

