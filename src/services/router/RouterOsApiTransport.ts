import { invoke } from "@tauri-apps/api/core";
import {
  recordActiveRouterOsPerformance,
  type RouterOsNativePerformance
} from "../performance/VoucherGenerationPerformance";

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

const endpointLimiters = new Map<string, ConcurrencyLimiter>();

export type RouterOsApiValue = string | number | boolean | null | undefined;

export type RouterOsApiConfig = {
  host: string;
  password: string;
  port: number;
  retries?: number;
  timeoutMs?: number;
  useSsl?: boolean;
  username: string;
};

export type RouterOsApiRequest = RouterOsApiConfig & {
  command: string;
  /** Attributes sent as =name=value words for add/set/action commands. */
  params?: Record<string, RouterOsApiValue>;
  /** Query words sent as ?name=value for filtered print commands. */
  queries?: Record<string, RouterOsApiValue>;
};

export type RouterOsApiRow = Record<string, string>;

export type RouterOsApiBatchCommand = Pick<
  RouterOsApiRequest,
  "command" | "params" | "queries"
>;

export type RouterOsApiBatchItemResult = {
  error: string | null;
  rows: RouterOsApiRow[];
};

export type RouterOsApiBatchResponse = {
  completedCount: number;
  connectionError: string | null;
  error?: string | null;
  metrics?: RouterOsNativePerformance;
  results: RouterOsApiBatchItemResult[];
};

type RouterOsApiCallResponse = {
  error: string | null;
  metrics: RouterOsNativePerformance;
  rows: RouterOsApiRow[];
};

export interface RouterOsApiTransport {
  call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]>;
  callBatch?(
    request: RouterOsApiConfig & { commands: RouterOsApiBatchCommand[] }
  ): Promise<RouterOsApiBatchResponse>;
}

export class TauriRouterOsApiTransport implements RouterOsApiTransport {
  constructor(private readonly invokeCommand: TauriInvoke = invoke) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    const endpoint = `${request.host.trim().toLowerCase()}:${request.port}`;
    const limiter = getEndpointLimiter(endpoint);

    return limiter.run(async () => {
      const response = await this.invokeCommand("mikrotik_api_call", {
        request: {
          command: request.command,
          host: request.host,
          params: normalizeActionParams(request.params ?? {}),
          queries: request.queries ?? {},
          password: request.password,
          port: request.port,
          retries: request.retries ?? 1,
          timeoutMs: request.timeoutMs ?? 5000,
          useSsl: request.useSsl ?? false,
          username: request.username
        }
      });
      // Keep compatibility with test doubles and older native development
      // binaries while the current Rust command returns the measured shape.
      if (Array.isArray(response)) return response as RouterOsApiRow[];
      const measured = response as RouterOsApiCallResponse;
      recordActiveRouterOsPerformance(measured.metrics);
      if (measured.error) throw new Error(measured.error);
      return measured.rows;
    });
  }

  async callBatch(
    request: RouterOsApiConfig & { commands: RouterOsApiBatchCommand[] }
  ): Promise<RouterOsApiBatchResponse> {
    const endpoint = `${request.host.trim().toLowerCase()}:${request.port}`;
    const limiter = getEndpointLimiter(endpoint);

    return limiter.run(async () => {
      const response = await this.invokeCommand("mikrotik_api_batch", {
        request: {
          commands: request.commands.map((command) => ({
            command: command.command,
            params: normalizeActionParams(command.params ?? {}),
            queries: command.queries ?? {}
          })),
          host: request.host,
          password: request.password,
          port: request.port,
          retries: request.retries ?? 1,
          timeoutMs: request.timeoutMs ?? 5000,
          useSsl: request.useSsl ?? false,
          username: request.username
        }
      }) as RouterOsApiBatchResponse;
      recordActiveRouterOsPerformance(response.metrics);
      if (response.error) throw new Error(response.error);
      return response;
    });
  }
}

function getEndpointLimiter(endpoint: string): ConcurrencyLimiter {
  const existing = endpointLimiters.get(endpoint);
  if (existing) return existing;
  const created = new ConcurrencyLimiter(3);
  endpointLimiters.set(endpoint, created);
  return created;
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

function normalizeActionParams(
  params: Record<string, RouterOsApiValue>
): Record<string, RouterOsApiValue> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== false && value !== undefined)
      .map(([key, value]) => [key, value === true ? "" : value])
  );
}
