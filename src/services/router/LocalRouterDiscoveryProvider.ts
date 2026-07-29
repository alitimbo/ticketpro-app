import type { RouterConnectionMode, RouterSystemInfo } from "../../domain/router";

export type DiscoveredRouterCandidate = {
  apiPort: number;
  apiSslPort: number;
  host: string;
  id: string;
  isReachable: boolean;
  mode: RouterConnectionMode;
  name: string;
  systemInfo: RouterSystemInfo;
};

export interface LocalRouterDiscoveryProvider {
  scan(): Promise<DiscoveredRouterCandidate[]>;
}

/**
 * Placeholder kept for dependency compatibility. It deliberately never
 * returns fabricated routers: discovery must be implemented by a real Tauri
 * network provider before the UI can expose it again.
 */
export class FakeLocalRouterDiscoveryProvider implements LocalRouterDiscoveryProvider {
  async scan(): Promise<DiscoveredRouterCandidate[]> {
    throw new Error("La découverte réseau automatique n'est pas encore disponible.");
  }
}
