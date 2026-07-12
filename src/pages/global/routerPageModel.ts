import type { RouterConnectionMode, RouterErrorCode, RouterSystemInfo } from "../../domain/router";
import type { DiscoveredRouterCandidate } from "../../services/router";

export type RouterCardStatus = "active" | "offline" | "warning";

export type RouterConnectionPreference = RouterConnectionMode;

export type RouterConnectionTestStatus =
  | "api_disabled"
  | "authentication_failed"
  | "connected"
  | "not_tested"
  | "offline"
  | "remote_not_configured"
  | "remote_unavailable"
  | "timeout";

export type RouterCardData = {
  accountId: string;
  createdByProfileId: string | null;
  id: string;
  zoneName: string;
  model: string;
  boardName: string;
  serialNumber: string;
  ipAddress: string;
  apiPort: number;
  apiSslPort: number;
  username: string;
  encryptedPassword: string;
  preferredMode: RouterConnectionPreference;
  remoteHost: string;
  remotePort: number;
  remoteUseSsl: boolean;
  remoteEnabled: boolean;
  notes: string;
  routerOsVersion: string;
  status: RouterCardStatus;
  subscriptionCounted?: boolean;
  lastSeenAt: string;
  lastTestStatus: RouterConnectionTestStatus;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
};

export type RouterFilter = "all" | RouterCardStatus;

export type RouterFormValues = {
  apiPort: string;
  apiSslPort: string;
  ipAddress: string;
  model: string;
  name: string;
  notes: string;
  password: string;
  preferredMode: RouterConnectionPreference;
  remoteHost: string;
  remotePort: string;
  remoteUseSsl: boolean;
  username: string;
};

export type RouterOwnershipInput = {
  accountId: string;
  createdByProfileId: string;
};

export const emptyRouterFormValues: RouterFormValues = {
  apiPort: "8728",
  apiSslPort: "8729",
  ipAddress: "",
  model: "",
  name: "",
  notes: "",
  password: "",
  preferredMode: "local",
  remoteHost: "",
  remotePort: "8729",
  remoteUseSsl: true,
  username: "admin"
};

export const demoRouters: RouterCardData[] = [
  {
    accountId: "account-douma-demo",
    apiPort: 8728,
    apiSslPort: 8729,
    boardName: "C52iG-5HaxD2HaxD",
    createdByProfileId: "account-douma-demo:internal-profile-admin",
    encryptedPassword: "secret://routeur-demo/mikrotik-password",
    id: "routeur-demo",
    ipAddress: "192.168.88.1",
    lastSeenAt: "Aujourd'hui à 11:30",
    lastTestMessage: "Routeur connecté",
    lastTestStatus: "connected",
    lastTestedAt: "Aujourd'hui à 11:30",
    model: "hAP ax²",
    notes: "Routeur de démonstration local.",
    preferredMode: "local",
    remoteHost: "vpn-boutique-centre.local",
    remotePort: 8729,
    remoteUseSsl: true,
    remoteEnabled: true,
    routerOsVersion: "7.15.3",
    serialNumber: "HAX2-DEMO-2026",
    status: "active",
    subscriptionCounted: true,
    username: "admin",
    zoneName: "Boutique centre"
  },
  {
    accountId: "account-autre-demo",
    apiPort: 8728,
    apiSslPort: 8729,
    boardName: "RB750Gr3",
    createdByProfileId: "account-autre-demo:internal-profile-admin",
    encryptedPassword: "secret://point-nord/mikrotik-password",
    id: "point-nord",
    ipAddress: "192.168.10.1",
    lastSeenAt: "Hier à 18:12",
    lastTestMessage: "Routeur hors ligne",
    lastTestStatus: "offline",
    lastTestedAt: "Hier à 18:12",
    model: "hEX",
    notes: "À vérifier sur site.",
    preferredMode: "local",
    remoteHost: "",
    remotePort: 8729,
    remoteUseSsl: true,
    remoteEnabled: false,
    routerOsVersion: "7.14.2",
    serialNumber: "HEX-NORD-001",
    status: "offline",
    subscriptionCounted: false,
    username: "admin",
    zoneName: "Point de vente nord"
  },
  {
    accountId: "account-autre-demo",
    apiPort: 8728,
    apiSslPort: 8729,
    boardName: "RBD52G-5HacD2HnD",
    createdByProfileId: "account-autre-demo:internal-profile-operator",
    encryptedPassword: "secret://agence-centre/mikrotik-password",
    id: "agence-centre",
    ipAddress: "10.10.5.1",
    lastSeenAt: "Aujourd'hui à 08:45",
    lastTestMessage: "API désactivée",
    lastTestStatus: "api_disabled",
    lastTestedAt: "Aujourd'hui à 08:45",
    model: "hAP ac²",
    notes: "API à activer après validation admin.",
    preferredMode: "local",
    remoteHost: "10.50.5.1",
    remotePort: 8729,
    remoteUseSsl: true,
    remoteEnabled: false,
    routerOsVersion: "7.12.1",
    serialNumber: "HAP-AC2-4582",
    status: "warning",
    subscriptionCounted: false,
    username: "admin",
    zoneName: "Agence centre"
  }
];

