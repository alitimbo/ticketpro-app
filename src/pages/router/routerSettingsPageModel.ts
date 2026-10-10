import type { HotspotAntiTetheringState, RouterConnectionMode, RouterManagedResourceManifest } from "../../domain/router";
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

export type RouterManagementSecurityAuditState = "drift" | "secured" | "unknown";

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

export function routerManagementSecurityAuditState(
  manifest: RouterManagedResourceManifest | null
): RouterManagementSecurityAuditState {
  if (!manifest) return "unknown";
  const resources = manifest.resources.filter((resource) =>
    resource.kind === "management_account" || resource.kind === "management_service"
  );
  if (resources.length === 0) return "unknown";
  return resources.every((resource) => resource.state === "present") ? "secured" : "drift";
}

export function mergeRouterManagementSecurityManifest(
  existing: RouterManagedResourceManifest | null,
  securityObservation: RouterManagedResourceManifest
): RouterManagedResourceManifest {
  const isManagementResource = (
    resource: RouterManagedResourceManifest["resources"][number]
  ) => resource.kind === "management_account" || resource.kind === "management_service";

  return {
    ...securityObservation,
    desired: {
      ...(existing?.desired ?? securityObservation.desired),
      authorizedManagementCidrs: securityObservation.desired.authorizedManagementCidrs,
      managementUsername: securityObservation.desired.managementUsername
    },
    resources: [
      ...(existing?.resources.filter((resource) => !isManagementResource(resource)) ?? []),
      ...securityObservation.resources.filter(isManagementResource)
    ],
    warnings: existing?.warnings ?? []
  };
}

function isValidPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Differences between the anti-sharing policy and what RouterOS really
 * applies, interface by interface. An empty list means the router enforces the
 * policy on every enabled Hotspot interface.
 */
export function antiTetheringCoverageIssues(
  policy: { antiSharingMode: string; monitorIpv4Ttl: boolean; monitorIpv6HopLimit: boolean },
  state: HotspotAntiTetheringState
): string[] {
  const coverage = state.coverage;
  if (!coverage || policy.antiSharingMode !== "strict") return [];
  const issues: string[] = [];
  const missing = (protectedInterfaces: string[]) =>
    coverage.hotspotInterfaces.filter((name) => !protectedInterfaces.includes(name));
  if (policy.monitorIpv4Ttl) {
    const unprotected = missing(coverage.ipv4ProtectedInterfaces);
    if (unprotected.length > 0) {
      issues.push(`Blocage TTL absent ou désactivé sur ${unprotected.join(", ")} (${coverage.hotspotInterfaces.length - unprotected.length}/${coverage.hotspotInterfaces.length} réseaux hotspot protégés).`);
    }
    if (coverage.legacyPassthroughRules > 0) {
      issues.push("Règle TTL d'une ancienne version (passthrough=no) : elle court-circuite vos autres règles mangle postrouting.");
    }
  }
  if (policy.monitorIpv6HopLimit) {
    const unprotected = missing(coverage.ipv6ProtectedInterfaces);
    if (unprotected.length > 0) {
      issues.push(`Blocage IPv6 absent ou désactivé sur ${unprotected.join(", ")}.`);
    }
  }
  return issues;
}

export function antiTetheringCoverageSummary(state: HotspotAntiTetheringState): string | null {
  const coverage = state.coverage;
  if (!coverage || coverage.hotspotInterfaces.length === 0) return null;
  const covered = coverage.hotspotInterfaces.filter((name) => coverage.ipv4ProtectedInterfaces.includes(name)).length;
  return `${covered}/${coverage.hotspotInterfaces.length} réseau(x) hotspot protégé(s) par le routeur`;
}
