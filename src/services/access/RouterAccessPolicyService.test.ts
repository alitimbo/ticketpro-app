import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import {
  RouterAccessPolicyService,
  validateRouterAccessPolicy,
  type RouterAccessPolicy
} from "./RouterAccessPolicyService";

describe("RouterAccessPolicyService", () => {
  it("persiste une politique séparée par organisation et routeur", async () => {
    const database = new InMemoryDatabaseClient();
    await database.initialize();
    const service = new RouterAccessPolicyService(database);
    const policy: RouterAccessPolicy = {
      blockedDevices: [],
      antiSharingMode: "observe",
      infrastructureDevices: [{
        id: "antenna-1",
        internetBypass: true,
        ipAddress: "192.168.88.10",
        macAddress: "aa-bb-cc-dd-ee-ff",
        mode: "bridge",
        name: "Antenne nord",
        type: "antenna"
      }],
      lockVoucherToFirstMac: true,
      monitorIpv4Ttl: false,
      monitorIpv6HopLimit: false
    };

    await service.save("account-1", "router-1", policy);

    await expect(service.get("account-1", "router-1")).resolves.toEqual({
      ...policy,
      infrastructureDevices: [{
        ...policy.infrastructureDevices[0],
        macAddress: "AA:BB:CC:DD:EE:FF"
      }]
    });
    await expect(service.get("account-1", "router-2")).resolves.toMatchObject({
      infrastructureDevices: [],
      lockVoucherToFirstMac: false
    });
  });

  it("refuse le bypass d'un équipement qui masque ses clients avec du NAT", () => {
    const error = validateRouterAccessPolicy({
      blockedDevices: [],
      antiSharingMode: "observe",
      infrastructureDevices: [{
        id: "antenna-1",
        internetBypass: true,
        ipAddress: "192.168.88.10",
        macAddress: "AA:BB:CC:DD:EE:FF",
        mode: "router_nat",
        name: "Antenne NAT",
        type: "antenna"
      }],
      lockVoucherToFirstMac: true,
      monitorIpv4Ttl: true,
      monitorIpv6HopLimit: true
    });

    expect(error).toContain("bridge transparent");
  });

  it("refuse les adresses MAC et IP dupliquées", () => {
    const baseDevice = {
      internetBypass: true,
      ipAddress: "192.168.88.10",
      macAddress: "AA:BB:CC:DD:EE:FF",
      mode: "bridge" as const,
      name: "Antenne",
      type: "antenna" as const
    };
    const error = validateRouterAccessPolicy({
      antiSharingMode: "observe",
      blockedDevices: [],
      infrastructureDevices: [
        { ...baseDevice, id: "antenna-1" },
        { ...baseDevice, id: "antenna-2", name: "Antenne bis" }
      ],
      lockVoucherToFirstMac: true,
      monitorIpv4Ttl: true,
      monitorIpv6HopLimit: true
    });

    expect(error).toContain("déclarée plusieurs fois");
  });

  it("refuse une adresse MAC incomplète ou contenant un caractère non hexadécimal", () => {
    const error = validateRouterAccessPolicy({
      antiSharingMode: "observe",
      blockedDevices: [],
      infrastructureDevices: [{
        id: "antenna-invalid",
        internetBypass: true,
        ipAddress: "192.168.4.6",
        macAddress: "CC:DD:EE:FF:GG",
        mode: "bridge",
        name: "Antenne GrandStream 2",
        type: "antenna"
      }],
      lockVoucherToFirstMac: false,
      monitorIpv4Ttl: false,
      monitorIpv6HopLimit: false
    });

    expect(error).toContain("adresse MAC");
    expect(error).toContain("invalide");
  });

  it("autorise le blocage TTL sans verrouiller le voucher sur une MAC", () => {
    expect(validateRouterAccessPolicy({
      antiSharingMode: "strict",
      blockedDevices: [],
      infrastructureDevices: [],
      lockVoucherToFirstMac: false,
      monitorIpv4Ttl: true,
      monitorIpv6HopLimit: false
    })).toBeNull();
  });

  it("exige au moins une protection réseau en mode strict", () => {
    const error = validateRouterAccessPolicy({
      antiSharingMode: "strict",
      blockedDevices: [],
      infrastructureDevices: [],
      lockVoucherToFirstMac: true,
      monitorIpv4Ttl: false,
      monitorIpv6HopLimit: false
    });

    expect(error).toContain("au moins une protection réseau");
  });

  it("valide un blocage par IP ou MAC et refuse un appareil sans adresse", () => {
    expect(validateRouterAccessPolicy({
      ...structuredClone(defaultPolicy()),
      blockedDevices: [{
        id: "blocked-ip",
        ipAddress: "192.168.88.120",
        macAddress: "",
        name: "Téléphone"
      }]
    })).toBeNull();

    expect(validateRouterAccessPolicy({
      ...structuredClone(defaultPolicy()),
      blockedDevices: [{
        id: "blocked-empty",
        ipAddress: "",
        macAddress: "",
        name: "Inconnu"
      }]
    })).toContain("IP ou MAC");
  });

  it("refuse de bloquer une adresse déjà utilisée par un bypass", () => {
    const policy = defaultPolicy();
    policy.infrastructureDevices = [{
      id: "antenna-1",
      internetBypass: true,
      ipAddress: "192.168.88.10",
      macAddress: "AA:BB:CC:DD:EE:FF",
      mode: "bridge",
      name: "Antenne nord",
      type: "antenna"
    }];
    policy.blockedDevices = [{
      id: "blocked-1",
      ipAddress: "192.168.88.10",
      macAddress: "",
      name: "Doublon"
    }];

    expect(validateRouterAccessPolicy(policy)).toContain("déjà présente");
  });
});

function defaultPolicy(): RouterAccessPolicy {
  return {
    antiSharingMode: "disabled",
    blockedDevices: [],
    infrastructureDevices: [],
    lockVoucherToFirstMac: false,
    monitorIpv4Ttl: false,
    monitorIpv6HopLimit: false
  };
}
