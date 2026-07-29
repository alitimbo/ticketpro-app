import type { RouterConnectionMode } from "../../domain/router";
import type { RouterRecord } from "../../domain/database";

export type RouterSettings = {
  apiPort: string;
  apiSslPort: string;
  connectionMode: RouterConnectionMode;
  hotspotAddress: string;
  ipAddress: string;
  name: string;
  password: string;
  username: string;
};

export const defaultRouterSettings: RouterSettings = {
  apiPort: "8728",
  apiSslPort: "8729",
  connectionMode: "local",
  hotspotAddress: "",
  ipAddress: "192.168.88.1",
  name: "",
  password: "",
  username: "admin"
};

export function routerRecordToSettings(router: RouterRecord): RouterSettings {
  return {
    apiPort: String(router.api_port),
    apiSslPort: String(router.api_ssl_port),
    connectionMode: router.connection_mode,
    hotspotAddress: router.hotspot_address ?? "",
    ipAddress: router.local_ip,
    name: router.name,
    password: "",
    username: router.username
  };
}

export function validateRouterSettings(settings: RouterSettings): string | null {
  if (!settings.name.trim()) {
    return "Renseignez le nom du routeur.";
  }

  if (!settings.ipAddress.trim()) {
    return "Renseignez l'adresse IP.";
  }

  if (!isValidPort(settings.apiPort) || !isValidPort(settings.apiSslPort)) {
    return "Renseignez des ports API valides.";
  }

  if (!settings.hotspotAddress.trim()) {
    return "Renseignez l'adresse Hotspot affichée sur les tickets.";
  }

  if (/\s/.test(settings.hotspotAddress.trim())) {
    return "L'adresse Hotspot ne doit pas contenir d'espace.";
  }

  if (!settings.username.trim()) {
    return "Renseignez l'utilisateur MikroTik.";
  }

  return null;
}

export function canEditRouterSensitiveSettings(role: string | null | undefined): boolean {
  return role === "admin";
}

export function canViewRouterSettings(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

function isValidPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
