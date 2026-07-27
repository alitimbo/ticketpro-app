import { describe, expect, it, vi } from "vitest";
import type { HotspotPlanRecord } from "../../domain/database";
import type { HotspotUserDraft } from "../../domain/router";
import type { RouterAdapter } from "./RouterAdapter";
import { PersistedPlanMappingRouterAdapter } from "./PersistedPlanMappingRouterAdapter";

const plan: HotspotPlanRecord = {
  created_at: "2026-01-01T00:00:00.000Z",
  data_limit_mb: 2048,
  deleted_at: null,
  download_limit: "5M",
  duration_minutes: 180,
  id: "plan-local-1",
  mikrotik_profile_name: "plan-3h-2go",
  name: "3h - 2 Go",
  price_hint: 500,
  router_id: "router-1",
  shared_users: 1,
  status: "active",
  sync_status: "synced",
  updated_at: "2026-01-01T00:00:00.000Z",
  upload_limit: "2M",
  validity_minutes: 300
};

function createDelegate() {
  const createHotspotUser = vi.fn(async (user: HotspotUserDraft) => ({
    comment: user.comment ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "*1",
    passwordSecretRef: user.passwordSecretRef,
    planId: user.planId,
    profileName: user.planId,
    status: "available" as const,
    username: user.username
  }));

  return {
    adapter: {
      createHotspotUser
    } as unknown as RouterAdapter,
    createHotspotUser
  };
}

describe("PersistedPlanMappingRouterAdapter", () => {
  it("traduit l'identifiant SQLite en profil MikroTik et matérialise les limites", async () => {
    const delegate = createDelegate();
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [plan]);

    await adapter.createHotspotUser({
      passwordSecretRef: "secret://router-1/123456/password",
      planId: "plan-local-1",
      username: "123456"
    });

    expect(delegate.createHotspotUser).toHaveBeenCalledWith(
      expect.objectContaining({
        limitBytesTotal: 2147483648,
        limitUptime: "3h",
        planId: "plan-3h-2go"
      })
    );
  });

  it("préserve les limites explicitement fournies", async () => {
    const delegate = createDelegate();
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [plan]);

    await adapter.createHotspotUser({
      limitBytesTotal: 1024,
      limitUptime: "10m",
      passwordSecretRef: "secret://router-1/654321/password",
      planId: "plan-local-1",
      username: "654321"
    });

    expect(delegate.createHotspotUser).toHaveBeenCalledWith(
      expect.objectContaining({
        limitBytesTotal: 1024,
        limitUptime: "10m",
        planId: "plan-3h-2go"
      })
    );
  });
});