export function filterRouters(
  routers: RouterCardData[],
  query: string,
  filter: RouterFilter
): RouterCardData[] {
  const normalizedQuery = query.trim().toLowerCase();

  return routers.filter((router) => {
    const matchesFilter = filter === "all" || router.status === filter;
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [router.zoneName, router.ipAddress, router.model, router.boardName, router.serialNumber]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesFilter && matchesQuery;
  });
}

export function listRoutersForAccount(routers: RouterCardData[], accountId: string | null | undefined): RouterCardData[] {
  if (!accountId) {
    return [];
  }

  return routers.filter((router) => router.accountId === accountId);
}

export function getRouterLimitMessage(canAddRouter: boolean): string | null {
  return canAddRouter ? null : "Limite de routeurs atteinte pour votre abonnement.";
}

export function createRouterFromForm(
  values: RouterFormValues,
  encryptedPassword: string,
  systemInfo: RouterSystemInfo | null,
  id: string | undefined,
  ownership: RouterOwnershipInput
): RouterCardData {
  return {
    accountId: ownership.accountId,
    apiPort: Number(values.apiPort),
    apiSslPort: Number(values.apiSslPort),
    boardName: systemInfo?.boardName ?? "Non détectée",
    createdByProfileId: ownership.createdByProfileId,
    encryptedPassword,
    id: id ?? `router-${crypto.randomUUID()}`,
    ipAddress: values.ipAddress,
    lastSeenAt: "Jamais",
    lastTestMessage: null,
    lastTestStatus: "not_tested",
    lastTestedAt: null,
    model: values.model || systemInfo?.model || "Modèle non renseigné",
    notes: values.notes,
    preferredMode: values.preferredMode,
    remoteHost: values.remoteHost,
    remotePort: Number(values.remotePort),
    remoteUseSsl: values.remoteUseSsl,
    remoteEnabled: false,
    routerOsVersion: systemInfo?.routerOsVersion ?? "Non détectée",
    serialNumber: systemInfo?.serialNumber ?? "Non détecté",
    status: "warning",
    subscriptionCounted: true,
    username: values.username,
    zoneName: values.name
  };
}

export function formValuesFromRouter(router: RouterCardData): RouterFormValues {
  return {
    apiPort: String(router.apiPort),
    apiSslPort: String(router.apiSslPort),
    ipAddress: router.ipAddress,
    model: router.model === "Modèle non renseigné" ? "" : router.model,
    name: router.zoneName,
    notes: router.notes,
    password: "",
    preferredMode: router.preferredMode,
    remoteHost: router.remoteHost,
    remotePort: String(router.remotePort),
    remoteUseSsl: router.remoteUseSsl,
    username: router.username
  };
}

export function formValuesFromScannedRouter(router: DiscoveredRouterCandidate): RouterFormValues {
  return {
    ...emptyRouterFormValues,
    apiPort: String(router.apiPort),
    apiSslPort: String(router.apiSslPort),
    ipAddress: router.host,
    model: router.systemInfo.model,
    name: router.systemInfo.identity || router.name,
    preferredMode: router.mode
  };
}

export function mapRouterErrorToTestStatus(code: RouterErrorCode): RouterConnectionTestStatus {
  const mapping: Record<RouterErrorCode, RouterConnectionTestStatus> = {
    api_disabled: "api_disabled",
    authentication_failed: "authentication_failed",
    duplicate_user: "timeout",
    hotspot_not_found: "timeout",
    permission_denied: "timeout",
    remote_not_configured: "remote_not_configured",
    remote_unavailable: "remote_unavailable",
    router_offline: "offline",
    timeout: "timeout",
    vpn_required: "remote_unavailable"
  };

  return mapping[code];
}

export function routerTestMessage(status: RouterConnectionTestStatus): string {
  const messages: Record<RouterConnectionTestStatus, string> = {
    api_disabled: "API désactivée",
    authentication_failed: "Mot de passe incorrect",
    connected: "Routeur connecté",
    not_tested: "Non testé",
    offline: "Routeur hors ligne",
    remote_not_configured: "Connexion distante non configuree",
    remote_unavailable: "Connexion distante non disponible",
    timeout: "Délai d'attente dépassé"
  };

  return messages[status];
}

export function connectionModeLabel(mode: RouterConnectionPreference): string {
  const labels: Record<RouterConnectionPreference, string> = {
    agent_future: "Agent distant",
    distant_ip: "Adresse distante",
    local: "Local",
    vpn: "VPN"
  };

  return labels[mode];
}

export function isRemoteConnectionMode(
  mode: RouterConnectionPreference
): mode is Exclude<RouterConnectionPreference, "local"> {
  return mode !== "local";
}
