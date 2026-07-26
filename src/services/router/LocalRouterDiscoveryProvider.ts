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

export class FakeLocalRouterDiscoveryProvider implements LocalRouterDiscoveryProvider {
  async scan(): Promise<DiscoveredRouterCandidate[]> {
    return [
      {
        apiPort: 8728,
        apiSslPort: 8729,
        host: "192.168.88.1",
        id: "scan-192-168-88-1",
        isReachable: true,
        mode: "local",
        name: "Routeur detecte",
        systemInfo: {
          architecture: "arm64",
          boardName: "C52iG-5HaxD2HaxD",
          identity: "hotspot-boutique-centre",
          model: "hAP ax²",
          routerOsVersion: "7.15.3",
          serialNumber: "HAX2-SCAN-2026",
          uptime: "2d 04:18:09"
        }
      }
    ];
  }
}

