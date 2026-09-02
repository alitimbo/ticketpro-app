export type VoucherGenerationPhase =
  | "GENERATE_IDENTIFIERS"
  | "LIFECYCLE_PREFLIGHT"
  | "SQLITE_TRANSACTION"
  | "OUTBOX_WRITE"
  | "ROUTER_CREATE"
  | "ROUTER_VERIFY"
  | "SQLITE_CONFIRM"
  | "VPS_SYNC"
  | "PDF_GENERATION"
  | "VPS_FILE_SYNC";

export type RouterOsCommandPerformance = {
  command: string;
  durationMs: number;
  outcome: "success" | "trap" | "fatal" | "connection";
};

export type RouterOsNativePerformance = {
  authDurationMs: number;
  commandCount: number;
  commandTimings: RouterOsCommandPerformance[];
  connectDurationMs: number;
  connectionCount: number;
  fatalCount: number;
  retryCount: number;
  trapCount: number;
};

type RouterCreateOutcome = {
  failed: number;
  requested: number;
  succeeded: number;
  uncertain: number;
};

type VoucherGenerationPerformanceOptions = {
  logger?: (message: string) => void;
  now?: () => number;
};

const PHASES: VoucherGenerationPhase[] = [
  "GENERATE_IDENTIFIERS",
  "LIFECYCLE_PREFLIGHT",
  "SQLITE_TRANSACTION",
  "OUTBOX_WRITE",
  "ROUTER_CREATE",
  "ROUTER_VERIFY",
  "SQLITE_CONFIRM",
  "VPS_SYNC",
  "PDF_GENERATION",
  "VPS_FILE_SYNC"
];

const ROUTER_CREATE_COMMAND = "/ip/hotspot/user/add";

/**
 * Collecteur purement observateur pour une seule generation commerciale.
 * Il n'accepte aucun payload metier afin qu'un secret ne puisse pas etre
 * journalise accidentellement avec les mesures.
 */
export class VoucherGenerationPerformanceMetrics {
  private readonly durations = new Map<VoucherGenerationPhase, number>();
  private readonly activePhases = new Map<VoucherGenerationPhase, number>();
  private readonly routerCommandTimings: RouterOsCommandPerformance[] = [];
  private readonly startedAt: number;
  private finished = false;
  private outcome: "success" | "error" = "success";
  private outboxRetryCount = 0;
  private routerAuthDurationMs = 0;
  private routerCommandCount = 0;
  private routerConnectDurationMs = 0;
  private routerConnectionCount = 0;
  private routerFatalCount = 0;
  private routerRetryCount = 0;
  private routerTrapCount = 0;
  private vpsRequestCount = 0;
  private routerCreateOutcome: RouterCreateOutcome;
  private readonly logger: (message: string) => void;
  private readonly now: () => number;

  constructor(
    requestedCount: number,
    options: VoucherGenerationPerformanceOptions = {}
  ) {
    this.now = options.now ?? monotonicNow;
    this.logger = options.logger ?? ((message) => console.info(message));
    this.startedAt = this.now();
    this.routerCreateOutcome = {
      failed: 0,
      requested: Math.max(0, requestedCount),
      succeeded: 0,
      uncertain: 0
    };
  }

  startPhase(phase: VoucherGenerationPhase): void {
    if (this.finished || this.activePhases.has(phase)) return;
    this.activePhases.set(phase, this.now());
  }

  endPhase(phase: VoucherGenerationPhase): void {
    const startedAt = this.activePhases.get(phase);
    if (startedAt === undefined) return;
    this.activePhases.delete(phase);
    this.addDuration(phase, Math.max(0, this.now() - startedAt));
  }

  async measure<T>(phase: VoucherGenerationPhase, operation: () => Promise<T>): Promise<T> {
    this.startPhase(phase);
    try {
      return await operation();
    } finally {
      this.endPhase(phase);
    }
  }

  measureSync<T>(phase: VoucherGenerationPhase, operation: () => T): T {
    this.startPhase(phase);
    try {
      return operation();
    } finally {
      this.endPhase(phase);
    }
  }

  recordRouterOs(metrics: RouterOsNativePerformance | null | undefined): void {
    if (!metrics || this.finished) return;
    this.routerAuthDurationMs += finiteNonNegative(metrics.authDurationMs);
    this.routerCommandCount += integerNonNegative(metrics.commandCount);
    this.routerConnectDurationMs += finiteNonNegative(metrics.connectDurationMs);
    this.routerConnectionCount += integerNonNegative(metrics.connectionCount);
    this.routerFatalCount += integerNonNegative(metrics.fatalCount);
    this.routerRetryCount += integerNonNegative(metrics.retryCount);
    this.routerTrapCount += integerNonNegative(metrics.trapCount);
    (Array.isArray(metrics.commandTimings) ? metrics.commandTimings : []).forEach((timing) => {
      if (
        typeof timing.command === "string"
        && Number.isFinite(timing.durationMs)
        && timing.durationMs >= 0
        && ["success", "trap", "fatal", "connection"].includes(timing.outcome)
      ) {
        this.routerCommandTimings.push({
          command: timing.command,
          durationMs: timing.durationMs,
          outcome: timing.outcome
        });
      }
    });
  }

  recordVpsRequest(count = 1): void {
    this.vpsRequestCount += integerNonNegative(count);
  }

  recordOutboxRetry(count = 1): void {
    this.outboxRetryCount += integerNonNegative(count);
  }

