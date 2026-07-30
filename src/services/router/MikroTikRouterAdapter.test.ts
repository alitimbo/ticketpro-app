import { describe, expect, it } from "vitest";
import { protectTicketPassword, resolveTicketPasswordValue } from "../tickets";
import { MikroTikRouterAdapter, normalizeMikroTikError } from "./MikroTikRouterAdapter";
import type { RouterOsApiRequest, RouterOsApiRow, RouterOsApiTransport } from "./RouterOsApiTransport";

class MockRouterOsTransport implements RouterOsApiTransport {
  readonly calls: RouterOsApiRequest[] = [];

  constructor(private readonly responses: Record<string, RouterOsApiRow[]>) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.calls.push(request);
    if (request.command === "/ip/hotspot/ip-binding/remove") {
      const rows = this.responses["/ip/hotspot/ip-binding/print"] ?? [];
      const bindingId = String(request.params?.numbers ?? "");
      const index = rows.findIndex((row) => row[".id"] === bindingId || row.id === bindingId);
      if (index >= 0) rows.splice(index, 1);
      return [];
    }
    if (
      request.command === "/ip/firewall/filter/remove"
      || request.command === "/ipv6/firewall/filter/remove"
    ) {
      const printCommand = request.command.replace(/\/remove$/, "/print");
      const rows = this.responses[printCommand] ?? [];
      const ruleId = String(request.params?.numbers ?? "");
      const index = rows.findIndex((row) => row[".id"] === ruleId || row.id === ruleId);
      if (index >= 0) rows.splice(index, 1);
      return [];
    }
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
  it("met à jour le DNS du profil utilisé par le Hotspot existant", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [{
        ".id": "*H1",
        disabled: "false",
        name: "ticketpro-hotspot",
        profile: "ticketpro-hotspot-profile"
      }],
      "/ip/hotspot/profile/print": [{
        ".id": "*P1",
        "dns-name": "ancien.hotspot.test",
        name: "ticketpro-hotspot-profile"
      }],
      "/ip/hotspot/profile/set": []
    });
    const adapter = createAdapter(transport);

    await expect(adapter.upsertHotspotDns(" WIFI.NOUVEAU.TEST. ")).resolves.toEqual({
      action: "updated",
      dnsName: "wifi.nouveau.test",
      profileName: "ticketpro-hotspot-profile",
      serverName: "ticketpro-hotspot"
    });
    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/profile/set")?.params
    ).toEqual({
      "dns-name": "wifi.nouveau.test",
      numbers: "*P1"
    });
  });

  it("crée un profil DNS TicketPro lorsqu'aucun profil Hotspot n'existe", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [],
      "/ip/hotspot/profile/print": [],
      "/ip/hotspot/profile/add": []
    });
    const adapter = createAdapter(transport);

    await expect(adapter.upsertHotspotDns("wifi.ticketpro.test")).resolves.toEqual({
      action: "created",
      dnsName: "wifi.ticketpro.test",
      profileName: "ticketpro-hotspot-profile",
      serverName: null
    });
    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/profile/add")?.params
    ).toEqual({
      "dns-name": "wifi.ticketpro.test",
      name: "ticketpro-hotspot-profile"
    });
  });

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

  it("convertit une durée RouterOS exprimée en semaines", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P7",
        name: "7-jours",
        "rate-limit": "2M/5M",
        "session-timeout": "1w",
        "shared-users": "1"
      }]
    }));

    await expect(adapter.getHotspotPlans()).resolves.toEqual([
      expect.objectContaining({
        durationMinutes: 10_080,
        profileName: "7-jours",
        validityMinutes: 10_080
      })
    ]);
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

  it("protège immédiatement le vrai mot de passe lu lors d'une récupération RouterOS", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U5",
        name: "CLIENT01",
        password: "Secret-987",
        profile: "plan-3h"
      }]
    }));

    const [user] = await adapter.listHotspotUsers();

    expect(user.passwordSecretRef).not.toContain("Secret-987");
    await expect(resolveTicketPasswordValue(user)).resolves.toBe("Secret-987");
  });

  it("détecte un tunnel TicketPro existant après une réinstallation locale", async () => {
    const transport = new MockRouterOsTransport({
      "/interface/wireguard/print": [{
        ".id": "*WG1",
        name: "ticketpro-vpn",
        "public-key": "router-public"
      }],
      "/ip/address/print": [{
        ".id": "*ADDR1",
        address: "10.250.0.2/32",
        interface: "ticketpro-vpn"
      }],
      "/interface/wireguard/peers/print": [{
        ".id": "*PEER1",
        interface: "ticketpro-vpn",
        "public-key": "server-public"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.getWireGuardInstallation("ticketpro-vpn")).resolves.toEqual({
      assignedAddress: "10.250.0.2/32",
      interfaceName: "ticketpro-vpn",
      publicKey: "router-public",
      serverPublicKeys: ["server-public"]
    });
  });

  it("réadopte une interface WireGuard sans remplacer sa clé privée", async () => {
    const transport = new MockRouterOsTransport({
      "/interface/wireguard/print": [{
        ".id": "*WG1",
        name: "ticketpro-vpn",
        "public-key": "router-public"
      }],
      "/ip/address/print": [{
        ".id": "*ADDR1",
        address: "10.250.0.2/32",
        interface: "ticketpro-vpn"
      }],
      "/interface/wireguard/peers/print": [{
        ".id": "*PEER1",
        interface: "ticketpro-vpn",
        "public-key": "server-public"
      }],
      "/ip/route/print": [{
        ".id": "*ROUTE1",
        "dst-address": "10.250.0.0/24"
      }],
      "/ip/firewall/filter/print": [{
        ".id": "*FILTER1",
        comment: "TicketPro WireGuard"
      }]
    });
    const adapter = createAdapter(transport);

    await adapter.provisionWireGuard({
      assignedAddress: "10.250.0.2/32",
      interfaceName: "ticketpro-vpn",
      serverAllowedIps: "10.250.0.0/24",
      serverEndpoint: "vpn.example.com",
      serverPort: 51820,
      serverPublicKey: "server-public"
    });

    const interfaceSet = transport.calls.find((call) => call.command === "/interface/wireguard/set");
    expect(interfaceSet?.params).toEqual({
      "listen-port": 13231,
      numbers: "*WG1"
    });
    expect(transport.calls.some((call) => call.command === "/interface/wireguard/add")).toBe(false);
    expect(transport.calls.some((call) => call.command === "/ip/address/add")).toBe(false);
    expect(transport.calls.some((call) => call.command === "/interface/wireguard/peers/add")).toBe(false);
  });

  it("verrouille puis libère un utilisateur Hotspot par adresse MAC", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U1",
        "mac-address": "AA:BB:CC:DD:EE:01",
        name: "123456",
        profile: "plan-1"
      }]
    });
    const adapter = createAdapter(transport);

    await adapter.bindHotspotUserToMac("123456", "aa-bb-cc-dd-ee-01");
    await adapter.clearHotspotUserMac("123456");

    const setCalls = transport.calls.filter(
      (call) => call.command === "/ip/hotspot/user/set"
    );
    expect(setCalls[0]?.params).toEqual({
      "mac-address": "AA:BB:CC:DD:EE:01",
      numbers: "*U1"
    });
    expect(setCalls[1]?.params).toEqual({
      "mac-address": "00:00:00:00:00:00",
      numbers: "*U1"
    });
  });

  it("gère uniquement ses propres bypass d'infrastructure", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/ip-binding/print": [
        {
          ".id": "*MANUAL",
          comment: "Règle installateur",
          "mac-address": "AA:BB:CC:DD:EE:10"
        },
        {
          ".id": "*TP1",
          comment: "TicketPro infrastructure:antenna-1 Ancien nom",
          "mac-address": "AA:BB:CC:DD:EE:11"
        }
      ]
    });
    const adapter = createAdapter(transport);

    await adapter.upsertHotspotBypass({
      address: "192.168.88.10",
      comment: "Antenne nord",
      id: "antenna-1",
      macAddress: "AA:BB:CC:DD:EE:10"
    });
    await adapter.removeHotspotBypass("manual-rule", "AA:BB:CC:DD:EE:10");
    await adapter.removeHotspotBypass("antenna-1", "AA:BB:CC:DD:EE:10");

    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/ip-binding/set")?.params
    ).toMatchObject({
      address: "192.168.88.10",
      numbers: "*TP1",
      type: "bypassed"
    });
    const removeCalls = transport.calls.filter(
      (call) => call.command === "/ip/hotspot/ip-binding/remove"
    );
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]?.params).toEqual({ numbers: "*TP1" });
  });

  it("installe idempotemment le blocage du partage Hotspot", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [{
        ".id": "*HS1",
        disabled: "false",
        interface: "ether1",
        name: "ticketpro-hotspot"
      }],
      "/ip/firewall/filter/print": [
        {
          ".id": "*TP63",
          action: "drop",
          chain: "forward",
          comment: "TicketPro anti-tethering:IPv4 TTL 63",
          hotspot: "auth",
          ttl: "63"
        },
        {
          ".id": "*F0",
          action: "accept",
          chain: "forward",
          comment: "Règle installateur"
        }
      ],
      "/ipv6/firewall/filter/print": [{
        ".id": "*V0",
        action: "accept",
        chain: "forward",
        comment: "Règle IPv6 installateur"
      }],
      "/ip/hotspot/user/profile/print": [
        { ".id": "*P1", name: "6h", "shared-users": "3" },
        { ".id": "*P2", name: "1j", "shared-users": "1" }
      ]
    });
    const adapter = createAdapter(transport);

    await adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: true,
      blockIpv6: true,
      enabled: true
    });

    expect(
      transport.calls.find((call) =>
        call.command === "/ip/firewall/filter/set"
      )?.params
    ).toMatchObject({
      comment: "TicketPro anti-tethering:IPv4 TTL 63",
      hotspot: "auth",
      numbers: "*TP63",
      ttl: "63"
    });
    expect(
      transport.calls.find((call) =>
        call.command === "/ip/firewall/filter/add"
      )?.params
    ).toMatchObject({
      action: "drop",
      comment: "TicketPro anti-tethering:IPv4 TTL 127",
      hotspot: "auth",
      "place-before": "*F0",
      ttl: "127"
    });
    expect(
      transport.calls.find((call) =>
        call.command === "/ipv6/firewall/filter/add"
      )?.params
    ).toMatchObject({
      action: "drop",
      comment: "TicketPro anti-tethering:IPv6 ether1",
      "in-interface": "ether1",
      "place-before": "*V0"
    });
    expect(
      transport.calls.filter((call) =>
        call.command === "/ip/hotspot/user/profile/set"
      )
    ).toEqual([
      expect.objectContaining({
        params: {
          numbers: "*P1",
          "shared-users": "1"
        }
      })
    ]);
  });

  it("lit l'état réel des protections et des bypass TicketPro", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/firewall/filter/print": [{
        ".id": "*TP63",
        comment: "TicketPro anti-tethering:IPv4 TTL 63",
        disabled: "false"
      }],
      "/ipv6/firewall/filter/print": [{
        ".id": "*TPV6",
        comment: "TicketPro anti-tethering:IPv6 ether1",
        disabled: "false"
      }],
      "/ip/hotspot/ip-binding/print": [
        {
          ".id": "*B1",
          address: "192.168.88.10",
          comment: "TicketPro infrastructure:antenna-1 Antenne nord (antenna)",
          "mac-address": "AA:BB:CC:DD:EE:10",
          type: "bypassed"
        },
        {
          ".id": "*MANUAL",
          comment: "Bypass installateur",
          "mac-address": "AA:BB:CC:DD:EE:20"
        }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.getHotspotAntiTetheringState()).resolves.toEqual({
      blockIpv4Ttl: true,
      blockIpv6: true,
      managedRuleCount: 2
    });
    await expect(adapter.listManagedHotspotBypasses()).resolves.toEqual([{
      address: "192.168.88.10",
      comment: "Antenne nord (antenna)",
      id: "antenna-1",
      macAddress: "AA:BB:CC:DD:EE:10"
    }]);
  });

  it("reprend automatiquement la syntaxe TTL des anciennes versions RouterOS", async () => {
    const calls: RouterOsApiRequest[] = [];
    const responses: Record<string, RouterOsApiRow[]> = {
      "/ip/hotspot/print": [{
        ".id": "*HS1",
        disabled: "false",
        interface: "ether1",
        name: "ticketpro-hotspot"
      }],
      "/ip/firewall/filter/print": [],
      "/ipv6/firewall/filter/print": [],
      "/ip/hotspot/user/profile/print": []
    };
    const transport: RouterOsApiTransport = {
      async call(request) {
        calls.push(request);
        if (
          request.command === "/ip/firewall/filter/add"
          && /^\d+$/.test(String(request.params?.ttl ?? ""))
        ) {
          throw new Error("router rejected: invalid value for argument ttl");
        }
        return responses[request.command] ?? [];
      }
    };
    const adapter = createAdapter(transport);

    await adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: true,
      blockIpv6: false,
      enabled: true
    });

    expect(
      calls
        .filter((call) => call.command === "/ip/firewall/filter/add")
        .map((call) => call.params?.ttl)
    ).toEqual(["63", "equal:63", "127", "equal:127"]);
  });

  it("retire seulement les règles anti-partage gérées par TicketPro", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [],
      "/ip/firewall/filter/print": [
        {
          ".id": "*TP63",
          chain: "forward",
          comment: "TicketPro anti-tethering:IPv4 TTL 63"
        },
        {
          ".id": "*MANUAL",
          chain: "forward",
          comment: "Blocage manuel TTL"
        }
      ],
      "/ipv6/firewall/filter/print": [{
        ".id": "*TPV6",
        chain: "forward",
        comment: "TicketPro anti-tethering:IPv6 ether1"
      }]
    });
    const adapter = createAdapter(transport);

    await adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: true,
      blockIpv6: true,
      enabled: false
    });

    expect(
      transport.calls
        .filter((call) => call.command.endsWith("/remove"))
        .map((call) => call.params?.numbers)
    ).toEqual(["*TP63", "*TPV6"]);
  });

  it("retire réellement les règles TTL quand la case IPv4 est décochée", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [{
        ".id": "*HS1",
        disabled: "false",
        interface: "ether1",
        name: "ticketpro-hotspot"
      }],
      "/ip/firewall/filter/print": [
        {
          ".id": "*TP63",
          chain: "forward",
          comment: "TicketPro anti-tethering:IPv4 TTL 63"
        },
        {
          ".id": "*TP127",
          chain: "forward",
          comment: "TicketPro anti-tethering:IPv4 TTL 127"
        },
        {
          ".id": "*MANUAL",
          chain: "forward",
          comment: "Blocage manuel TTL"
        }
      ],
      "/ipv6/firewall/filter/print": [],
      "/ip/hotspot/user/profile/print": []
    });
    const adapter = createAdapter(transport);

    await adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: false,
      blockIpv6: false,
      enabled: true
    });

    expect(
      transport.calls
        .filter((call) => call.command === "/ip/firewall/filter/remove")
        .map((call) => call.params?.numbers)
    ).toEqual(["*TP63", "*TP127"]);
    expect(
      transport.calls.filter((call) => call.command === "/ip/firewall/filter/print")
    ).toHaveLength(2);
  });

  it("refuse de confirmer la désactivation si RouterOS conserve une règle TTL", async () => {
    const ttlRule = {
      ".id": "*TP63",
      chain: "forward",
      comment: "TicketPro anti-tethering:IPv4 TTL 63"
    };
    const transport: RouterOsApiTransport = {
      async call(request) {
        if (request.command === "/ip/hotspot/print") return [];
        if (request.command === "/ip/firewall/filter/print") return [ttlRule];
        if (request.command === "/ipv6/firewall/filter/print") return [];
        return [];
      }
    };
    const adapter = createAdapter(transport);

    await expect(adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: false,
      blockIpv6: false,
      enabled: false
    })).rejects.toThrow("RouterOS kept a TicketPro anti-tethering rule after removal");
  });
});
