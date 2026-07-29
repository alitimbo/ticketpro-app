import type { RouterSystemInfo } from "../../domain/router";
import {
  MikroTikRouterAdapter,
  normalizeMikroTikError,
  type MikroTikRouterAdapterOptions
} from "./MikroTikRouterAdapter";
import {
  TauriRouterOsApiTransport,
  type RouterOsApiConfig,
  type RouterOsApiRow,
  type RouterOsApiTransport
} from "./RouterOsApiTransport";

/**
 * RouterOS CHR and x86 installations do not necessarily expose a physical
 * RouterBOARD resource. The standard resource endpoint is authoritative for
 * connection validation; RouterBOARD metadata is therefore optional.
 */
export class CompatibleMikroTikRouterAdapter extends MikroTikRouterAdapter {
  private readonly apiConfig: RouterOsApiConfig;
  private readonly apiTransport: RouterOsApiTransport;

  constructor(options: MikroTikRouterAdapterOptions) {
    super(options);
    this.apiConfig = {
      host: options.host,
      password: options.password,
      port: options.port,
      retries: options.retries ?? 1,
      timeoutMs: options.timeoutMs ?? 5000,
      useSsl: options.useSsl ?? false,
      username: options.username
    };
    this.apiTransport = options.transport ?? new TauriRouterOsApiTransport();
  }

  override async getSystemInfo(): Promise<RouterSystemInfo> {
    let resourceRows: RouterOsApiRow[];

    try {
      resourceRows = await this.apiTransport.call({
        ...this.apiConfig,
        command: "/system/resource/print"
      });
    } catch (error) {
      throw normalizeMikroTikError(error);
    }

    let routerboardRows: RouterOsApiRow[] = [];
    try {
      routerboardRows = await this.apiTransport.call({
        ...this.apiConfig,
        command: "/system/routerboard/print"
      });
    } catch {
      // CHR/x86 has no physical RouterBOARD. Resource information remains valid.
    }

    const resource = firstRow(resourceRows);
    const routerboard = firstRow(routerboardRows);

    return {
      architecture: pick(resource, "architecture-name", "architecture") || "inconnue",
      boardName: pick(resource, "board-name") || pick(routerboard, "board-name") || "RouterOS virtuel/x86",
      identity: pick(resource, "platform") || pick(routerboard, "model") || this.apiConfig.host,
      model: pick(routerboard, "model") || pick(resource, "board-name") || "MikroTik RouterOS",
      routerOsVersion: pick(resource, "version") || "inconnue",
      serialNumber: pick(routerboard, "serial-number") || "non disponible",
      uptime: pick(resource, "uptime") || "0s"
    };
  }
}

function firstRow(rows: RouterOsApiRow[]): RouterOsApiRow {
  return rows[0] ?? {};
}

function pick(row: RouterOsApiRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return undefined;
}
