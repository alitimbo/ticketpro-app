import { describe, expect, it, vi } from "vitest";
import {
  beginVoucherGenerationPerformance,
  endVoucherGenerationPerformance
} from "../performance/VoucherGenerationPerformance";
import { TauriRouterOsApiTransport } from "./RouterOsApiTransport";

describe("TauriRouterOsApiTransport", () => {
  it("envoie un lot RouterOS natif avec les mêmes valeurs normalisées qu'un appel unitaire", async () => {
    const invoke = vi.fn(async () => ({
      completedCount: 2,
      connectionError: null,
      results: [{ error: null, rows: [] }, { error: null, rows: [] }]
    }));
    const transport = new TauriRouterOsApiTransport(invoke);

    await transport.callBatch({
      commands: [
        { command: "/ip/hotspot/user/add", params: { disabled: false, name: "100001" } },
        { command: "/ip/hotspot/user/add", params: { comment: true, name: "100002" } }
      ],
      host: "10.250.0.2",
      password: "secret",
      port: 8728,
      username: "ticketpro-api"
    });

    expect(invoke).toHaveBeenCalledWith("mikrotik_api_batch", {
      request: expect.objectContaining({
        commands: [
          { command: "/ip/hotspot/user/add", params: { name: "100001" }, queries: {} },
          { command: "/ip/hotspot/user/add", params: { comment: "", name: "100002" }, queries: {} }
        ],
        retries: 1,
        timeoutMs: 5000
      })
    });
  });

  it("limite à trois les appels simultanés vers le même routeur", async () => {
    let active = 0;
    let maximumObserved = 0;
    const releases: Array<() => void> = [];
    const invoke = vi.fn(async () => {
      active += 1;
      maximumObserved = Math.max(maximumObserved, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return [];
    });
    const transport = new TauriRouterOsApiTransport(invoke);
    const requests = Array.from({ length: 7 }, (_, index) =>
      transport.call({
        command: `/test/${index}`,
        host: "10.250.0.2",
        password: "secret",
        port: 8728,
        username: "admin"
      })
    );

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    while (releases.length > 0 || invoke.mock.calls.length < requests.length) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(requests);

    expect(maximumObserved).toBe(3);
  });

  it("agrege les mesures natives sans exposer les identifiants de connexion", async () => {
    const logger = vi.fn();
    const metrics = beginVoucherGenerationPerformance(1, { logger });
    const invoke = vi.fn(async () => ({
      error: null,
      metrics: {
        authDurationMs: 4,
        commandCount: 1,
        commandTimings: [
          { command: "/ip/hotspot/user/add", durationMs: 25, outcome: "success" }
        ],
        connectDurationMs: 6,
        connectionCount: 1,
        fatalCount: 0,
        retryCount: 0,
        trapCount: 0
      },
      rows: []
    }));
    const transport = new TauriRouterOsApiTransport(invoke);

    await transport.call({
      command: "/ip/hotspot/user/add",
      host: "10.250.0.2",
      password: "mikrotik-password-must-not-leak",
      params: { name: "voucher-username-must-not-leak", password: "voucher-password-must-not-leak" },
      port: 8728,
      username: "ticketpro-sensitive-user"
    });
    metrics.setRouterCreateOutcome({ failed: 0, requested: 1, succeeded: 1, uncertain: 0 });
    const report = endVoucherGenerationPerformance(metrics);

    expect(report).toContain("routerCommandCount = 1");
    expect(report).toContain("routerConnectionCount = 1");
    expect(report).toContain("avg = 25.00 ms");
    expect(report).not.toContain("mikrotik-password-must-not-leak");
    expect(report).not.toContain("voucher-username-must-not-leak");
    expect(report).not.toContain("voucher-password-must-not-leak");
    expect(report).not.toContain("ticketpro-sensitive-user");
  });

  it("conserve l'erreur metier native apres avoir collecte les mesures", async () => {
    const logger = vi.fn();
    const metrics = beginVoucherGenerationPerformance(10, { logger });
    const invoke = vi.fn(async () => ({
      error: "router offline: injected failure",
      metrics: {
        authDurationMs: 0,
        commandCount: 0,
        commandTimings: [],
        connectDurationMs: 12,
        connectionCount: 2,
        fatalCount: 0,
        retryCount: 1,
        trapCount: 0
      },
      rows: []
    }));
    const transport = new TauriRouterOsApiTransport(invoke);

    await expect(transport.call({
      command: "/system/resource/print",
      host: "10.250.0.2",
      password: "secret",
      port: 8728,
      username: "api-user"
    })).rejects.toThrow("router offline: injected failure");
    metrics.markFailed();
    const report = endVoucherGenerationPerformance(metrics);

    expect(report).toContain("result=error");
    expect(report).toContain("routerConnectionCount = 2");
    expect(report).toContain("routerRetryCount = 1");
  });
});
