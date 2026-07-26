import { isProductionRuntime } from "../../config/runtime";
import type { LicenseStateRecord } from "../../domain/database";
import type { DatabaseClient } from "../database";
import { LicenseStateRepository } from "../database";
import { isTauriRuntime } from "../../config/runtime";
import { isLicenseApiConfigured, unprotectLicenseToken, validateLicense, type LicenseApiState } from "./LicenseClient";

export async function validateStoredLicense(
  database: DatabaseClient,
  accountId: string,
  routerIds: string[]
): Promise<LicenseApiState | null> {
  if (!isTauriRuntime()) return null;
  const repository = new LicenseStateRepository(database);
  const stored = await repository.findCurrent();
  if (!stored) {
    if (isProductionRuntime) throw new Error("Aucune licence TicketPro active sur cet appareil.");
    return null;
  }
  if (!isLicenseApiConfigured()) {
    if (isProductionRuntime) throw new Error("L'API de licences n'est pas configurée.");
    return null;
  }

  const activationToken = await unprotectLicenseToken(stored.activation_token_encrypted);
  const remote = await validateLicense({
    accountId,
    activationToken,
    licenseId: stored.license_id,
    routerIds
  });
  await repository.updateValidation(remote.status, remote.router_count, remote.device_count);
  return remote;
}

export function localLicenseAllowsRouterCreation(state: LicenseStateRecord | null, routerCount: number): boolean {
  if (!state) return !isProductionRuntime;
  const expiresAt = state.expires_at ? Date.parse(state.expires_at) : 0;
  return state.status === "active" && expiresAt > Date.now() && routerCount < state.router_limit;
}

export function routerLicenseFingerprint(router: {
  id: string;
  serial_number?: string | null;
  serialNumber?: string | null;
}): string {
  const serial = String(router.serial_number ?? router.serialNumber ?? "").trim().toUpperCase();
  return serial && serial !== "NON DÉTECTÉ" && serial !== "NON DETECTE"
    ? `serial:${serial}`
    : `local:${router.id}`;
}
