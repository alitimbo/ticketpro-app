export {
  allocateWireGuardAddress,
  buildOperatorWireGuardConfig,
  buildRouterOsWireGuardScript,
  generateWireGuardKeyPair,
  protectWireGuardPrivateKey,
  revealWireGuardPrivateKey
} from "./wireguard";
export { installWireGuard, isWireGuardAvailable, startWireGuardTunnel, stopWireGuardTunnel } from "./WireGuardWindowsService";
export type { WireGuardTunnelStatus } from "./WireGuardWindowsService";
export type { VpnPeerConfig, WireGuardKeyPair } from "./wireguard";
