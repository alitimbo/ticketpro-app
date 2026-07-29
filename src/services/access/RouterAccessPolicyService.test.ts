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
      monitorIpv4Ttl: true,
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
});
