import type { RouterConnectionMode } from "../../domain/router";
import { RouterAdapterError } from "./RouterAdapterError";

export type RemoteRouterConnectionMode = Exclude<RouterConnectionMode, "local">;

export type RemoteConnectionRequest = {
  localHost: string;
  mode: RemoteRouterConnectionMode;
  port: number;
  remoteHost: string;
  routerId: string;
  useSsl: boolean;
};

export type RemoteConnectionEndpoint = {
  host: string;
  mode: RemoteRouterConnectionMode;
  port: number;
  securityWarnings: string[];
  useSsl: boolean;
};

export interface RemoteConnectionProvider {
  resolveEndpoint(request: RemoteConnectionRequest): Promise<RemoteConnectionEndpoint>;
}

export class PreparedRemoteConnectionProvider implements RemoteConnectionProvider {
  async resolveEndpoint(request: RemoteConnectionRequest): Promise<RemoteConnectionEndpoint> {
    if (request.mode === "agent_future") {
      throw new RouterAdapterError("remote_unavailable", "Remote agent is not implemented yet");
    }

    if (!request.remoteHost.trim()) {
      throw new RouterAdapterError("remote_not_configured", "Remote host is missing");
    }

    return {
      host: request.remoteHost.trim(),
      mode: request.mode,
      port: request.port,
      securityWarnings: remoteSecurityWarnings,
      useSsl: request.useSsl
    };
  }
}

export const remoteSecurityWarnings = [
  "Évitez d’exposer l’API MikroTik directement sur Internet.",
  "Utilisez de préférence un VPN ou un agent distant."
];
