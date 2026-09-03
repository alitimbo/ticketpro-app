import { describe, expect, it } from "vitest";
import type { RouterActionLog } from "./RouterService";
import { AuthorizationError, createSession } from "../auth";
import { FakeRouterAdapter } from "./FakeRouterAdapter";
import { RouterService, RouterServiceError, translateRouterError } from "./RouterService";

const operatorSession = createSession("operator", "doumacorporation@gmail.com", Date.now());
const adminSession = createSession("admin", "admin@example.com", Date.now());

describe("RouterService", () => {
  it("simule un routeur MikroTik complet sans routeur réel", async () => {
    const service = new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }) });

    await expect(service.testConnection()).resolves.toMatchObject({ ok: true, mode: "local" });
    await expect(service.getSystemInfo()).resolves.toMatchObject({
      model: "hAP ax²",
      routerOsVersion: "7.15.3"
    });
    await expect(service.getHotspotServers()).resolves.toHaveLength(1);
    await expect(service.getHotspotPlans()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Journée" })])
    );
    await expect(service.listActiveUsers()).resolves.toHaveLength(2);
    await expect(service.getRouterHealth()).resolves.toMatchObject({ activeClientsCount: 2, cpuLoad: 18 });
    await expect(service.getInterfaceTraffic()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ interfaceName: "bridge-hotspot" })])
    );
    await expect(service.getRouterDateTime()).resolves.toMatchObject({ timeZone: "Africa/Niamey" });
  });

  it("crée le nombre demandé de tickets avec des secrets référencés", async () => {
    const service = new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }) });

    const tickets = await service.createTickets("routeur-demo", {
      planId: "plan-jour",
      quantity: 20
    });

    expect(tickets).toHaveLength(20);
    expect(tickets[0].username).toMatch(/^\d{6}$/);
    expect(tickets[0].passwordSecretRef).toBe(`secret://routeur-demo/${tickets[0].username}/password`);
    expect(new Set(tickets.map((ticket) => ticket.username))).toHaveLength(20);
    expect(tickets[0]).not.toHaveProperty("password");
  });

  it("utilise un fournisseur de découverte injecté sans fabriquer de routeur par défaut", async () => {
    const service = new RouterService({
      adapter: new FakeRouterAdapter({ latencyMs: 0 }),
      discoveryProvider: {
        scan: async () => [
          {
            apiPort: 8728,
            apiSslPort: 8729,
            host: "192.168.88.1",
            id: "discovered-192-168-88-1",
            isReachable: true,
            mode: "local",
            name: "MikroTik détecté",
            systemInfo: {
              architecture: "arm64",
              boardName: "hAP ax²",
              identity: "MikroTik",
              model: "hAP ax²",
              routerOsVersion: "7.15.3",
              serialNumber: "TEST-SERIAL",
              uptime: "1d"
            }
          }
        ]
      }
    });

    await expect(service.scanLocalRouters()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "192.168.88.1",
          mode: "local",
          systemInfo: expect.objectContaining({ routerOsVersion: "7.15.3" })
        })
      ])
    );
  });

  it("traduit les erreurs techniques et écrit des logs sans secret", async () => {
    const logs: RouterActionLog[] = [];
    const service = new RouterService({
      adapter: new FakeRouterAdapter({ errorMode: "authentication_failed", latencyMs: 0 }),
      logger: {
        write: (log) => {
          logs.push(log);
        }
      }
    });

    await expect(service.testConnection()).rejects.toThrow(RouterServiceError);
    expect(logs[0]).toMatchObject({
      action: "testConnection",
      level: "error",
      technicalCode: "authentication_failed",
      userMessage: "Identifiants du routeur incorrects."
    });
    expect(JSON.stringify(logs)).not.toContain("password");
    expect(translateRouterError("timeout")).toBe("Le routeur ne répond pas. Réessayez dans un instant.");
    expect(translateRouterError("device_mode_restricted")).toContain(
      "/system device-mode update scheduler=yes hotspot=yes"
    );
    expect(translateRouterError("device_mode_flagged")).toContain("flagged");
  });

  it("journalise une seule action métier pour une création exacte en lot", async () => {
    const logs: RouterActionLog[] = [];
    const service = new RouterService({
      adapter: new FakeRouterAdapter({ latencyMs: 0 }),
      logger: { write: (log) => { logs.push(log); } }
    });

    await service.createHotspotUsersExactBatch([
      { passwordSecretRef: "secret://routeur-demo/910001/password", planId: "plan-jour", username: "910001" },
      { passwordSecretRef: "secret://routeur-demo/910002/password", planId: "plan-jour", username: "910002" }
    ]);

    expect(logs).toEqual([
      expect.objectContaining({ action: "createHotspotUsersExactBatch", level: "info" })
    ]);
  });

  it("simule les erreurs métier attendues", async () => {
    const service = new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }) });

    await expect(
      service.createHotspotUser({
        passwordSecretRef: "secret://duplicate/password",
        planId: "plan-jour",
        username: "J001"
      })
    ).rejects.toMatchObject({
      code: "duplicate_user",
      message: "Ce ticket existe déjà."
    });

    await expect(service.updateHotspotPlan("plan-inconnu", { name: "Inconnu" })).rejects.toMatchObject({
      code: "hotspot_not_found",
      message: "Le service de tickets est introuvable sur ce routeur."
    });
  });

  it("vérifie les permissions du profil interne sur les actions sensibles", async () => {
    const logs: RouterActionLog[] = [];
    const service = new RouterService({
      adapter: new FakeRouterAdapter({ latencyMs: 0 }),
      logger: {
        write: (log) => {
          logs.push(log);
        }
      },
      authSession: operatorSession
    });

    await expect(
      service.createHotspotPlan({
        dataLimitMb: null,
        downloadLimit: null,
        durationMinutes: 60,
        name: "Test",
        priceHint: null,
        profileName: "test",
        sharedUsers: 1,
        status: "active",
        uploadLimit: null,
        validityMinutes: 180
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      service.createHotspotUser({
        passwordSecretRef: "secret://routeur-demo/123456/password",
        planId: "plan-jour",
        username: "123456"
      })
    ).resolves.toMatchObject({ username: "123456" });
    expect(logs[logs.length - 1]).toMatchObject({
      action: "createHotspotUser",
      internalProfileId: "account-douma-demo:internal-profile-operator",
      internalProfileRole: "operator"
    });
  });

  it("déclasse uniquement les vouchers marqués TicketPro et vérifie leur disparition", async () => {
    const adapter = new FakeRouterAdapter({ latencyMs: 0 });
    await adapter.createHotspotUser({
      comment: "TicketPro:v1;batch=batch-decommission;state=new;",
      passwordSecretRef: "secret://managed/password",
      planId: "plan-jour",
      username: "TP-MANAGED"
    });
    const service = new RouterService({ adapter, authSession: adminSession });

    const report = await service.decommissionTicketProVouchers();

    expect(report).toMatchObject({
      cleanupVersion: 1,
      failedCount: 0,
      remainingAuthorizationCount: 0,
      remainingManagedUserCount: 0,
      removedCount: 1,
      requestedCount: 1
    });
    await expect(adapter.findHotspotUser("TP-MANAGED")).resolves.toBeNull();
    await expect(adapter.findHotspotUser("J001")).resolves.not.toBeNull();
  });

  it("conserve un rapport non conforme lorsque RouterOS refuse un nettoyage", async () => {
    const adapter = new FakeRouterAdapter({ latencyMs: 0 });
    await adapter.createHotspotUser({
      comment: "TicketPro:v1;batch=batch-failure;state=new;",
      passwordSecretRef: "secret://managed-failure/password",
      planId: "plan-jour",
      username: "TP-FAILURE"
    });
    adapter.removeHotspotUser = async () => {
      throw new Error("RouterOS unavailable");
    };
    const service = new RouterService({ adapter, authSession: adminSession });

    await expect(service.decommissionTicketProVouchers()).resolves.toMatchObject({
      failedCount: 1,
      remainingAuthorizationCount: 1,
      remainingManagedUserCount: 1,
      removedCount: 0,
      requestedCount: 1
    });
  });
});
