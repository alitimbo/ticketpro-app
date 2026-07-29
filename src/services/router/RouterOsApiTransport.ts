import { invoke } from "@tauri-apps/api/core";

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

export interface RouterOsApiTransport {
  call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]>;
}

export class TauriRouterOsApiTransport implements RouterOsApiTransport {
  constructor(private readonly invokeCommand: TauriInvoke = invoke) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    const endpoint = `${request.host.trim().toLowerCase()}:${request.port}`;
    const limiter = getEndpointLimiter(endpoint);

    return limiter.run(async () =>
      this.invokeCommand("mikrotik_api_call", {
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
      }).then((rows) => rows as RouterOsApiRow[])
    );
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
