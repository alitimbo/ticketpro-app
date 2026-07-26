import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../config/runtime";

export type WireGuardTunnelStatus = {
  active: boolean;
  configPath: string;
  tunnelName: string;
};

export async function isWireGuardAvailable(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return invoke<boolean>("wireguard_available");
}

export async function installWireGuard(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("L'installation automatique de WireGuard nécessite l'application Windows TicketPro.");
  }
  await invoke("wireguard_install");
}

export async function startWireGuardTunnel(tunnelName: string, config: string): Promise<WireGuardTunnelStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Le tunnel WireGuard automatique nécessite l'application Windows TicketPro.");
  }
  return invoke<WireGuardTunnelStatus>("wireguard_tunnel_up", {
    input: { config, tunnelName }
  });
}

export async function stopWireGuardTunnel(tunnelName: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("wireguard_tunnel_down", { tunnelName });
}
