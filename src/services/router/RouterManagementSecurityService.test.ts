import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizedManagementCidrs,
  generateRouterManagementPassword,
  RouterManagementSecurityService
} from "./RouterManagementSecurityService";

describe("RouterManagementSecurityService", () => {
  it("prépare et vérifie le compte dédié sans restreindre les services", async () => {
    const currentTest = vi.fn().mockResolvedValue({ mode: "local" });
    const upsert = vi.fn().mockResolvedValue({
      action: "created",
      groupName: "ticketpro-api",
      username: "ticketpro-api"
    });
    const applyPolicy = vi.fn();
    const candidateTest = vi.fn().mockResolvedValue({ mode: "vpn" });
    const commitCredentials = vi.fn();
    const createCandidateClient = vi.fn().mockResolvedValue({
      inspectManagedResources: vi.fn(),
      testConnection: candidateTest
    });
    const service = new RouterManagementSecurityService({
      commitCredentials,
      createCandidateClient,
      currentClient: {
        applyManagementServicePolicy: applyPolicy,
        testConnection: currentTest,
        upsertManagementAccount: upsert
      }
    });

    const result = await service.prepare({
      localRouterIp: "192.168.88.1",
      password: "safe-password-for-test",
      username: "ticketpro-api"
    });

    expect(result).toEqual({
      accountAction: "created",
      authorizedCidrs: ["10.250.0.0/16", "192.168.88.0/24"],
      connectionMode: "vpn",
      groupName: "ticketpro-api",
      username: "ticketpro-api"
    });
    expect(currentTest).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith({
      adoptExisting: undefined,
      password: "safe-password-for-test",
      username: "ticketpro-api"
    });
    expect(candidateTest).toHaveBeenCalledOnce();
    expect(applyPolicy).not.toHaveBeenCalled();
    expect(commitCredentials).not.toHaveBeenCalled();
  });

  it("refuse le durcissement tant que la préparation n'est pas terminée", async () => {
    const applyPolicy = vi.fn();
    const service = new RouterManagementSecurityService({
      commitCredentials: vi.fn(),
      createCandidateClient: vi.fn(),
      currentClient: {
        applyManagementServicePolicy: applyPolicy,
        testConnection: vi.fn(),
        upsertManagementAccount: vi.fn()
      }
    });

    await expect(service.apply()).rejects.toThrow("Préparez et testez d'abord");
    expect(applyPolicy).not.toHaveBeenCalled();
  });

  it("restreint, reteste puis persiste les nouveaux identifiants", async () => {
    const candidateTest = vi.fn().mockResolvedValue({ mode: "local" });
    const applyPolicy = vi.fn().mockResolvedValue({
      disabledServices: ["ftp", "telnet", "www", "www-ssl", "api-ssl"],
      restrictedServices: ["api", "ssh", "winbox"]
    });
    const commitCredentials = vi.fn().mockResolvedValue(undefined);
    const service = new RouterManagementSecurityService({
      commitCredentials,
      createCandidateClient: vi.fn().mockResolvedValue({
        inspectManagedResources: vi.fn().mockResolvedValue(managementManifest()),
        testConnection: candidateTest
      }),
      currentClient: {
        applyManagementServicePolicy: applyPolicy,
        testConnection: vi.fn().mockResolvedValue({ mode: "local" }),
        upsertManagementAccount: vi.fn().mockResolvedValue({
          action: "updated",
          groupName: "ticketpro-api",
          username: "ticketpro-api"
        })
      }
    });

    await service.prepare({
      localRouterIp: "192.168.88.1",
      password: "safe-password-for-test"
    });
    const result = await service.apply();

    expect(applyPolicy).toHaveBeenCalledWith({
      authorizedCidrs: ["10.250.0.0/16", "192.168.88.0/24"],
      currentPathConfirmed: true,
      disableUnusedServices: true
    });
    expect(candidateTest).toHaveBeenCalledTimes(2);
    expect(commitCredentials).toHaveBeenCalledWith({
      password: "safe-password-for-test",
      username: "ticketpro-api"
    });
    expect(result.policy.restrictedServices).toEqual(["api", "ssh", "winbox"]);
  });

  it("ne persiste pas les identifiants si le contrôle après restriction échoue", async () => {
    const candidateTest = vi.fn()
      .mockResolvedValueOnce({ mode: "vpn" })
      .mockRejectedValueOnce(new Error("API inaccessible"));
    const commitCredentials = vi.fn();
    const service = new RouterManagementSecurityService({
      commitCredentials,
      createCandidateClient: vi.fn().mockResolvedValue({
        inspectManagedResources: vi.fn(),
        testConnection: candidateTest
      }),
      currentClient: {
        applyManagementServicePolicy: vi.fn().mockResolvedValue({
          disabledServices: [],
          restrictedServices: ["api", "winbox"]
        }),
        testConnection: vi.fn().mockResolvedValue({ mode: "vpn" }),
        upsertManagementAccount: vi.fn().mockResolvedValue({
          action: "created",
          groupName: "ticketpro-api",
          username: "ticketpro-api"
        })
      }
    });

    await service.prepare({ localRouterIp: "192.168.88.1", password: "safe-password-for-test" });
    await expect(service.apply()).rejects.toThrow("API inaccessible");
    expect(commitCredentials).not.toHaveBeenCalled();
  });

  it("refuse une validation faite seulement par adresse distante publique", async () => {
    const applyPolicy = vi.fn();
    const service = new RouterManagementSecurityService({
      commitCredentials: vi.fn(),
      createCandidateClient: vi.fn().mockResolvedValue({
        inspectManagedResources: vi.fn(),
        testConnection: vi.fn().mockResolvedValue({ mode: "distant_ip" })
      }),
      currentClient: {
        applyManagementServicePolicy: applyPolicy,
        testConnection: vi.fn().mockResolvedValue({ mode: "distant_ip" }),
        upsertManagementAccount: vi.fn().mockResolvedValue({
          action: "created",
          groupName: "ticketpro-api",
          username: "ticketpro-api"
        })
      }
    });

    await expect(service.prepare({
      localRouterIp: "192.168.88.1",
      password: "safe-password-for-test"
    })).rejects.toThrow("en local ou via le VPN");
    expect(applyPolicy).not.toHaveBeenCalled();
  });

  it("revérifie idempotemment le compte déjà utilisé sans changer son mot de passe", async () => {
    const upsert = vi.fn();
    const commitCredentials = vi.fn();
    const inspectManagedResources = vi.fn().mockResolvedValue({
      ...managementManifest(),
      resources: [
        {
          attributes: {},
          key: "management-account-group:ticketpro-api",
          kind: "management_account",
          matchCount: 1,
          ownership: "ticketpro",
          state: "present"
        },
        {
          attributes: {},
          key: "management-account:ticketpro-api",
          kind: "management_account",
          matchCount: 1,
          ownership: "ticketpro",
          state: "present"
        }
      ]
    });
    const service = new RouterManagementSecurityService({
      commitCredentials,
      createCandidateClient: vi.fn(),
      currentClient: {
        applyManagementServicePolicy: vi.fn().mockResolvedValue({
          disabledServices: [],
          restrictedServices: ["api", "ssh", "winbox"]
        }),
        inspectManagedResources,
        testConnection: vi.fn().mockResolvedValue({ mode: "vpn" }),
        upsertManagementAccount: upsert
      }
    });

    const prepared = await service.prepareExisting({
      localRouterIp: "192.168.88.1",
      username: "ticketpro-api"
    });
    await service.apply();

    expect(prepared.connectionMode).toBe("vpn");
    expect(upsert).not.toHaveBeenCalled();
    expect(commitCredentials).not.toHaveBeenCalled();
    expect(inspectManagedResources).toHaveBeenCalledTimes(2);
  });
});

function managementManifest() {
  return {
    capturedAt: "2026-08-27T09:00:00.000Z",
    desired: {
      authorizedManagementCidrs: ["10.250.0.0/16", "192.168.88.0/24"],
      managementUsername: "ticketpro-api",
      managedHotspotProfileNames: [],
      wireguardInterfaceName: null
    },
    resources: [],
    routerOsVersion: "7.21.5",
    schemaVersion: 1 as const,
    warnings: []
  };
}

describe("RouterOS management security helpers", () => {
  it("dérive le LAN /24 et conserve le VPN multi-organisation", () => {
    expect(buildAuthorizedManagementCidrs("192.168.10.254")).toEqual([
      "10.250.0.0/16",
      "192.168.10.0/24"
    ]);
    expect(buildAuthorizedManagementCidrs("invalide")).toEqual(["10.250.0.0/16"]);
  });

  it("génère un secret fort sans valeur fixe", () => {
    const first = generateRouterManagementPassword();
    const second = generateRouterManagementPassword();
    expect(first).toMatch(/^tp-[a-f0-9]{48}$/);
    expect(second).not.toBe(first);
  });
});
