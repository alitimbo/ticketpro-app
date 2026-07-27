import type { RouterConnectionMode, RouterErrorCode, RouterSystemInfo } from "../../domain/router";
import type {
  CreateRouterConnectionInput,
  CreateRouterInput,
  RouterConnectionRecord,
  RouterRecord
} from "../../domain/database";
import type { DiscoveredRouterCandidate } from "../../services/router";

export type RouterCardStatus = "active" | "offline" | "warning";

export type RouterConnectionPreference = RouterConnectionMode;

export type RouterConnectionTestStatus =
  | "api_disabled"
  | "authentication_failed"
  | "connected"
  | "hotspot_not_found"
  | "not_tested"
  | "offline"
  | "permission_denied"
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
  remotePort: "8728",
  remoteUseSsl: false,
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
    remotePort: 8728,
    remoteUseSsl: false,
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
    remotePort: 8728,
    remoteUseSsl: false,
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
    remotePort: 8728,
    remoteUseSsl: false,
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

export function routerCardFromRecord(
  record: RouterRecord,
  connections: RouterConnectionRecord[] = []
): RouterCardData {
  const localConnection = connections.find((connection) => connection.mode === "local");
  const remoteConnection =
    connections.find((connection) => connection.mode === record.connection_mode && connection.mode !== "local") ??
    connections.find((connection) => connection.mode !== "local");
  const lastConnection = remoteConnection ?? localConnection;
  const status = routerRecordStatusToCardStatus(record.status);

  return {
    accountId: record.account_id,
    apiPort: record.api_port,
    apiSslPort: record.api_ssl_port,
    boardName: record.board_name ?? "Non détecté",
    createdByProfileId: record.created_by_profile_id,
    encryptedPassword: record.encrypted_password,
    id: record.id,
    ipAddress: localConnection?.host || record.local_ip,
    lastSeenAt: record.last_seen_at ?? "Jamais",
    lastTestMessage: lastConnection?.last_error ?? routerStatusMessage(status),
    lastTestStatus: routerStatusToTestStatus(record.status),
    lastTestedAt: lastConnection?.last_connected_at ?? null,
    model: record.model ?? "Modèle non renseigné",
    notes: record.notes ?? "",
    preferredMode: record.connection_mode,
    remoteEnabled: Boolean(remoteConnection),
    remoteHost: remoteConnection?.host ?? "",
    remotePort: remoteConnection?.port ?? record.api_port,
    remoteUseSsl: remoteConnection ? remoteConnection.use_ssl === 1 : false,
    routerOsVersion: record.routeros_version ?? "Non détectée",
    serialNumber: record.serial_number ?? "Non détecté",
    status,
    subscriptionCounted: record.subscription_counted === 1,
    username: record.username,
    zoneName: record.name
  };
}

export function routerRecordFromCard(router: RouterCardData): CreateRouterInput {
  return {
    account_id: router.accountId,
    api_port: router.apiPort,
    api_ssl_port: router.apiSslPort,
    board_name: router.boardName,
    connection_mode: router.preferredMode,
    created_by_profile_id: router.createdByProfileId ?? "",
    encrypted_password: router.encryptedPassword,
    id: router.id,
    label: router.zoneName,
    last_seen_at: router.lastTestStatus === "connected" ? new Date().toISOString() : null,
    local_ip: router.ipAddress,
    model: router.model,
    name: router.zoneName,
    notes: router.notes,
    routeros_version: router.routerOsVersion,
    serial_number: router.serialNumber,
    status: routerCardStatusToRecordStatus(router.status),
    subscription_counted: router.subscriptionCounted === false ? 0 : 1,
    username: router.username,
    zone_id: null
  };
}

export function routerConnectionInputsFromCard(router: RouterCardData): CreateRouterConnectionInput[] {
  const connections: CreateRouterConnectionInput[] = [
    {
      host: router.ipAddress,
      id: `${router.id}:local`,
      last_connected_at: router.lastTestStatus === "connected" ? router.lastTestedAt ?? new Date().toISOString() : null,
      last_error: router.lastTestStatus === "connected" ? null : router.lastTestMessage,
      mode: "local",
      port: router.apiPort,
      router_id: router.id,
      status: router.preferredMode === "local" && router.status === "active" ? "active" : "inactive",
      use_ssl: 0
    }
  ];

  if (router.remoteHost.trim()) {
    const isVpn = router.preferredMode === "vpn";
    connections.push({
      host: router.remoteHost.trim(),
      id: `${router.id}:remote`,
      last_connected_at: router.preferredMode !== "local" ? router.lastTestedAt : null,
      last_error: router.preferredMode !== "local" ? router.lastTestMessage : null,
      mode: router.preferredMode === "local" ? "distant_ip" : router.preferredMode,
      port: isVpn ? 8728 : router.remotePort,
      router_id: router.id,
      status: router.preferredMode !== "local" && router.status === "active" ? "active" : "inactive",
      use_ssl: isVpn ? 0 : router.remoteUseSsl ? 1 : 0
    });
  }

  return connections;
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
    remoteEnabled: isRemoteConnectionMode(values.preferredMode) && values.remoteHost.trim().length > 0,
    routerOsVersion: systemInfo?.routerOsVersion ?? "Non détectée",
    serialNumber: systemInfo?.serialNumber ?? "Non détecté",
    status: "warning",
    subscriptionCounted: true,
    username: values.username,
    zoneName: values.name
  };
}

function routerRecordStatusToCardStatus(status: RouterRecord["status"]): RouterCardStatus {
  return status === "active" ? "active" : status === "offline" ? "offline" : "warning";
}

function routerCardStatusToRecordStatus(status: RouterCardStatus): RouterRecord["status"] {
  return status === "active" ? "active" : status === "offline" ? "offline" : "warning";
}

function routerStatusToTestStatus(status: RouterRecord["status"]): RouterConnectionTestStatus {
  return status === "active" ? "connected" : status === "offline" ? "offline" : "not_tested";
}

function routerStatusMessage(status: RouterCardStatus): string {
  return status === "active" ? "Routeur connecté" : status === "offline" ? "Routeur hors ligne" : "À vérifier";
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
    hotspot_not_found: "hotspot_not_found",
    permission_denied: "permission_denied",
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
    api_disabled: "API RouterOS désactivée ou port 8728 inaccessible",
    authentication_failed: "Identifiants MikroTik incorrects",
    connected: "Routeur connecté",
    hotspot_not_found: "Service Hotspot ou profil requis introuvable",
    not_tested: "Non testé",
    offline: "Routeur hors ligne ou adresse IP inaccessible",
    permission_denied: "Le compte MikroTik n'a pas les permissions requises",
    remote_not_configured: "Connexion distante non configurée",
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
