import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../config/runtime";

export type WireGuardTunnelStatus = {
  active: boolean;
  configPath: string;
  tunnelName: string;
};

export type InstalledWireGuardTunnel = {
  active: boolean;
  assignedAddress: string | null;
  publicKey: string | null;
  tunnelName: string;
};

export type VpnRuntimeState =
  | "UNAVAILABLE"
  | "INSTALLING"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "REVOKED"
  | "SUBSCRIPTION_REQUIRED"
  | "ERROR";

export type VpnProviderStatus = {
  provider: "LEGACY" | "EMBEDDED";
  state: VpnRuntimeState;
  serviceName: string;
  serviceVersion: string | null;
  detailCode: string | null;
  lastHandshakeUnixSeconds: number | null;
  rxBytes: number;
  txBytes: number;
};

export type VpnPublicIdentity = {
  installationId: string;
  publicKey: string;
  keyVersion: number;
};

export type VpnTunnelConfig = {
  configVersion: number;
  address: string;
  gatewayPublicKey: string;
  endpointHost: string;
  endpointPort: number;
  allowedIps: string[];
  persistentKeepalive: number;
};

export function buildWireGuardTunnelName(peerId: string): string {
  if (/^tp-[a-zA-Z0-9_=+.-]+$/.test(peerId) && peerId.length <= 32) {
    return peerId;
  }
  const normalized = peerId.replace(/[^a-zA-Z0-9_=+.-]/g, "-");
  const suffix = normalized.slice(-29) || "tunnel";
  return `tp-${suffix}`;
}

export async function listInstalledTicketProTunnels(): Promise<InstalledWireGuardTunnel[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    return await invoke<InstalledWireGuardTunnel[]>("wireguard_list_ticketpro_tunnels");
  } catch (error) {
    throw normalizeTauriError(error, "Impossible d'inventorier les tunnels WireGuard TicketPro.");
  }
}

export async function getVpnProviderStatus(): Promise<VpnProviderStatus> {
  if (!isTauriRuntime()) {
    return {
      provider: "LEGACY",
      state: "UNAVAILABLE",
      serviceName: "WireGuardTunnel$tp-*",
      serviceVersion: null,
      detailCode: "TAURI_RUNTIME_UNAVAILABLE",
      lastHandshakeUnixSeconds: null,
      rxBytes: 0,
      txBytes: 0
    };
  }

  try {
    return await invoke<VpnProviderStatus>("vpn_provider_status");
  } catch (error) {
    throw normalizeTauriError(error, "Impossible de lire l'etat du fournisseur VPN TicketPro.");
  }
}

export async function ensureVpnIdentity(): Promise<VpnPublicIdentity> {
  if (!isTauriRuntime()) {
    throw new Error("L'identite VPN securisee necessite l'application Windows TicketPro.");
  }

  try {
    return await invoke<VpnPublicIdentity>("vpn_ensure_identity");
  } catch (error) {
    throw normalizeTauriError(error, "Impossible de preparer l'identite VPN de cet appareil.");
  }
}

export async function applyEmbeddedVpnConfig(config: VpnTunnelConfig): Promise<void> {
  await invokeEmbeddedVpn("vpn_apply_config", { config });
}

export async function connectEmbeddedVpn(): Promise<void> {
  await invokeEmbeddedVpn("vpn_connect");
}

export async function disconnectEmbeddedVpn(): Promise<void> {
  await invokeEmbeddedVpn("vpn_disconnect");
}

export async function repairEmbeddedVpn(): Promise<void> {
  await invokeEmbeddedVpn("vpn_repair");
}

export async function prepareVpnIdentityRotation(): Promise<VpnPublicIdentity> {
  if (!isTauriRuntime()) {
    throw new Error("La rotation VPN nécessite l'application Windows TicketPro.");
  }
  try {
    return await invoke<VpnPublicIdentity>("vpn_prepare_identity_rotation");
  } catch (error) {
    throw normalizeTauriError(error, "Impossible de préparer la nouvelle identité VPN.");
  }
}

export async function commitVpnIdentityRotation(): Promise<void> {
  await invokeEmbeddedVpn("vpn_commit_identity_rotation");
}

export async function abortVpnIdentityRotation(): Promise<void> {
  await invokeEmbeddedVpn("vpn_abort_identity_rotation");
}

export async function isWireGuardAvailable(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    return await invoke<boolean>("wireguard_available");
  } catch (error) {
    throw normalizeTauriError(error, "Impossible de vérifier l'installation de WireGuard.");
  }
}

export async function installWireGuard(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("L'installation automatique de WireGuard nécessite l'application Windows TicketPro.");
  }

  try {
    await invoke("wireguard_install");
  } catch (error) {
    throw normalizeTauriError(error, "L'installation automatique de WireGuard a échoué.");
  }
}

export async function startWireGuardTunnel(tunnelName: string, config: string): Promise<WireGuardTunnelStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Le tunnel WireGuard automatique nécessite l'application Windows TicketPro.");
  }

  try {
    return await invoke<WireGuardTunnelStatus>("wireguard_tunnel_up", {
      input: { config, tunnelName }
    });
  } catch (error) {
    throw normalizeTauriError(error, "Le tunnel WireGuard n'a pas pu être démarré.");
  }
}

export async function stopWireGuardTunnel(tunnelName: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("wireguard_tunnel_down", { tunnelName });
  } catch (error) {
    throw normalizeTauriError(error, "Le tunnel WireGuard n'a pas pu être arrêté.");
  }
}

function normalizeTauriError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return new Error(candidate.message.trim());
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return new Error(candidate.error.trim());
    }

    try {
      return new Error(JSON.stringify(error));
    } catch {
      // Le message de repli reste plus utile qu'un objet non sérialisable.
    }
  }

  return new Error(fallback);
}

async function invokeEmbeddedVpn(command: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("La connexion VPN securisee necessite l'application Windows TicketPro.");
  }
  try {
    await invoke(command, args);
  } catch (error) {
    throw normalizeTauriError(error, "L'operation VPN securisee a echoue.");
  }
}
