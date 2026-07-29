import { describe, expect, it } from "vitest";
import { protectTicketPassword } from "../tickets";
import { MikroTikRouterAdapter, normalizeMikroTikError } from "./MikroTikRouterAdapter";
import type { RouterOsApiRequest, RouterOsApiRow, RouterOsApiTransport } from "./RouterOsApiTransport";

class MockRouterOsTransport implements RouterOsApiTransport {
  readonly calls: RouterOsApiRequest[] = [];

  constructor(private readonly responses: Record<string, RouterOsApiRow[]>) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.calls.push(request);
    return this.responses[request.command] ?? [];
  }
}

function createAdapter(transport: RouterOsApiTransport) {
  return new MikroTikRouterAdapter({
    host: "192.168.88.1",
    password: "secret-not-logged",
    port: 8728,
    timeoutMs: 1000,
    transport,
    username: "api-user"
  });
}

describe("MikroTikRouterAdapter", () => {
  it("mappe les profils et la santé RouterOS vers le modèle interne", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [
        {
          ".id": "*A",
          address: "192.168.88.20",
          "bytes-in": "1024",
          "bytes-out": "2048",
          "mac-address": "AA:BB:CC:DD:EE:01",
          "session-time-left": "2h",
          uptime: "10m",
          user: "123456"
        }
      ],
      "/ip/hotspot/user/profile/print": [
        {
          ".id": "*1",
          comment:
            'hotspot-manager:{"name":"3h-2Go","durationMinutes":180,"validityMinutes":300,"dataLimitMb":2048,"priceHint":500}',
          name: "plan-3h",
          "rate-limit": "2M/5M",
          "session-timeout": "3h",
          "shared-users": "1"
        }
      ],
      "/system/resource/print": [
        {
          "cpu-load": "18",
          "free-memory": "100",
          "total-memory": "256",
          uptime: "1d"
        }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.getHotspotPlans()).resolves.toEqual([
      expect.objectContaining({
        dataLimitMb: 2048,
        durationMinutes: 180,
        id: "*1",
        name: "3h-2Go",
        profileName: "plan-3h",
        validityMinutes: 300
      })
    ]);
    await expect(adapter.getRouterHealth()).resolves.toMatchObject({
      activeClientsCount: 1,
      cpuLoad: 18,
      memoryTotal: 256,
      memoryUsed: 156
    });
  });

  it("crée un utilisateur réel avec les limites RouterOS sans exposer le mot de passe", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/add": [],
      "/ip/hotspot/user/print": [
        {
          ".id": "*U1",
          disabled: "false",
          name: "123456",
          profile: "plan-3h"
        }
      ],
      "/ip/hotspot/user/profile/print": [
        {
          ".id": "*P1",
          name: "plan-3h",
          "session-timeout": "3h",
          "shared-users": "1"
        }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(
      adapter.createHotspotUser({
        limitBytesTotal: 2147483648,
        limitUptime: "3h",
        passwordSecretRef: "secret://routeur-demo/123456/password",
        planId: "*P1",
        username: "123456"
      })
    ).resolves.toMatchObject({ id: "*U1", username: "123456" });

    const addCall = transport.calls.find((call) => call.command === "/ip/hotspot/user/add");
    expect(addCall?.params).toMatchObject({
      "limit-bytes-total": 2147483648,
      "limit-uptime": "3h",
      name: "123456",
      password: "123456",
      profile: "plan-3h"
    });
    expect(JSON.stringify(normalizeMikroTikError(new Error("authentication failed")))).not.toContain("secret-not-logged");
  });

  it("déchiffre un mot de passe distinct uniquement au moment de l'envoi à RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/add": [],
      "/ip/hotspot/user/print": [{
        ".id": "*U4",
        name: "123456",
        profile: "plan-3h"
      }],
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P1",
        name: "plan-3h",
        "shared-users": "1"
      }]
    });
    const adapter = createAdapter(transport);
    const protectedPassword = await protectTicketPassword("847295");

    await adapter.createHotspotUser({
      passwordSecretRef: protectedPassword,
      planId: "plan-3h",
      username: "123456"
    });

    expect(protectedPassword).not.toContain("847295");
    expect(transport.calls.find((call) => call.command === "/ip/hotspot/user/add")?.params).toMatchObject({
      name: "123456",
      password: "847295"
    });
  });

  it("mesure uniquement les interfaces RouterOS réellement présentes", async () => {
    const transport = new MockRouterOsTransport({
      "/interface/print": [
        { disabled: "false", name: "ether1", running: "true" },
        { disabled: "false", name: "ether2", running: "true" },
        { disabled: "false", name: "ticketpro-vpn", running: "true" }
      ],
      "/interface/monitor-traffic": [{
        "rx-bits-per-second": "8000",
        "tx-bits-per-second": "16000"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.getInterfaceTraffic()).resolves.toEqual([
      {
        interfaceName: "ether1",
        isRunning: true,
        rxBytesPerSecond: 1000,
        txBytesPerSecond: 2000
      },
      {
        interfaceName: "ether2",
        isRunning: true,
        rxBytesPerSecond: 1000,
        txBytesPerSecond: 2000
      },
      {
        interfaceName: "ticketpro-vpn",
        isRunning: true,
        rxBytesPerSecond: 1000,
        txBytesPerSecond: 2000
      }
    ]);
    expect(
      transport.calls
        .filter((call) => call.command === "/interface/monitor-traffic")
        .map((call) => call.params?.interface)
    ).toEqual(["ether1", "ether2", "ticketpro-vpn"]);
    expect(
      transport.calls.some((call) => call.params?.interface === "all")
    ).toBe(false);
  });

  it("détecte un voucher arrivé à sa limite RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U2",
        "bytes-in": "1000",
        "bytes-out": "4000",
        "limit-bytes-total": "5000",
        "limit-uptime": "1h",
        name: "654321",
        profile: "plan-1h",
        uptime: "45m"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.listHotspotUsers()).resolves.toEqual([
      expect.objectContaining({
        downloadedBytes: 4000,
        status: "expired",
        uploadedBytes: 1000,
        username: "654321"
      })
    ]);
  });

  it("liste puis déconnecte une session Hotspot avec son identifiant RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [{
        ".id": "*A",
        address: "192.168.88.20",
        "bytes-in": "1024",
        "bytes-out": "4096",
        "mac-address": "AA:BB:CC:DD:EE:01",
        uptime: "12m",
        user: "voucher-1"
      }],
      "/ip/hotspot/active/remove": []
    });
    const adapter = createAdapter(transport);

    await expect(adapter.listActiveUsers()).resolves.toEqual([
      expect.objectContaining({
        downloadedBytes: 4096,
        id: "*A",
        uploadedBytes: 1024,
        username: "voucher-1"
      })
    ]);
    await expect(adapter.disconnectActiveUser("voucher-1")).resolves.toBeUndefined();
    expect(transport.calls[transport.calls.length - 1]).toMatchObject({
      command: "/ip/hotspot/active/remove",
      params: { numbers: "*A" }
    });
  });

  it("efface explicitement les anciennes limites lors du passage à un plan illimité", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U3",
        name: "777777",
        profile: "ancien-plan"
      }],
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P2",
        name: "illimite",
        "shared-users": "1"
      }],
      "/ip/hotspot/user/set": []
    });
    const adapter = createAdapter(transport);

    await adapter.updateHotspotUser("777777", "illimite", {
      limitBytesTotal: null,
      limitUptime: null
    });

    expect(transport.calls.find((call) => call.command === "/ip/hotspot/user/set")?.params).toMatchObject({
      "limit-bytes-total": "",
      "limit-uptime": "",
      numbers: "*U3",
      profile: "illimite"
    });
  });

  it("omet les attributs non supportés et respecte l'ordre upload/download de RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/add": [],
      "/ip/hotspot/user/profile/print": [
        {
          ".id": "*P1",
          name: "forfait-1h",
          "session-timeout": "1h",
          "shared-users": "1"
        }
      ],
      "/ip/hotspot/user/profile/set": []
    });
    const adapter = createAdapter(transport);
    const draft = {
      dataLimitMb: null,
      downloadLimit: "5M",
      durationMinutes: 60,
      name: "Forfait 1H",
      priceHint: 100,
      profileName: "forfait-1h",
      sharedUsers: 1,
      uploadLimit: "2M",
      validityMinutes: 180
    };

    await adapter.createHotspotPlan({ ...draft, status: "disabled" });
    await adapter.updateHotspotPlan("forfait-1h", { ...draft, status: "active" });

    const addParams = transport.calls.find(
      (call) => call.command === "/ip/hotspot/user/profile/add"
    )?.params;
    const updateParams = transport.calls.find(
      (call) => call.command === "/ip/hotspot/user/profile/set"
    )?.params;

    expect(addParams).toMatchObject({ name: "forfait-1h" });
    expect(addParams).toMatchObject({ "rate-limit": "2M/5M" });
    expect(addParams).not.toHaveProperty("comment");
    expect(addParams).not.toHaveProperty("disabled");
    expect(updateParams).toMatchObject({ numbers: "*P1" });
    expect(updateParams).toMatchObject({ "rate-limit": "2M/5M" });
    expect(updateParams).not.toHaveProperty("comment");
    expect(updateParams).not.toHaveProperty("disabled");
  });

  it("traduit les erreurs RouterOS en codes internes", () => {
    expect(normalizeMikroTikError(new Error("connection refused")).code).toBe("api_disabled");
    expect(normalizeMikroTikError(new Error("not enough permissions")).code).toBe("permission_denied");
    expect(normalizeMikroTikError(new Error("failure: user already have such name")).code).toBe("duplicate_user");
    expect(normalizeMikroTikError(new Error("no such item")).code).toBe("hotspot_not_found");
    expect(normalizeMikroTikError(new Error("authentication failed")).code).toBe("authentication_failed");
    expect(normalizeMikroTikError(new Error("router rejected: invalid value")).code).toBe("router_rejected");
  });

  it("injecte idempotemment WireGuard avec de vraies query words", async () => {
    const transport = new MockRouterOsTransport({});
    const adapter = createAdapter(transport);

    await adapter.provisionWireGuard({
      assignedAddress: "10.250.0.2/24",
      interfaceName: "ticketpro-vpn",
      privateKey: "router-private",
      serverAllowedIps: "10.250.0.0/24",
      serverEndpoint: "vpn.example.com",
      serverPort: 51820,
      serverPublicKey: "server-public"
    });

    expect(transport.calls.map((call) => call.command)).toEqual([
      "/interface/wireguard/print",
      "/interface/wireguard/add",
      "/ip/address/print",
      "/ip/address/add",
      "/interface/wireguard/peers/print",
      "/interface/wireguard/peers/add",
      "/ip/route/print",
      "/ip/route/add",
      "/ip/firewall/filter/print",
      "/ip/firewall/filter/print",
      "/ip/firewall/filter/add"
    ]);
    expect(transport.calls.find((call) => call.command === "/interface/wireguard/print")?.queries).toEqual({
      name: "ticketpro-vpn"
    });
    expect(transport.calls.find((call) => call.command === "/interface/wireguard/add")?.params).toMatchObject({
      name: "ticketpro-vpn",
      "private-key": "router-private"
    });
    expect(transport.calls.find((call) => call.command === "/ip/firewall/filter/add")?.params).toMatchObject({
      action: "accept",
      chain: "input",
      "in-interface": "ticketpro-vpn"
    });
  });
});
