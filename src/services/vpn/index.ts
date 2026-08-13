export {
  allocateWireGuardAddress,
  buildOperatorWireGuardConfig,
  buildRouterOsWireGuardScript,
  generateWireGuardKeyPair,
  protectWireGuardPrivateKey,
  revealWireGuardPrivateKey
} from "./wireguard";
export {
  applyEmbeddedVpnConfig,
  abortVpnIdentityRotation,
  buildWireGuardTunnelName,
  connectEmbeddedVpn,
  commitVpnIdentityRotation,
  disconnectEmbeddedVpn,
  ensureVpnIdentity,
  getVpnProviderStatus,
  installWireGuard,
  isWireGuardAvailable,
  listInstalledTicketProTunnels,
  prepareVpnIdentityRotation,
  repairEmbeddedVpn,
  startWireGuardTunnel,
  stopWireGuardTunnel
} from "./WireGuardWindowsService";
export type {
  InstalledWireGuardTunnel,
  VpnPublicIdentity,
  VpnProviderStatus,
  VpnRuntimeState,
  VpnTunnelConfig,
  WireGuardTunnelStatus
} from "./WireGuardWindowsService";
export {
  EmbeddedVpnProvisioningService,
  waitForEmbeddedVpnProvisioning,
  type EmbeddedVpnProvisioningDependencies,
  type EmbeddedVpnProvisioningResult
} from "./EmbeddedVpnProvisioningService";
export type { VpnPeerConfig, WireGuardKeyPair } from "./wireguard";
