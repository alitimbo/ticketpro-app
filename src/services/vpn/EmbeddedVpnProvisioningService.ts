import { getAppMetadata } from "../app/appMetadata";
import {
  heartbeatSaasDevice,
  registerSaasDevice,
  type SaasDeviceRegistration
} from "../saas";
import {
  applyEmbeddedVpnConfig,
  connectEmbeddedVpn,
  disconnectEmbeddedVpn,
  ensureVpnIdentity,
  getVpnProviderStatus,
  type VpnProviderStatus,
  type VpnPublicIdentity
} from "./WireGuardWindowsService";

const connectionTimeoutMs = 20_000;
const statusPollIntervalMs = 750;
let provisioningQueue: Promise<void> = Promise.resolve();

export async function waitForEmbeddedVpnProvisioning(): Promise<void> {
  await provisioningQueue;
}

export type EmbeddedVpnProvisioningResult = {
  installationId: string | null;
  state: "SKIPPED" | "CONNECTED" | "DEGRADED" | "PENDING";
  status: VpnProviderStatus;
};

export type EmbeddedVpnProvisioningDependencies = {
  applyConfig: typeof applyEmbeddedVpnConfig;
  connect: typeof connectEmbeddedVpn;
  disconnect: typeof disconnectEmbeddedVpn;
  ensureIdentity: typeof ensureVpnIdentity;
  getMetadata: typeof getAppMetadata;
  getStatus: typeof getVpnProviderStatus;
  heartbeat: typeof heartbeatSaasDevice;
  registerDevice: typeof registerSaasDevice;
  wait: (durationMs: number) => Promise<void>;
};

const defaultDependencies: EmbeddedVpnProvisioningDependencies = {
  applyConfig: applyEmbeddedVpnConfig,
  connect: connectEmbeddedVpn,
  disconnect: disconnectEmbeddedVpn,
  ensureIdentity: ensureVpnIdentity,
  getMetadata: getAppMetadata,
  getStatus: getVpnProviderStatus,
  heartbeat: heartbeatSaasDevice,
  registerDevice: registerSaasDevice,
  wait: (durationMs) => new Promise((resolve) => window.setTimeout(resolve, durationMs))
};

export class EmbeddedVpnProvisioningService {
  constructor(private readonly dependencies: EmbeddedVpnProvisioningDependencies = defaultDependencies) {}

  async ensureConnected(
    deviceName?: string,
    replacementDeviceId?: string
  ): Promise<EmbeddedVpnProvisioningResult> {
    return enqueueProvisioning(() => this.ensureConnectedNow(deviceName, replacementDeviceId));
  }

  private async ensureConnectedNow(
    deviceName?: string,
    replacementDeviceId?: string
  ): Promise<EmbeddedVpnProvisioningResult> {
    const initialStatus = await this.dependencies.getStatus();
    if (initialStatus.provider !== "EMBEDDED") {
      return { installationId: null, state: "SKIPPED", status: initialStatus };
    }

    const [identity, metadata] = await Promise.all([
      this.dependencies.ensureIdentity(),
      this.dependencies.getMetadata()
    ]);
    const registration = await this.dependencies.registerDevice({
      installationId: identity.installationId,
      publicKey: identity.publicKey,
      name: normalizeDeviceName(deviceName, identity),
      platform: "windows",
      osVersion: readWindowsDescription(),
      appVersion: metadata.version,
      replacementDeviceId
    });
    await this.applyAndConnect(registration);
    const status = await this.waitForConnection();
    const heartbeat = await this.dependencies.heartbeat({
      installationId: identity.installationId,
      appVersion: metadata.version
    });
    if (!heartbeat.vpn_access || heartbeat.status === "revoked") {
      await this.dependencies.disconnect();
    }
    return {
      installationId: identity.installationId,
      state: status.state === "CONNECTED"
        ? "CONNECTED"
        : status.state === "DEGRADED"
          ? "DEGRADED"
          : "PENDING",
      status
    };
  }

  async heartbeatCurrent(): Promise<void> {
    const [identity, metadata] = await Promise.all([
      this.dependencies.ensureIdentity(),
      this.dependencies.getMetadata()
    ]);
    await this.dependencies.heartbeat({
      installationId: identity.installationId,
      appVersion: metadata.version
    });
  }

  private async applyAndConnect(registration: SaasDeviceRegistration): Promise<void> {
    await this.dependencies.applyConfig({
      configVersion: registration.vpn.config_version,
      address: registration.vpn.address,
      gatewayPublicKey: registration.vpn.gateway_public_key,
      endpointHost: normalizeEndpointHost(registration.vpn.endpoint),
      endpointPort: registration.vpn.port,
      allowedIps: registration.vpn.allowed_ips,
      persistentKeepalive: registration.vpn.persistent_keepalive
    });
    await this.dependencies.connect();
  }

  private async waitForConnection(): Promise<VpnProviderStatus> {
    const deadline = Date.now() + connectionTimeoutMs;
    let status = await this.dependencies.getStatus();
    while (
      Date.now() < deadline
      && !["CONNECTED", "DEGRADED", "ERROR", "REVOKED", "SUBSCRIPTION_REQUIRED"].includes(status.state)
    ) {
      await this.dependencies.wait(statusPollIntervalMs);
      status = await this.dependencies.getStatus();
    }
    return status;
  }
}

function enqueueProvisioning<T>(operation: () => Promise<T>): Promise<T> {
  let release: (() => void) | null = null;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = provisioningQueue;
  provisioningQueue = previous.then(() => next, () => next);

  return previous
    .then(operation)
    .finally(() => release?.());
}

function normalizeDeviceName(name: string | undefined, identity: VpnPublicIdentity): string {
  const value = name?.trim();
  return value ? value.slice(0, 200) : `PC TicketPro ${identity.installationId.slice(0, 8)}`;
}

function normalizeEndpointHost(endpoint: string): string {
  const value = endpoint.trim();
  if (!value || value.includes("://") || value.includes("/") || value.includes(":")) {
    throw new Error("L'adresse du gateway VPN TicketPro est invalide.");
  }
  return value;
}

function readWindowsDescription(): string {
  if (typeof navigator === "undefined") return "Windows";
  return navigator.userAgent.slice(0, 200) || "Windows";
}
