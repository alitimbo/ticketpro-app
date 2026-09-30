import { describe, expect, it, vi } from "vitest";
import type { HotspotPlanRecord } from "../../domain/database";
import type { HotspotUserDraft } from "../../domain/router";
import type { RouterAdapter } from "./RouterAdapter";
import { PersistedPlanMappingRouterAdapter } from "./PersistedPlanMappingRouterAdapter";

const plan: HotspotPlanRecord = {
  created_at: "2026-01-01T00:00:00.000Z",
  created_by_profile_id: "profile-admin",
  currency: "CFA",
  data_limit_mb: 2048,
  deleted_at: null,
  download_limit: "5M",
  duration_minutes: 180,
  id: "plan-local-1",
  last_synced_at: "2026-01-01T00:00:00.000Z",
  mikrotik_id: "*1",
  mikrotik_profile_name: "plan-3h-2go",
  name: "3h - 2 Go",
  price_hint: 500,
  router_id: "router-1",
  revision: 1,
  shared_users: 1,
  status: "active",
  sync_status: "synced",
  updated_at: "2026-01-01T00:00:00.000Z",
  updated_by_profile_id: "profile-admin",
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
  const updateHotspotUser = vi.fn(async (username: string, planId: string) => ({
    comment: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "*1",
    passwordSecretRef: `secret://router-1/${username}/password`,
    planId,
    profileName: planId,
    status: "available" as const,
    username
  }));
  const createHotspotUsersExactBatch = vi.fn(async (users: HotspotUserDraft[]) =>
    Promise.all(users.map(async (user) => ({
      status: "confirmed" as const,
      user: await createHotspotUser(user),
      username: user.username
    })))
  );

  return {
    adapter: {
      createHotspotUser,
      createHotspotUsersExactBatch,
      updateHotspotUser
    } as unknown as RouterAdapter,
    createHotspotUsersExactBatch,
    createHotspotUser,
    updateHotspotUser
  };
}

describe("PersistedPlanMappingRouterAdapter", () => {
  it("conserve un ancien quota local si la métadonnée RouterOS est absente, mais accepte un illimité explicitement enregistré", async () => {
    const getHotspotPlans = vi.fn(async () => [{ dataLimitMb: null, profileName: plan.mikrotik_profile_name }]);
    const adapter = new PersistedPlanMappingRouterAdapter({ getHotspotPlans } as unknown as RouterAdapter, [plan]);
    expect((await adapter.getHotspotPlans())[0].dataLimitMb).toBe(2048);
    getHotspotPlans.mockResolvedValueOnce([{ dataLimitMb: null, profileName: plan.mikrotik_profile_name, dataLimitSource: "routeros" } as never]);
    expect((await adapter.getHotspotPlans())[0].dataLimitMb).toBeNull();
  });
  it("ne remplace pas un illimité explicite du ticket par le nouveau quota du plan", async () => {
    const delegate = createDelegate();
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [plan]);
    await adapter.createHotspotUser({ username: "unlimited", planId: plan.id, passwordSecretRef: "secret://test", limitBytesTotal: null });
    expect(delegate.createHotspotUser).toHaveBeenCalledWith(expect.objectContaining({ limitBytesTotal: null }));
  });
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

  it("traduit tout un lot avant de le déléguer à l'écriture groupée RouterOS", async () => {
    const delegate = createDelegate();
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [plan]);

    await adapter.createHotspotUsersExactBatch([
      { passwordSecretRef: "secret://router-1/111111/password", planId: plan.id, username: "111111" },
      { passwordSecretRef: "secret://router-1/222222/password", planId: plan.id, username: "222222" }
    ]);

    expect(delegate.createHotspotUsersExactBatch).toHaveBeenCalledTimes(1);
    expect(delegate.createHotspotUsersExactBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ limitBytesTotal: 2147483648, limitUptime: "3h", planId: "plan-3h-2go" }),
      expect.objectContaining({ limitBytesTotal: 2147483648, limitUptime: "3h", planId: "plan-3h-2go" })
    ]);
  });

  it("réapplique les limites du plan lors de la résolution d'un conflit", async () => {
    const delegate = createDelegate();
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [plan]);

    await adapter.updateHotspotUser("123456", "plan-local-1");

    expect(delegate.updateHotspotUser).toHaveBeenCalledWith(
      "123456",
      "plan-3h-2go",
      {
        limitBytesTotal: 2147483648,
        limitUptime: "3h"
      }
    );
  });

  it("envoie des limites nulles pour effacer les anciennes valeurs d'un plan illimité", async () => {
    const delegate = createDelegate();
    const unlimitedPlan = { ...plan, data_limit_mb: null, duration_minutes: 0 };
    const adapter = new PersistedPlanMappingRouterAdapter(delegate.adapter, [unlimitedPlan]);

    await adapter.updateHotspotUser("123456", unlimitedPlan.id);

    expect(delegate.updateHotspotUser).toHaveBeenCalledWith(
      "123456",
      "plan-3h-2go",
      {
        limitBytesTotal: null,
        limitUptime: null
      }
    );
  });
});