  setRouterCreateOutcome(outcome: RouterCreateOutcome): void {
    this.routerCreateOutcome = {
      failed: integerNonNegative(outcome.failed),
      requested: integerNonNegative(outcome.requested),
      succeeded: integerNonNegative(outcome.succeeded),
      uncertain: integerNonNegative(outcome.uncertain)
    };
  }

  markFailed(): void {
    this.outcome = "error";
  }

  finish(): string {
    if (this.finished) return this.formatReport(Math.max(0, this.now() - this.startedAt));
    this.activePhases.forEach((_startedAt, phase) => this.endPhase(phase));
    this.finished = true;
    const totalDurationMs = Math.max(0, this.now() - this.startedAt);
    const report = this.formatReport(totalDurationMs);
    try {
      this.logger(report);
    } catch {
      // L'instrumentation ne doit jamais faire echouer une generation.
    }
    return report;
  }

  private addDuration(phase: VoucherGenerationPhase, durationMs: number): void {
    this.durations.set(phase, (this.durations.get(phase) ?? 0) + durationMs);
  }

  private formatReport(totalDurationMs: number): string {
    const createLatencies = this.routerCommandTimings
      .filter((timing) => timing.command === ROUTER_CREATE_COMMAND)
      .map((timing) => timing.durationMs)
      .sort((left, right) => left - right);
    const sum = createLatencies.reduce((total, duration) => total + duration, 0);
    const average = createLatencies.length > 0 ? sum / createLatencies.length : 0;
    const minimum = createLatencies[0] ?? 0;
    const maximum = createLatencies[createLatencies.length - 1] ?? 0;

    return [
      "=== TICKETPRO VOUCHER GENERATION PERF ===",
      `count=${this.routerCreateOutcome.requested}`,
      `result=${this.outcome}`,
      "",
      ...PHASES.slice(0, 4).map((phase) => `${phase} = ${formatDuration(this.durations.get(phase) ?? 0)}`),
      `ROUTER_CONNECT = ${formatDuration(this.routerConnectDurationMs)}`,
      `ROUTER_AUTH = ${formatDuration(this.routerAuthDurationMs)}`,
      "",
      "ROUTER:",
      `  create = ${formatDuration(this.durations.get("ROUTER_CREATE") ?? 0)}`,
      `  verify = ${formatDuration(this.durations.get("ROUTER_VERIFY") ?? 0)}`,
      `  requested = ${this.routerCreateOutcome.requested}`,
      `  succeeded = ${this.routerCreateOutcome.succeeded}`,
      `  failed = ${this.routerCreateOutcome.failed}`,
      `  uncertain = ${this.routerCreateOutcome.uncertain}`,
      `  routerCommandCount = ${this.routerCommandCount}`,
      `  routerConnectionCount = ${this.routerConnectionCount}`,
      `  routerRetryCount = ${this.routerRetryCount}`,
      `  routerTrapCount = ${this.routerTrapCount}`,
      `  routerFatalCount = ${this.routerFatalCount}`,
      `  avg = ${formatDuration(average)}`,
      `  p50 = ${formatDuration(percentile(createLatencies, 0.5))}`,
      `  p95 = ${formatDuration(percentile(createLatencies, 0.95))}`,
      `  min = ${formatDuration(minimum)}`,
      `  max = ${formatDuration(maximum)}`,
      "",
      `SQLITE_CONFIRM = ${formatDuration(this.durations.get("SQLITE_CONFIRM") ?? 0)}`,
      `VPS_SYNC = ${formatDuration(this.durations.get("VPS_SYNC") ?? 0)}`,
      `PDF_GENERATION = ${formatDuration(this.durations.get("PDF_GENERATION") ?? 0)}`,
      `VPS_FILE_SYNC = ${formatDuration(this.durations.get("VPS_FILE_SYNC") ?? 0)}`,
      `vpsRequestCount = ${this.vpsRequestCount}`,
      `outboxRetryCount = ${this.outboxRetryCount}`,
      "",
      `TOTAL = ${formatDuration(totalDurationMs)}`,
      "========================================="
    ].join("\n");
  }
}

let activeVoucherGeneration: VoucherGenerationPerformanceMetrics | null = null;

export function beginVoucherGenerationPerformance(
  requestedCount: number,
  options: VoucherGenerationPerformanceOptions = {}
): VoucherGenerationPerformanceMetrics {
  const metrics = new VoucherGenerationPerformanceMetrics(requestedCount, options);
  activeVoucherGeneration = metrics;
  return metrics;
}

export function endVoucherGenerationPerformance(metrics: VoucherGenerationPerformanceMetrics): string {
  if (activeVoucherGeneration === metrics) activeVoucherGeneration = null;
  return metrics.finish();
}

export function recordActiveRouterOsPerformance(metrics: RouterOsNativePerformance | null | undefined): void {
  activeVoucherGeneration?.recordRouterOs(metrics);
}

export function recordActiveVpsRequest(): void {
  activeVoucherGeneration?.recordVpsRequest();
}

export function recordActiveOutboxRetry(count = 1): void {
  activeVoucherGeneration?.recordOutboxRetry(count);
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function integerNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * ratio) - 1);
  return sortedValues[index] ?? 0;
}

function formatDuration(durationMs: number): string {
  return `${finiteNonNegative(durationMs).toFixed(2)} ms`;
}
