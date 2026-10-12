import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickReachableAdapter, resetReachableEndpointCache } from "./PersistedRouterService";

type Probe = { name: string; testConnection: ReturnType<typeof vi.fn> };
const answersAfter = (name: string, ms: number, ok = true): Probe => ({
  name,
  testConnection: vi.fn(() => new Promise((resolve, reject) => {
    setTimeout(() => (ok ? resolve(true) : reject(new Error(`${name} timeout`))), ms);
  }))
});

describe("sélection de l'accès au routeur", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReachableEndpointCache();
  });
  afterEach(() => vi.useRealTimers());

  it("teste les accès en parallèle : un VPN qui répond n'attend plus l'échec complet de l'adresse locale", async () => {
    const local = answersAfter("local", 10_000, false);
    const vpn = answersAfter("vpn", 300);
    const picked = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);

    await vi.advanceTimersByTimeAsync(300 + 1_500);
    await expect(picked).resolves.toBe(vpn);
    expect(local.testConnection).toHaveBeenCalledTimes(1);
    expect(vpn.testConnection).toHaveBeenCalledTimes(1);
  });

  it("garde l'accès préféré s'il répond pendant le court délai de grâce", async () => {
    const local = answersAfter("local", 800);
    const vpn = answersAfter("vpn", 200);
    const picked = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);

    await vi.advanceTimersByTimeAsync(800);
    await expect(picked).resolves.toBe(local);
  });

  it("réutilise l'accès qui a répondu la dernière fois sans retester les autres", async () => {
    const local = answersAfter("local", 10_000, false);
    const vpn = answersAfter("vpn", 100);
    const first = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(first).resolves.toBe(vpn);

    local.testConnection.mockClear();
    vpn.testConnection.mockClear();
    const second = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);
    await vi.advanceTimersByTimeAsync(100);
    await expect(second).resolves.toBe(vpn);
    expect(local.testConnection).not.toHaveBeenCalled();
  });

  it("reteste tout si l'accès mémorisé ne répond plus en quelques secondes", async () => {
    const local = answersAfter("local", 100);
    const vpn = answersAfter("vpn", 100);
    const first = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(local);

    local.testConnection.mockImplementation(() => new Promise(() => undefined));
    const second = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);
    await vi.advanceTimersByTimeAsync(4_000 + 100 + 1_500);
    await expect(second).resolves.toBe(vpn);
  });

  it("retombe sur l'accès par défaut quand aucun ne répond, pour afficher l'erreur réelle", async () => {
    const local = answersAfter("local", 100, false);
    const vpn = answersAfter("vpn", 200, false);
    const picked = pickReachableAdapter("r1", ["local", "vpn"], [local, vpn], local);
    await vi.advanceTimersByTimeAsync(200);
    await expect(picked).resolves.toBe(local);
  });
});
