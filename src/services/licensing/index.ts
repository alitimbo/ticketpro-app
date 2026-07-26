export {
  activateLicense,
  getLicenseDeviceIdentity,
  isLicenseApiConfigured,
  listLicensePlans,
  protectLicenseToken,
  signLicenseDevicePayload,
  unprotectLicenseToken,
  validateLicense,
  type LicenseActivationResult,
  type LicenseApiState,
  type LicensePlan
} from "./LicenseClient";
export { localLicenseAllowsRouterCreation, routerLicenseFingerprint, validateStoredLicense } from "./LicenseGuard";
export {
  bootstrapLicenseVpn,
  revokeLicenseVpnPeer,
  upsertLicenseVpnPeer
} from "./LicenseClient";
export type { LicenseVpnBootstrap, LicenseVpnPeerResult } from "./LicenseClient";
