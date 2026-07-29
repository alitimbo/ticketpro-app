import type { DatabaseClient } from "../database";
import { AppSettingsRepository } from "../database/repositories";

export type AntiSharingMode = "disabled" | "observe" | "strict";
export type InfrastructureDeviceMode = "bridge" | "router_nat" | "unknown";
export type InfrastructureDeviceType =
  | "access_point"
  | "antenna"
  | "other"
  | "repeater";

export type InfrastructureDevice = {
  id: string;
  internetBypass: boolean;
  ipAddress: string;
  macAddress: string;
  mode: InfrastructureDeviceMode;
  name: string;
  type: InfrastructureDeviceType;
};

export type RouterAccessPolicy = {
  antiSharingMode: AntiSharingMode;
  infrastructureDevices: InfrastructureDevice[];
  lockVoucherToFirstMac: boolean;
  monitorIpv4Ttl: boolean;
  monitorIpv6HopLimit: boolean;
};

export const defaultRouterAccessPolicy: RouterAccessPolicy = {
  antiSharingMode: "disabled",
  infrastructureDevices: [],
  lockVoucherToFirstMac: false,
  monitorIpv4Ttl: false,
  monitorIpv6HopLimit: false
};

export class RouterAccessPolicyService {
  private readonly settings: AppSettingsRepository;

  constructor(database: DatabaseClient) {
    this.settings = new AppSettingsRepository(database);
  }

  async get(accountId: string, routerId: string): Promise<RouterAccessPolicy> {
    const stored = await this.settings.get(policyKey(accountId, routerId));
    if (!stored) return structuredClone(defaultRouterAccessPolicy);

    try {
      return normalizePolicy(JSON.parse(stored) as Partial<RouterAccessPolicy>);
    } catch {
      return structuredClone(defaultRouterAccessPolicy);
    }
  }

  async save(
    accountId: string,
    routerId: string,
    policy: RouterAccessPolicy
  ): Promise<RouterAccessPolicy> {
    const normalized = normalizePolicy(policy);
    const validationError = validateRouterAccessPolicy(normalized);
    if (validationError) throw new Error(validationError);
    await this.settings.set(
      policyKey(accountId, routerId),
      JSON.stringify(normalized)
    );
    return normalized;
  }
}

export function validateRouterAccessPolicy(
  policy: RouterAccessPolicy
): string | null {
  if (
    policy.antiSharingMode === "strict" &&
    !policy.monitorIpv4Ttl &&
    !policy.monitorIpv6HopLimit
  ) {
    return "Sélectionnez au moins une protection réseau IPv4 ou IPv6 pour activer le mode strict.";
  }

  const seenMacs = new Set<string>();
  const seenIps = new Set<string>();

  for (const device of policy.infrastructureDevices) {
    if (!device.name.trim()) return "Chaque équipement doit avoir un nom.";
    if (!isMacAddress(device.macAddress)) {
      return `L’adresse MAC de ${device.name} est invalide.`;
    }
    if (!isIpv4Address(device.ipAddress)) {
      return `L’adresse IP de ${device.name} est invalide.`;
    }
    if (device.internetBypass && device.mode !== "bridge") {
      return `Le bypass de ${device.name} exige le mode bridge transparent.`;
    }

    const mac = normalizeMacAddress(device.macAddress);
    if (seenMacs.has(mac)) return `La MAC ${mac} est déclarée plusieurs fois.`;
    if (seenIps.has(device.ipAddress)) {
      return `L’IP ${device.ipAddress} est déclarée plusieurs fois.`;
    }
    seenMacs.add(mac);
    seenIps.add(device.ipAddress);
  }

  return null;
}

export function normalizeMacAddress(value: string): string {
  return value.trim().replace(/-/g, ":").toUpperCase();
}

export function isMacAddress(value: string): boolean {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizeMacAddress(value));
}

function normalizePolicy(
  value: Partial<RouterAccessPolicy>
): RouterAccessPolicy {
  const antiSharingMode = ["disabled", "observe", "strict"].includes(
    value.antiSharingMode ?? ""
  )
    ? value.antiSharingMode as AntiSharingMode
    : defaultRouterAccessPolicy.antiSharingMode;

  return {
    antiSharingMode,
    infrastructureDevices: Array.isArray(value.infrastructureDevices)
      ? value.infrastructureDevices.map((device) => ({
          id: String(device.id || createId()),
          internetBypass: device.internetBypass === true,
          ipAddress: String(device.ipAddress || "").trim(),
          macAddress: normalizeMacAddress(String(device.macAddress || "")),
          mode: normalizeDeviceMode(device.mode),
          name: String(device.name || "").trim(),
          type: normalizeDeviceType(device.type)
        }))
      : [],
    lockVoucherToFirstMac: value.lockVoucherToFirstMac === true,
    monitorIpv4Ttl:
      antiSharingMode === "strict" && value.monitorIpv4Ttl === true,
    monitorIpv6HopLimit:
      antiSharingMode === "strict" && value.monitorIpv6HopLimit === true
  };
}

function normalizeDeviceMode(value: unknown): InfrastructureDeviceMode {
  return value === "bridge" || value === "router_nat" ? value : "unknown";
}

function normalizeDeviceType(value: unknown): InfrastructureDeviceType {
  return value === "access_point" ||
    value === "antenna" ||
    value === "repeater"
    ? value
    : "other";
}

function isIpv4Address(value: string): boolean {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => {
    const number = Number(part);
    return /^\d{1,3}$/.test(part) && number >= 0 && number <= 255;
  });
}

function policyKey(accountId: string, routerId: string): string {
  return `router.access_policy.${accountId}.${routerId}`;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
