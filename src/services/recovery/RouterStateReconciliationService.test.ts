import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../../domain/auth";
import {
  HotspotPlanRepository,
  InMemoryDatabaseClient,
  RouterRepository,
  TicketRepository
} from "../database";
import { defaultRouterAccessPolicy } from "../access";
import { FakeRouterAdapter, RouterService } from "../router";
import { RouterStateReconciliationService } from "./RouterStateReconciliationService";

describe("RouterStateReconciliationService", () => {
  it("ne réactive un routeur restauré qu'après confirmation et réconciliation RouterOS", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const routers = new RouterRepository(database);
    const plans = new HotspotPlanRepository(database);
    const router = await routers.create({
      account_id: "account-recovery",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: null,
      connection_mode: "vpn",
      created_by_profile_id: "account-recovery:profile-admin",
      encrypted_password: "encrypted:test.value",
      hotspot_address: "wifi.example",
      id: "router-recovery",
      label: "Routeur restauré",
      last_seen_at: null,
      local_ip: "192.168.88.1",
      model: null,
      name: "Routeur restauré",
      notes: "",
      routeros_version: null,
      serial_number: "SERIAL-RECOVERY",
      status: "warning",
      username: "admin",
      zone_id: null
    });
    await plans.create({
      data_limit_mb: null,
      download_limit: "1M",
      duration_minutes: 60,
      id: "stale-plan",
      mikrotik_profile_name: "absent-routeros",
      name: "Ancien plan",
      price_hint: 50,
      router_id: router.id,
      shared_users: 1,
      status: "active",
      sync_status: "synced",
      upload_limit: "1M",
      validity_minutes: 60
    });

    const adapter = new FakeRouterAdapter({ latencyMs: 0 });
    const service = new RouterService({ adapter, authSession: adminSession });
    const backupRouter = vi.fn(async () => undefined);
    const reconciler = new RouterStateReconciliationService(database, adminSession, {
      backupRouter,
      policies: {
        load: vi.fn(async () => ({
          policy: {
            ...structuredClone(defaultRouterAccessPolicy),
            antiSharingMode: "strict" as const,
            infrastructureDevices: [{
              id: "antenna-1",
              internetBypass: true,
              ipAddress: "192.168.88.10",
              macAddress: "AA:BB:CC:DD:EE:10",
              mode: "bridge" as const,
              name: "Antenne principale",
              type: "antenna" as const
            }],
            monitorIpv4Ttl: true,
            monitorIpv6HopLimit: true
          },
          remotePolicy: null,
          revision: 4,
          status: "synced" as const
        }))
      }
    });

    const result = await reconciler.reconcile(router, service);

    expect(result).toMatchObject({
      bypassCount: 1,
      planCount: 2,
      recoveredTicketCount: 3,
      ttlIpv4Enabled: true,
      ttlIpv6Enabled: true
    });
    expect(await routers.findById(router.id)).toMatchObject({
      board_name: "C52iG-5HaxD2HaxD",
      model: "hAP ax²",
      routeros_version: "7.15.3",
      status: "active",
      sync_status: "synced"
    });
    expect(await service.listManagedHotspotBypasses()).toEqual([
      expect.objectContaining({ id: "antenna-1", address: "192.168.88.10" })
    ]);
    expect(await plans.listByRouter(router.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mikrotik_profile_name: "plan-journee", sync_status: "synced" }),
        expect.objectContaining({ mikrotik_profile_name: "plan-2h", sync_status: "synced" })
      ])
    );
    expect((await plans.listByRouter(router.id)).some((plan) => plan.id === "stale-plan")).toBe(false);
    expect(backupRouter).toHaveBeenCalledWith(router.id);
    expect(await new TicketRepository(database).listByRouter(router.id)).toHaveLength(3);
  });
});

const adminSession: AuthSession = {
  account_email: "admin@example.com",
  account_id: "account-recovery",
  created_at: 0,
  expires_at: Number.MAX_SAFE_INTEGER,
  internal_profile_id: "account-recovery:profile-admin",
  internal_profile_label: "Administrateur",
  internal_profile_role: "admin",
  last_activity_at: 0,
  permissions: [
    "router.settings.manage",
    "router.plans.read",
    "router.plans.write"
  ]
};
