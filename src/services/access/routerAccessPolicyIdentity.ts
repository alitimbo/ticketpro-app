import type {
  RouterConnectionRecord,
  RouterRecord
} from "../../domain/database";

const unavailableSerials = new Set([
  "",
  "0",
  "INCONNU",
  "N/A",
  "NON DISPONIBLE",
  "NONE",
  "UNKNOWN"
]);

export function routerAccessPolicyCloudId(
  router: RouterRecord,
  connections: RouterConnectionRecord[]
): string {
  const serial = String(router.serial_number ?? "").trim().toUpperCase();
  if (!unavailableSerials.has(serial)) {
    return `serial:${serial}`.slice(0, 200);
  }

  const vpnHost = connections.find(
    (connection) =>
      !connection.deleted_at &&
      connection.mode === "vpn" &&
      connection.host.trim()
  )?.host.trim().toLowerCase();
  if (vpnHost) return `vpn:${vpnHost}`.slice(0, 200);

  const hotspotAddress = String(router.hotspot_address ?? "").trim().toLowerCase();
  if (hotspotAddress) return `hotspot:${hotspotAddress}`.slice(0, 200);

  return `local:${router.id}`.slice(0, 200);
}
