export {
  allocateWireGuardAddress,
  buildOperatorWireGuardConfig,
  buildRouterOsWireGuardScript,
  generateWireGuardKeyPair,
  protectWireGuardPrivateKey,
  revealWireGuardPrivateKey
} from "./wireguard";
export {
  buildWireGuardTunnelName,
  installWireGuard,
  isWireGuardAvailable,
  listInstalledTicketProTunnels,
  startWireGuardTunnel,
  stopWireGuardTunnel
} from "./WireGuardWindowsService";
export type {
  InstalledWireGuardTunnel,
  WireGuardTunnelStatus
} from "./WireGuardWindowsService";
export type { VpnPeerConfig, WireGuardKeyPair } from "./wireguard";
