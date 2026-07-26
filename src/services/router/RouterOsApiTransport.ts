import { invoke } from "@tauri-apps/api/core";

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
  params?: Record<string, string | number | boolean | null | undefined>;
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
        params: request.params ?? {},
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
