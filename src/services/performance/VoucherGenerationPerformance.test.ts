import { describe, expect, it, vi } from "vitest";
import {
  VoucherGenerationPerformanceMetrics,
  beginVoucherGenerationPerformance,
  endVoucherGenerationPerformance,
  recordActiveOutboxRetry,
  recordActiveRouterOsPerformance,
  recordActiveVpsRequest
} from "./VoucherGenerationPerformance";

function clock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe("VoucherGenerationPerformanceMetrics", () => {
  it("produit un rapport agrege sans accepter ni journaliser de secrets", async () => {
    const logger = vi.fn();
    const metrics = beginVoucherGenerationPerformance(3, {
      logger,
      now: clock([0, 10, 25, 30, 50, 100])
    });

    await metrics.measure("LIFECYCLE_PREFLIGHT", async () => undefined);
    metrics.startPhase("ROUTER_CREATE");
    metrics.endPhase("ROUTER_CREATE");
    recordActiveRouterOsPerformance({
      authDurationMs: 8,
      commandCount: 3,
      commandTimings: [
        { command: "/ip/hotspot/user/add", durationMs: 100, outcome: "success" },
        { command: "/ip/hotspot/user/add", durationMs: 200, outcome: "success" },
        { command: "/ip/hotspot/user/add", durationMs: 300, outcome: "trap" }
      ],
      connectDurationMs: 12,
      connectionCount: 1,
      fatalCount: 0,
      retryCount: 0,
      trapCount: 1
    });
    recordActiveVpsRequest();
    recordActiveOutboxRetry(2);
    metrics.setRouterCreateOutcome({ failed: 1, requested: 3, succeeded: 2, uncertain: 0 });

    const report = endVoucherGenerationPerformance(metrics);

    expect(logger).toHaveBeenCalledWith(report);
    expect(report).toContain("count=3");
    expect(report).toContain("routerCommandCount = 3");
    expect(report).toContain("p50 = 200.00 ms");
    expect(report).toContain("p95 = 300.00 ms");
    expect(report).toContain("vpsRequestCount = 1");
    expect(report).toContain("outboxRetryCount = 2");
    expect(report).not.toContain("password");
    expect(report).not.toContain("username");
    expect(report).not.toContain("token");
  });

  it("journalise aussi un rapport partiel lorsqu'une etape echoue", () => {
    const logger = vi.fn();
    const metrics = new VoucherGenerationPerformanceMetrics(500, {
      logger,
      now: clock([0, 10, 20])
    });
    metrics.startPhase("SQLITE_TRANSACTION");
    metrics.markFailed();

    expect(() => metrics.finish()).not.toThrow();
    expect(logger.mock.calls[0][0]).toContain("result=error");
    expect(logger.mock.calls[0][0]).toContain("uncertain = 0");
  });

  it("ne laisse jamais une erreur de logger casser la generation", () => {
    const metrics = new VoucherGenerationPerformanceMetrics(10, {
      logger: () => { throw new Error("logger unavailable"); },
      now: clock([0, 1])
    });

    expect(() => metrics.finish()).not.toThrow();
  });
});
