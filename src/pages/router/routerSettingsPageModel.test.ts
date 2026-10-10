import { describe, expect, it } from "vitest";
import type { HotspotAntiTetheringState } from "../../domain/router";
import {
  antiTetheringCoverageIssues,
  antiTetheringCoverageSummary,
  canEditRouterSensitiveSettings,
  canViewRouterSettings,
  defaultRouterSettings,
  mergeRouterManagementSecurityManifest,
  routerManagementSecurityAuditState,
  validateRouterSettings
} from "./routerSettingsPageModel";

describe("routerSettingsPageModel", () => {
  it("valide des paramètres routeur complets", () => {
    expect(validateRouterSettings({
      ...defaultRouterSettings,
      hotspotAddress: "wifi.ticketpro.local",
      name: "TicketPro Lab"
    })).toBeNull();
  });

  it("refuse des ports invalides", () => {
    expect(validateRouterSettings({
      ...defaultRouterSettings,
      apiPort: "abc",
      hotspotAddress: "wifi.ticketpro.local",
      name: "TicketPro Lab"
    })).toBe("Renseignez des ports API valides.");
  });

  it("sépare lecture et édition sensible", () => {
    expect(canViewRouterSettings("operator")).toBe(true);
    expect(canEditRouterSensitiveSettings("operator")).toBe(false);
    expect(canEditRouterSensitiveSettings("admin")).toBe(true);
  });

  it("dérive l'état de sécurité depuis les ressources réellement observées", () => {
    const manifest = {
      capturedAt: "2026-08-27T09:00:00.000Z",
      desired: {
        authorizedManagementCidrs: ["10.250.0.0/16", "192.168.88.0/24"],
        managementUsername: "ticketpro-api",
        managedHotspotProfileNames: [],
        wireguardInterfaceName: "ticketpro-vpn"
      },
      resources: [
        {
          attributes: {},
          key: "management-account:ticketpro-api",
          kind: "management_account" as const,
          matchCount: 1,
          ownership: "ticketpro" as const,
          state: "present" as const
        },
        {
          attributes: {},
          key: "management-service:api",
          kind: "management_service" as const,
          matchCount: 1,
          ownership: "shared" as const,
          state: "present" as const
        }
      ],
      routerOsVersion: "7.21.5",
      schemaVersion: 1 as const,
      warnings: []
    };

    expect(routerManagementSecurityAuditState(manifest)).toBe("secured");
    expect(routerManagementSecurityAuditState({
      ...manifest,
      resources: [{ ...manifest.resources[0], state: "missing" as const }]
    })).toBe("drift");
    expect(routerManagementSecurityAuditState(null)).toBe("unknown");
  });

  it("fusionne l'audit de sécurité sans perdre les ressources RouterOS déjà inventoriées", () => {
    const existing = {
      capturedAt: "2026-08-27T09:00:00.000Z",
      desired: {
        authorizedManagementCidrs: [],
        managementUsername: null,
        managedHotspotProfileNames: ["6h"],
        wireguardInterfaceName: "ticketpro-vpn"
      },
      resources: [{
        attributes: {},
        key: "wireguard-interface:ticketpro-vpn",
        kind: "wireguard_interface" as const,
        matchCount: 1,
        ownership: "ticketpro" as const,
        state: "present" as const
      }],
      routerOsVersion: "7.21.5",
      schemaVersion: 1 as const,
      warnings: ["diagnostic existant"]
    };
    const securityObservation = {
      ...existing,
      capturedAt: "2026-08-27T10:00:00.000Z",
      desired: {
        authorizedManagementCidrs: ["10.250.0.0/16"],
        managementUsername: "ticketpro-api",
        managedHotspotProfileNames: [],
        wireguardInterfaceName: null
      },
      resources: [{
        attributes: {},
        key: "management-account:ticketpro-api",
        kind: "management_account" as const,
        matchCount: 1,
        ownership: "ticketpro" as const,
        state: "present" as const
      }],
      warnings: ["avertissement partiel à ignorer"]
    };

    const merged = mergeRouterManagementSecurityManifest(existing, securityObservation);

    expect(merged.desired).toEqual({
      authorizedManagementCidrs: ["10.250.0.0/16"],
      managementUsername: "ticketpro-api",
      managedHotspotProfileNames: ["6h"],
      wireguardInterfaceName: "ticketpro-vpn"
    });
    expect(merged.resources.map((resource) => resource.kind)).toEqual([
      "wireguard_interface",
      "management_account"
    ]);
    expect(merged.warnings).toEqual(["diagnostic existant"]);
  });
});


describe("antiTetheringCoverageIssues", () => {
  const strict = { antiSharingMode: "strict", monitorIpv4Ttl: true, monitorIpv6HopLimit: true };
  const state = (coverage: Partial<NonNullable<HotspotAntiTetheringState["coverage"]>>): HotspotAntiTetheringState => ({
    blockIpv4Ttl: true, blockIpv6: true, managedRuleCount: 2,
    coverage: { hotspotInterfaces: ["bridge-wifi", "vlan20"], ipv4ProtectedInterfaces: [], ipv6ProtectedInterfaces: [], legacyPassthroughRules: 0, ...coverage }
  });

  it("ne signale rien quand chaque réseau hotspot est protégé", () => {
    const full = state({ ipv4ProtectedInterfaces: ["bridge-wifi", "vlan20"], ipv6ProtectedInterfaces: ["bridge-wifi", "vlan20"] });
    expect(antiTetheringCoverageIssues(strict, full)).toEqual([]);
    expect(antiTetheringCoverageSummary(full)).toBe("2/2 réseau(x) hotspot protégé(s) par le routeur");
  });

  it("nomme les réseaux non protégés et la règle d'ancienne version", () => {
    const partial = state({ ipv4ProtectedInterfaces: ["bridge-wifi"], ipv6ProtectedInterfaces: ["bridge-wifi"], legacyPassthroughRules: 1 });
    expect(antiTetheringCoverageIssues(strict, partial)).toEqual([
      "Blocage TTL absent ou désactivé sur vlan20 (1/2 réseaux hotspot protégés).",
      "Règle TTL d'une ancienne version (passthrough=no) : elle court-circuite vos autres règles mangle postrouting.",
      "Blocage IPv6 absent ou désactivé sur vlan20."
    ]);
  });

  it("n'exige rien hors du mode strict", () => {
    expect(antiTetheringCoverageIssues({ ...strict, antiSharingMode: "observe" }, state({}))).toEqual([]);
  });
});
