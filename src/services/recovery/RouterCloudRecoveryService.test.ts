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
        server_endpoint: "vpn.autoticket-ne.com",
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
      cloud
    );
    const concurrentService = new RouterCloudRecoveryService(
      database,
      "account-recovery",
      "account-recovery:profile-admin",
      cloud
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
        mikrotik_profile_name: "6h",
        name: "Forfait 6 heures"
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
        server_endpoint: "vpn.autoticket-ne.com",
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
      data_limit_mb: null,
      download_limit: "5M",
      duration_minutes: 360,
      id: "plan-cloud-1",
      mikrotik_profile_name: "6h",
      name: "Forfait 6 heures",
      price_hint: 500,
      shared_users: 1,
      status: "active",
      upload_limit: "2M",
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
