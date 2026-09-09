import { describe, expect, it, vi } from "vitest";
import { refreshRouterSnapshot } from "./routerRecoveryRefresh";

describe("router recovery refresh", () => {
  it("keeps local routers available when the VPS is offline and blocks backup", async () => {
    const onError = vi.fn();
    const result = await refreshRouterSnapshot(
      async () => { throw new Error("offline"); },
      async () => [{ id: "local-router" }], onError
    );
    expect(result).toEqual({ records: [{ id: "local-router" }], recovery: null, succeeded: false });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("rereads local data after a partial retirement instead of restoring stale cards", async () => {
    let rows = ["retired", "active"];
    const result = await refreshRouterSnapshot(async () => {
      rows = ["active"];
      throw new Error("later recovery failed");
    }, async () => rows, vi.fn());
    expect(result.records).toEqual(["active"]);
    expect(result.succeeded).toBe(false);
  });

  it("permits backup only after successful recovery and propagates local read failures", async () => {
    const result = await refreshRouterSnapshot(async () => ({ restored: 1 }), async () => ["new"], vi.fn());
    expect(result).toEqual({ recovery: { restored: 1 }, records: ["new"], succeeded: true });
    await expect(refreshRouterSnapshot(async () => null, async () => {
      throw new Error("SQLite unavailable");
    }, vi.fn())).rejects.toThrow("SQLite unavailable");
  });
});
