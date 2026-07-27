import { invoke } from "@tauri-apps/api/core";

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
  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    return invoke<RouterOsApiRow[]>("mikrotik_api_call", {
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
