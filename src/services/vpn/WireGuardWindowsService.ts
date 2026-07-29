import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../config/runtime";

export type WireGuardTunnelStatus = {
  active: boolean;
  configPath: string;
  tunnelName: string;
};

export function buildWireGuardTunnelName(peerId: string): string {
  const normalized = peerId.replace(/[^a-zA-Z0-9_=+.-]/g, "-");
  const suffix = normalized.slice(-29) || "tunnel";
  return `tp-${suffix}`;
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
