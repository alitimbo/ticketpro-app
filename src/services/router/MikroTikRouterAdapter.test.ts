import { describe, expect, it } from "vitest";
import { protectTicketPassword, resolveTicketPasswordValue } from "../tickets";
import {
  buildVoucherExpirationScript,
  buildVoucherLifecycleComment,
  mergeHotspotLoginBy,
  mergeVoucherLifecycleOnLogin,
  MikroTikRouterAdapter,
  normalizeMikroTikError,
  reconcileVoucherLifecycleComment
} from "./MikroTikRouterAdapter";
import { readPlanQuotaMetadata } from "./PlanQuotaMetadata";
import type {
  RouterOsApiBatchCommand,
  RouterOsApiBatchResponse,
  RouterOsApiRequest,
  RouterOsApiRow,
  RouterOsApiTransport
} from "./RouterOsApiTransport";

class MockRouterOsTransport implements RouterOsApiTransport {
  readonly calls: RouterOsApiRequest[] = [];

  constructor(private readonly responses: Record<string, RouterOsApiRow[]>) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.calls.push(request);
    if (request.command === "/ip/hotspot/user/profile/add") {
      const rows = this.responses["/ip/hotspot/user/profile/print"] ??= [];
      const existing = rows.find(row => row.name === request.params?.name);
      if (existing) Object.assign(existing, stringParams(request.params));
      else rows.push({ ".id": `*P${rows.length + 1}`, ...stringParams(request.params) });
      return [];
    }
    if (request.command === "/ip/hotspot/user/profile/set" || request.command === "/ip/hotspot/user/set") {
      mutateResponseRow(this.responses[request.command.replace(/\/set$/, "/print")] ?? [], request);
      return [];
    }
    const hotspotRemovalTargets: Record<string, string> = {
      "/ip/hotspot/active/remove": "/ip/hotspot/active/print",
      "/ip/hotspot/cookie/remove": "/ip/hotspot/cookie/print",
      "/ip/hotspot/host/remove": "/ip/hotspot/host/print",
      "/ip/hotspot/user/profile/remove": "/ip/hotspot/user/profile/print",
      "/ip/hotspot/user/remove": "/ip/hotspot/user/print",
      "/ip/firewall/connection/remove": "/ip/firewall/connection/print"
    };
    const hotspotPrintCommand = hotspotRemovalTargets[request.command];
    if (hotspotPrintCommand) {
      const rows = this.responses[hotspotPrintCommand] ?? [];
      const itemId = String(request.params?.numbers ?? "");
      const index = rows.findIndex((row) => row[".id"] === itemId || row.id === itemId);
      if (index >= 0) rows.splice(index, 1);
      return [];
    }
    if (request.command === "/ip/hotspot/ip-binding/add") {
      const rows = this.responses["/ip/hotspot/ip-binding/print"] ??= [];
      rows.push({ ".id": `*TP${rows.length + 1}`, ...request.params });
      return [];
    }
    if (request.command === "/ip/hotspot/ip-binding/set") {
      const rows = this.responses["/ip/hotspot/ip-binding/print"] ?? [];
      const bindingId = String(request.params?.numbers ?? "");
      const row = rows.find((item) => item[".id"] === bindingId || item.id === bindingId);
      if (row && request.params) {
        for (const [key, value] of Object.entries(request.params)) {
          if (key !== "numbers") row[key] = value == null ? "" : String(value);
        }
      }
      return [];
    }
    if (request.command === "/ip/hotspot/ip-binding/remove") {
      const rows = this.responses["/ip/hotspot/ip-binding/print"] ?? [];
      const bindingId = String(request.params?.numbers ?? "");
      const index = rows.findIndex((row) => row[".id"] === bindingId || row.id === bindingId);
      if (index >= 0) rows.splice(index, 1);
      return [];
    }
    if (request.command === "/user/group/add") {
      const rows = this.responses["/user/group/print"] ??= [];
      rows.push({ ".id": `*UG${rows.length + 1}`, ...stringParams(request.params) });
      return [];
    }
    if (request.command === "/user/group/set") {
      mutateResponseRow(this.responses["/user/group/print"] ?? [], request);
      return [];
    }
    if (request.command === "/user/add") {
      const rows = this.responses["/user/print"] ??= [];
      const params = stringParams(request.params);
      delete params.password;
      rows.push({ ".id": `*U${rows.length + 1}`, ...params });
      return [];
    }
    if (request.command === "/user/set") {
      mutateResponseRow(this.responses["/user/print"] ?? [], request, new Set(["password"]));
      return [];
    }
    if (request.command === "/ip/service/set") {
      mutateResponseRow(this.responses["/ip/service/print"] ?? [], request);
      return [];
    }
    if (
      request.command === "/ip/firewall/filter/remove"
      || request.command === "/ip/firewall/mangle/remove"
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

class VoucherBatchRouterOsTransport implements RouterOsApiTransport {
  readonly batchCalls: RouterOsApiBatchCommand[][] = [];
  readonly calls: RouterOsApiRequest[] = [];
  readonly users: RouterOsApiRow[] = [];

  constructor(private interruptNextBatchAfter: number | null = null) {}

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.calls.push(request);
    if (request.command === "/ip/hotspot/user/profile/print") {
      return [{ ".id": "*P1", name: "plan-3h", "session-timeout": "3h", "shared-users": "1" }];
    }
    if (request.command === "/ip/hotspot/user/print") return [...this.users];
    return [];
  }

  async callBatch(request: Parameters<NonNullable<RouterOsApiTransport["callBatch"]>>[0]): Promise<RouterOsApiBatchResponse> {
    this.batchCalls.push(request.commands);
    const completedCount = this.interruptNextBatchAfter === null
      ? request.commands.length
      : Math.min(this.interruptNextBatchAfter, request.commands.length);
    const connectionError = this.interruptNextBatchAfter === null
      ? null
      : "router offline: injected connection reset";
    this.interruptNextBatchAfter = null;
    request.commands.slice(0, completedCount).forEach((command) => {
      const params = stringParams(command.params);
      this.users.push({ ".id": `*U${this.users.length + 1}`, ...params });
    });
    return {
      completedCount,
      connectionError,
      results: request.commands.slice(0, completedCount).map(() => ({ error: null, rows: [] }))
    };
  }
}

function stringParams(params: RouterOsApiRequest["params"]): RouterOsApiRow {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([key, value]) => [key, value == null ? "" : String(value)])
  );
}

function mutateResponseRow(
  rows: RouterOsApiRow[],
  request: RouterOsApiRequest,
  ignored = new Set<string>()
): void {
  const id = String(request.params?.numbers ?? "");
  const row = rows.find((candidate) => candidate[".id"] === id || candidate.id === id);
  if (!row) return;
  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (key === "numbers" || ignored.has(key)) continue;
    row[key] = value == null ? "" : String(value);
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
  it("enregistre puis relit un quota 2 Go sans perdre le script existant, et confirme le passage explicite à illimité", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{ ".id": "*P1", name: "quota-plan", "on-login": ':log info "custom";', "session-timeout": "1h" }]
    });
    const adapter = createAdapter(transport);
    const draft = { dataLimitMb: 2048, downloadLimit: null, uploadLimit: null, durationMinutes: 60, validityMinutes: 180, name: "Quota", profileName: "quota-plan", sharedUsers: 1, priceHint: null };
    await expect(adapter.updateHotspotPlan("quota-plan", draft)).resolves.toMatchObject({ dataLimitMb: 2048, dataLimitSource: "routeros" });
    const source = String(transport.calls.find(call => call.command === "/ip/hotspot/user/profile/set")?.params?.["on-login"]);
    expect(source).toContain(':log info "custom";');
    expect(readPlanQuotaMetadata(source)).toMatchObject({ dataLimitMb: 2048, durationMinutes: 60, validityMinutes: 180 });
    await expect(adapter.getHotspotPlans()).resolves.toEqual([expect.objectContaining({ dataLimitMb: 2048 })]);
    await expect(adapter.updateHotspotPlan("quota-plan", { dataLimitMb: null })).resolves.toMatchObject({ dataLimitMb: null, dataLimitSource: "routeros" });
    expect(transport.calls.every(call => !call.command.includes("reset-counters"))).toBe(true);
  });

  it("refuse un lot dont RouterOS relit un quota absent et bloque uniquement les vouchers incohérents", async () => {
    const transport = new VoucherBatchRouterOsTransport();
    const batchCall = transport.callBatch.bind(transport);
    transport.callBatch = async request => {
      const result = await batchCall(request);
      transport.users[0]["limit-bytes-total"] = "0";
      return result;
    };
    const results = await createAdapter(transport).createHotspotUsersExactBatch([
      { username: "quota-a", comment: "TicketPro:batch:quota-test", planId: "plan-3h", passwordSecretRef: "secret://test/quota-a/password", limitBytesTotal: 2_147_483_648 },
      { username: "quota-b", comment: "TicketPro:batch:quota-test", planId: "plan-3h", passwordSecretRef: "secret://test/quota-b/password", limitBytesTotal: 2_147_483_648 }
    ]);
    expect(results.map(result => result.status)).toEqual(["error", "confirmed"]);
    expect(transport.calls.filter(call => call.command === "/ip/hotspot/user/disable")).toHaveLength(1);
    expect(transport.calls.some(call => call.command.includes("reset-counters") || call.command.includes("user/remove"))).toBe(false);
  });

  it("refuse la réactivation lorsque téléchargement et envoi ont consommé le quota, même sans marqueur du scheduler", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{ ".id": "*Q1", name: "quota-exhausted", profile: "plan-3h", "limit-bytes-total": "10485760", "bytes-out": "8388608", "bytes-in": "2097152" }]
    });
    await expect(createAdapter(transport).enableHotspotUser("quota-exhausted")).rejects.toMatchObject({ code: "router_rejected" });
    expect(transport.calls.some(call => call.command === "/ip/hotspot/user/enable")).toBe(false);
  });
  it("bloque le provisionnement avant toute écriture lorsque Device Mode interdit le scheduler", async () => {
    const transport = new MockRouterOsTransport({
      "/system/device-mode/print": [{ flagged: "no", hotspot: "yes", scheduler: "no" }],
      "/system/resource/print": [{ version: "7.21.5 (long-term)" }]
    });

    await expect(createAdapter(transport).ensureVoucherLifecycleEngine()).rejects.toMatchObject({
      code: "device_mode_restricted"
    });
    expect(transport.calls.map((call) => call.command)).toEqual([
      "/system/resource/print",
      "/system/device-mode/print"
    ]);
  });

  it("refuse le provisionnement d'un routeur signalé flagged par RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/system/device-mode/print": [{ flagged: "yes", hotspot: "yes", scheduler: "yes" }],
      "/system/resource/print": [{ version: "7.21.5" }]
    });

    await expect(createAdapter(transport).ensureVoucherLifecycleEngine()).rejects.toMatchObject({
      code: "device_mode_flagged"
    });
    expect(transport.calls.some((call) => call.command === "/system/script/add")).toBe(false);
  });

  it("installe et repare le moteur autonome des vouchers", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P1",
        name: "forfait-1h",
        "on-login": ":log info \"script-existant\";",
        "session-timeout": "1h"
      }],
      "/ip/hotspot/print": [{ name: "ticketpro-hotspot", profile: "ticketpro-hotspot-profile" }],
      "/ip/hotspot/profile/print": [{
        ".id": "*HP1",
        "login-by": "http-chap,cookie",
        name: "ticketpro-hotspot-profile"
      }],
      "/system/clock/print": [{
        date: "2026-07-30",
        time: "12:00:00",
        "time-zone-name": "Africa/Niamey"
      }],
      "/system/ntp/client/print": [{ enabled: "true", status: "synchronized" }],
      "/system/ntp/client/servers/print": [{ address: "time.cloudflare.com" }],
      "/system/resource/print": [{ version: "7.20.1" }],
      "/system/scheduler/print": [],
      "/system/script/print": []
    });
    const adapter = createAdapter(transport);

    await expect(adapter.ensureVoucherLifecycleEngine({
      managedProfileNames: ["forfait-1h"]
    })).resolves.toEqual({
      clockReady: true,
      engineVersion: 6,
      managedProfileCount: 1,
      schedulerEnabled: true
    });
    expect(
      transport.calls.find((call) => call.command === "/system/script/add")?.params
    ).toMatchObject({
      name: "ticketpro-voucher-expiration-v1",
      policy: "read,write,policy,test"
    });
    expect(
      transport.calls.find((call) => call.command === "/system/scheduler/add")?.params
    ).toMatchObject({
      interval: "1m",
      name: "ticketpro-voucher-expiration-v1",
      "on-event": "ticketpro-voucher-expiration-v1"
    });
    const profileSource = String(
      transport.calls.find((call) => call.command === "/ip/hotspot/user/profile/set")
        ?.params?.["on-login"]
    );
    expect(profileSource).toContain("script-existant");
    expect(profileSource.match(/TICKETPRO-LIFECYCLE-BEGIN/g)).toHaveLength(1);
    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/user/profile/set")?.params
    ).toMatchObject({
      "add-mac-cookie": "yes",
      "mac-cookie-timeout": "1h"
    });
    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/profile/set")?.params
    ).toEqual({
      "login-by": "http-chap,cookie,mac-cookie",
      numbers: "*HP1"
    });
  });

  it("répare uniquement les profils explicitement revendiqués", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [
        {
          ".id": "*DEF",
          name: "default",
          "on-login": mergeVoucherLifecycleOnLogin(':log info "script-externe";'),
          "session-timeout": ""
        },
        { ".id": "*P1", name: "6h", "on-login": "", "session-timeout": "6h" }
      ],
      "/ip/hotspot/print": [],
      "/ip/hotspot/profile/print": [],
      "/system/clock/print": [{ date: "2026-08-27", time: "12:00:00" }],
      "/system/ntp/client/print": [{ enabled: "true", status: "synchronized" }],
      "/system/ntp/client/servers/print": [{ address: "time.cloudflare.com" }],
      "/system/resource/print": [{ version: "7.21.5" }],
      "/system/scheduler/print": [],
      "/system/script/print": []
    });

    await createAdapter(transport).ensureVoucherLifecycleEngine({
      managedProfileNames: ["default", "6h"]
    });

    const profileUpdates = transport.calls.filter(
      (call) => call.command === "/ip/hotspot/user/profile/set"
    );
    expect(profileUpdates).toHaveLength(1);
    expect(profileUpdates.find((call) => call.params?.numbers === "*P1")?.params)
      .toMatchObject({ "add-mac-cookie": "yes", numbers: "*P1" });
    expect(profileUpdates.some((call) => call.params?.numbers === "*DEF")).toBe(false);
  });

  it("inspecte les ressources gérées sans exposer de clé ni modifier RouterOS", async () => {
    const handler = mergeVoucherLifecycleOnLogin("");
    const transport = new MockRouterOsTransport({
      "/interface/wireguard/peers/print": [{ interface: "ticketpro-vpn", "public-key": "SECRET-PUBLIC" }],
      "/interface/wireguard/print": [{ ".id": "*WG1", disabled: "no", name: "ticketpro-vpn", "private-key": "SECRET-PRIVATE" }],
      "/ip/address/print": [{ address: "10.250.0.2/32", interface: "ticketpro-vpn" }],
      "/ip/firewall/filter/print": [],
      "/ip/firewall/mangle/print": [{ comment: "TicketPro anti-tethering:IPv4 client TTL ether1" }],
      "/ip/hotspot/ip-binding/print": [],
      "/ip/hotspot/profile/print": [{ ".id": "*HP1", "dns-name": "wifi.test", "login-by": "cookie,http-chap,mac-cookie", name: "hs-profile" }],
      "/ip/hotspot/user/profile/print": [
        { ".id": "*DEF", "add-mac-cookie": "yes", name: "default", "on-login": handler },
        { ".id": "*P1", "add-mac-cookie": "true", name: "6h", "on-login": handler }
      ],
      "/ip/hotspot/print": [{ disabled: "no", name: "hotspot1", profile: "hs-profile" }],
      "/ip/route/print": [{ comment: "TicketPro WireGuard", "dst-address": "10.250.0.0/16", gateway: "ticketpro-vpn" }],
      "/ipv6/firewall/filter/print": [],
      "/system/ntp/client/print": [{ enabled: "yes", status: "synchronized" }],
      "/system/ntp/client/servers/print": [{ address: "time.cloudflare.com" }],
      "/system/resource/print": [{ version: "7.21.5" }],
      "/system/scheduler/print": [{
        comment: "TicketPro managed voucher lifecycle v6",
        disabled: "no",
        interval: "1m",
        name: "ticketpro-voucher-expiration-v1",
        "on-event": "ticketpro-voucher-expiration-v1"
      }],
      "/system/script/print": [{
        comment: "TicketPro managed voucher lifecycle v6",
        name: "ticketpro-voucher-expiration-v1",
        policy: "read,write,policy,test",
        source: buildVoucherExpirationScript()
      }]
    });

    const manifest = await createAdapter(transport).inspectManagedResources({
      managedHotspotProfileNames: ["6h"],
      wireguardInterfaceName: "ticketpro-vpn"
    });

    expect(manifest.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "system-script:voucher-lifecycle", state: "present" }),
      expect.objectContaining({ key: "hotspot-user-profile-extension:6h", state: "present" }),
      expect.objectContaining({ key: "hotspot-user-profile-extension:unexpected:default", state: "drift" }),
      expect.objectContaining({ key: "wireguard-route:ticketpro-vpn", state: "present" })
    ]));
    expect(manifest.warnings).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain("SECRET-PRIVATE");
    expect(JSON.stringify(manifest)).not.toContain("SECRET-PUBLIC");
    expect(transport.calls.some((call) => /\/(add|set|remove)$/.test(call.command))).toBe(false);
  });

  it("prépare un compte RouterOS dédié sans désactiver le compte administrateur", async () => {
    const transport = new MockRouterOsTransport({
      "/user/group/print": [{ ".id": "*FULL", name: "full", policy: "local,read,write,policy,password,sensitive,api" }],
      "/user/print": [{ ".id": "*ADMIN", disabled: "no", group: "full", name: "admin" }]
    });

    const result = await createAdapter(transport).upsertManagementAccount({
      password: "Safe-RouterOS-Password-2026",
      username: "ticketpro-api"
    });

    expect(result).toEqual({
      action: "created",
      groupName: "ticketpro-api",
      username: "ticketpro-api"
    });
    expect(transport.calls.find((call) => call.command === "/user/group/add")?.params)
      .toEqual({ name: "ticketpro-api", policy: "api,policy,read,sensitive,test,write" });
    expect(transport.calls.find((call) => call.command === "/user/add")?.params)
      .toMatchObject({ disabled: "no", group: "ticketpro-api", name: "ticketpro-api" });
    expect(transport.calls.some((call) =>
      call.command === "/user/disable" && call.params?.numbers === "*ADMIN"
    )).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Safe-RouterOS-Password-2026");
  });

  it("refuse d'adopter silencieusement un compte RouterOS homonyme externe", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/user/group/print": [{ ".id": "*GROUP", name: "ticketpro-api", policy: "read" }],
      "/user/print": [{ ".id": "*USER", group: "full", name: "ticketpro-api" }]
    }));

    await expect(adapter.upsertManagementAccount({
      password: "Safe-RouterOS-Password-2026",
      username: "ticketpro-api"
    })).rejects.toMatchObject({ code: "router_rejected" });
  });

  it("durcit les services seulement après confirmation du chemin autorisé", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/service/print": [
        { ".id": "*API", address: "", disabled: "no", name: "api", port: "8728" },
        { ".id": "*WINBOX", address: "", disabled: "no", name: "winbox", port: "8291" },
        { ".id": "*SSH", address: "", disabled: "no", name: "ssh", port: "22" },
        { ".id": "*FTP", address: "", disabled: "no", name: "ftp", port: "21" }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.applyManagementServicePolicy({
      authorizedCidrs: ["192.168.88.0/24", "10.250.0.0/16"],
      currentPathConfirmed: false,
      disableUnusedServices: true
    })).rejects.toMatchObject({ code: "router_rejected" });
    expect(transport.calls.some((call) => call.command === "/ip/service/set")).toBe(false);

    const result = await adapter.applyManagementServicePolicy({
      authorizedCidrs: ["192.168.88.0/24", "10.250.0.0/16"],
      currentPathConfirmed: true,
      disableUnusedServices: true
    });

    expect(result).toEqual({
      disabledServices: ["ftp"],
      restrictedServices: ["api", "ssh", "winbox"]
    });
    expect(transport.calls.find((call) =>
      call.command === "/ip/service/set" && call.params?.numbers === "*API"
    )?.params).toMatchObject({
      address: "10.250.0.0/16,192.168.88.0/24",
      disabled: "no"
    });
  });

  it("met à niveau le script déjà installé sans créer de doublon", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [],
      "/system/clock/print": [{ date: "2026-08-11", time: "12:00:00" }],
      "/system/ntp/client/print": [{ enabled: "true", status: "synchronized" }],
      "/system/ntp/client/servers/print": [{ address: "time.cloudflare.com" }],
      "/system/resource/print": [{ version: "7.20.1" }],
      "/system/scheduler/print": [{
        ".id": "*S1",
        comment: "TicketPro managed voucher lifecycle v1",
        disabled: "no",
        interval: "1m",
        name: "ticketpro-voucher-expiration-v1",
        "on-event": "ticketpro-voucher-expiration-v1",
        policy: "read,write,policy,test",
        "start-time": "startup"
      }],
      "/system/script/print": [{
        ".id": "*SC1",
        comment: "TicketPro managed voucher lifecycle v1",
        name: "ticketpro-voucher-expiration-v1",
        policy: "read,write,policy,test",
        source: ":log info \"ancienne version\";"
      }]
    });

    await createAdapter(transport).ensureVoucherLifecycleEngine();

    expect(transport.calls.filter((call) => call.command === "/system/script/add")).toHaveLength(0);
    expect(transport.calls.find((call) => call.command === "/system/script/set")?.params).toMatchObject({
      comment: "TicketPro managed voucher lifecycle v6",
      numbers: "*SC1",
      source: expect.stringContaining("/ip hotspot user remove $tpId")
    });
    expect(transport.calls.find((call) => call.command === "/system/scheduler/set")?.params).toMatchObject({
      comment: "TicketPro managed voucher lifecycle v6",
      numbers: "*S1"
    });
  });

  it("encode la validite et remplace seulement le bloc TicketPro", () => {
    expect(buildVoucherLifecycleComment(300, "Lot local")).toBe(
      "TicketPro:v1;validity=300;expires=0;state=new;"
    );
    expect(buildVoucherLifecycleComment(300, "TicketProBatch:batch-42")).toBe(
      "TicketPro:v1;validity=300;expires=0;state=new;batch=batch-42;"
    );
    expect(mergeVoucherLifecycleOnLogin("script-externe")).toContain("$tpOwnership");
    expect(buildVoucherExpirationScript()).toContain("$tpOwnership");
    expect(buildVoucherLifecycleComment(null, "Lot local")).toBe("Lot local");
    expect(reconcileVoucherLifecycleComment(
      "TicketPro:v1;validity=180;expires=123;state=cleanup-error;",
      180
    )).toBe("TicketPro:v1;validity=180;expires=123;state=cleanup-error;");
    expect(reconcileVoucherLifecycleComment(
      "TicketPro:v1;validity=180;expires=123;state=active;",
      null
    )).toBe("TicketPro:v1;validity=180;expires=123;state=active;");
    expect(reconcileVoucherLifecycleComment(
      "TicketPro:v1;validity=180;expires=123;state=active;",
      600
    )).toBe("TicketPro:v1;validity=180;expires=123;state=active;");
    const first = mergeVoucherLifecycleOnLogin(':log info "avant";');
    const upgraded = mergeVoucherLifecycleOnLogin(first);
    expect(upgraded).toContain(':log info "avant";');
    expect(upgraded.match(/TICKETPRO-LIFECYCLE-BEGIN/g)).toHaveLength(1);
    expect(
      mergeVoucherLifecycleOnLogin("ancien-script", new Set(["ancien-script"]))
    ).toContain('/system script run "ancien-script";');
    const expirationScript = buildVoucherExpirationScript();
    expect(expirationScript).toContain("/ip hotspot active remove");
    expect(expirationScript).toContain("/ip hotspot cookie remove");
    expect(expirationScript).toContain("/ip hotspot host remove");
    expect(expirationScript).toContain("/ip firewall connection remove");
    expect(expirationScript).toContain("/ip hotspot user set $tpId disabled=yes");
    expect(expirationScript).toContain('tpState "exhausted"');
    expect(expirationScript).toContain("/ip hotspot user remove $tpId");
    expect(expirationScript).toContain("time-consumed");
    expect(expirationScript).toContain("quota-consumed");
    expect(expirationScript).toContain("validity-expired");
    expect(expirationScript).not.toContain("ip-binding remove [find where address=");
    expect(expirationScript).not.toContain("ip-binding remove [find where mac-address=");
    expect(expirationScript).toContain("tpForeignBindingId");
    expect(expirationScript).not.toContain("tpShouldRemove");
    expect(expirationScript).toContain(
      ':if (($tpExpired = false) && ($tpLimitUptime > 0) && ($tpUptime >= $tpLimitUptime)) do={ :set tpExhausted true; :set tpReason "time-consumed" };'
    );
    expect(expirationScript).toContain(
      ':if (($tpExpired = false) && ($tpLimitBytes > 0) && (($tpBytesIn + $tpBytesOut) >= $tpLimitBytes)) do={ :set tpExhausted true; :set tpReason "quota-consumed" };'
    );
    expect(expirationScript.indexOf(':if ($tpExpired = true) do={')).toBeLessThan(
      expirationScript.indexOf('/ip hotspot user remove $tpId')
    );
  });

  it("active cookie et mac-cookie sans retirer les méthodes Hotspot existantes", () => {
    expect(mergeHotspotLoginBy("http-pap,cookie")).toBe("http-pap,cookie,mac-cookie");
    expect(mergeHotspotLoginBy("mac-cookie")).toBe("mac-cookie,cookie,http-chap");
    expect(mergeHotspotLoginBy("http-chap,cookie,mac-cookie")).toBe(
      "http-chap,cookie,mac-cookie"
    );
  });

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

  it("lit un profil RouterOS natif sans confondre session et validité commerciale", async () => {
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
        durationMinutes: 0,
        profileName: "7-jours",
        ticketSettingsSource: "routeros",
        validityMinutes: null,
        profileSettings: expect.objectContaining({ sessionTimeout: "1w" })
      })
    ]);
  });

  it("n'affiche jamais les 3 jours du cookie MAC du profil default comme une validité de ticket", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{
        ".id": "*DEF",
        "add-mac-cookie": "yes",
        "mac-cookie-timeout": "3d",
        name: "default",
        "session-timeout": "0s",
        "shared-users": "1"
      }]
    }));

    await expect(adapter.getHotspotPlans()).resolves.toEqual([
      expect.objectContaining({
        durationMinutes: 0,
        profileName: "default",
        profileSettings: expect.objectContaining({ addMacCookie: true, macCookieTimeout: "3d" }),
        ticketSettingsSource: "routeros",
        validityMinutes: null
      })
    ]);
  });

  it("préfère les durées RouterOS réelles à un ancien commentaire TicketPro resté à 1 heure", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P3",
        comment:
          'hotspot-manager:{"name":"Forfait 3 heures","durationMinutes":60,"validityMinutes":60}',
        "mac-cookie-timeout": "5h",
        name: "forfait-3h",
        "rate-limit": "2M/5M",
        "session-timeout": "3h",
        "shared-users": "1"
      }]
    }));

    await expect(adapter.getHotspotPlans()).resolves.toEqual([
      expect.objectContaining({
        durationMinutes: 180,
        profileName: "forfait-3h",
        validityMinutes: 300
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
          "limit-uptime": "3h",
          name: "123456",
          "limit-bytes-total": "2147483648",
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
        serverName: "WiFi-Zone-Niamey",
        username: "123456",
        validityMinutes: 300
      })
    ).resolves.toMatchObject({ id: "*U1", username: "123456" });

    const addCall = transport.calls.find((call) => call.command === "/ip/hotspot/user/add");
    expect(addCall?.params).toMatchObject({
      comment: "TicketPro:v1;validity=300;expires=0;state=new;",
      "limit-bytes-total": 2147483648,
      "limit-uptime": "3h",
      name: "123456",
      password: "123456",
      profile: "plan-3h",
      server: "WiFi-Zone-Niamey"
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
        status: "exhausted",
        uploadedBytes: 1000,
        username: "654321"
      })
    ]);
  });

  it("reconnait un voucher expire par le moteur TicketPro", async () => {
    const adapter = createAdapter(new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U9",
        comment: "TicketPro:v1;validity=60;expires=123;state=expired;",
        disabled: "true",
        name: "999999",
        profile: "plan-1h"
      }]
    }));

    await expect(adapter.listHotspotUsers()).resolves.toEqual([
      expect.objectContaining({ status: "expired", username: "999999" })
    ]);
  });

  it("crée et confirme 500 vouchers avec cinq sessions RouterOS batch au lieu de 1500 sessions", async () => {
    const transport = new VoucherBatchRouterOsTransport();
    const drafts = Array.from({ length: 500 }, (_, index) => {
      const username = String(700000 + index);
      return {
        comment: "TicketPro:batch:test-batch",
        limitUptime: "3h",
        passwordSecretRef: `secret://router-demo/${username}/password`,
        planId: "plan-3h",
        serverName: "hotspot1",
        username,
        validityMinutes: 180
      };
    });

    const results = await createAdapter(transport).createHotspotUsersExactBatch(drafts);

    expect(results).toHaveLength(500);
    expect(results.every((result) => result.status === "confirmed")).toBe(true);
    expect(transport.batchCalls).toHaveLength(5);
    expect(transport.batchCalls.every((commands) => commands.length === 100)).toBe(true);
    expect(transport.calls.filter((call) => call.command === "/ip/hotspot/user/profile/print")).toHaveLength(1);
    expect(new Set(transport.users.map((user) => user.name)).size).toBe(500);
    expect(transport.calls
      .filter((call) => call.command === "/ip/hotspot/user/print")
      .every((call) => !String(call.params?.[".proplist"] ?? "").includes("password")))
      .toBe(true);
  });

  it("ne demande que les noms RouterOS lors du contrôle de collision avant génération", async () => {
    const transport = new VoucherBatchRouterOsTransport();
    transport.users.push({ name: "123456", password: "secret-inutile" });

    await expect(createAdapter(transport).listHotspotUsernames()).resolves.toEqual([
      { username: "123456" }
    ]);
    expect(transport.calls[transport.calls.length - 1]?.params).toEqual({ ".proplist": "name" });
  });

  it("reprend seulement les vouchers absents après une coupure au milieu d'un lot", async () => {
    const transport = new VoucherBatchRouterOsTransport(17);
    const drafts = Array.from({ length: 120 }, (_, index) => {
      const username = String(800000 + index);
      return {
        passwordSecretRef: `secret://router-demo/${username}/password`,
        planId: "plan-3h",
        username
      };
    });

    const results = await createAdapter(transport).createHotspotUsersExactBatch(drafts);

    expect(results.every((result) => result.status === "confirmed")).toBe(true);
    expect(transport.batchCalls.map((commands) => commands.length)).toEqual([100, 100, 3]);
    expect(new Set(transport.users.map((user) => user.name)).size).toBe(120);
  });

  it("recherche un voucher précis sans charger tout le catalogue RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U2",
        name: "654321",
        profile: "plan-1h"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.findHotspotUser("654321")).resolves.toMatchObject({
      id: "*U2",
      username: "654321"
    });
    expect(transport.calls).toContainEqual(expect.objectContaining({
      command: "/ip/hotspot/user/print",
      queries: { name: "654321" }
    }));
  });

  it("liste puis déconnecte toutes les sessions du voucher sans toucher aux autres", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [
        {
          ".id": "*A1",
          address: "192.168.88.20",
          "bytes-in": "1024",
          "bytes-out": "4096",
          "mac-address": "AA:BB:CC:DD:EE:01",
          uptime: "12m",
          user: "voucher-1"
        },
        { ".id": "*A2", address: "192.168.88.21", user: "voucher-1" },
        { ".id": "*A3", address: "192.168.88.22", user: "autre-voucher" }
      ],
      "/ip/hotspot/active/remove": []
    });
    const adapter = createAdapter(transport);

    await expect(adapter.listActiveUsers()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        downloadedBytes: 4096,
        id: "*A1",
        uploadedBytes: 1024,
        username: "voucher-1"
      })
    ]));
    await expect(adapter.disconnectActiveUser("voucher-1")).resolves.toBeUndefined();
    expect(
      transport.calls
        .filter((call) => call.command === "/ip/hotspot/active/remove")
        .map((call) => call.params?.numbers)
    ).toEqual(["*A1", "*A2"]);
    await expect(adapter.listActiveUsers()).resolves.toEqual([
      expect.objectContaining({ id: "*A3", username: "autre-voucher" })
    ]);
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
    expect(addParams).toMatchObject({
      "add-mac-cookie": "yes",
      "mac-cookie-timeout": "3d",
      "rate-limit": "2M/5M"
    });
    expect(String(addParams?.["on-login"])).toContain('"durationMinutes":60');
    expect(String(addParams?.["on-login"])).toContain('"validityMinutes":180');
    expect(addParams).not.toHaveProperty("session-timeout");
    expect(addParams).not.toHaveProperty("comment");
    expect(addParams).not.toHaveProperty("disabled");
    expect(updateParams).toMatchObject({
      numbers: "*P1",
      "rate-limit": "2M/5M"
    });
    expect(updateParams).not.toHaveProperty("session-timeout");
    expect(updateParams).not.toHaveProperty("mac-cookie-timeout");
    expect(updateParams).not.toHaveProperty("comment");
    expect(updateParams).not.toHaveProperty("disabled");
  });

  it("supprime uniquement un profil sans utilisateur et confirme sa disparition", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [],
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P1",
        name: "forfait-vide",
        "session-timeout": "1h",
        "shared-users": "1"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.deleteHotspotPlan("forfait-vide")).resolves.toBeUndefined();
    expect(
      transport.calls.find((call) => call.command === "/ip/hotspot/user/profile/remove")?.params
    ).toEqual({ numbers: "*P1" });
    await expect(adapter.getHotspotPlans()).resolves.toEqual([]);
  });

  it("refuse de supprimer un profil encore utilisé par un voucher RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{ ".id": "*U1", name: "123456", profile: "forfait-actif" }],
      "/ip/hotspot/user/profile/print": [{
        ".id": "*P1",
        name: "forfait-actif",
        "session-timeout": "1h",
        "shared-users": "1"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.deleteHotspotPlan("forfait-actif")).rejects.toMatchObject({
      code: "router_rejected"
    });
    expect(
      transport.calls.some((call) => call.command === "/ip/hotspot/user/profile/remove")
    ).toBe(false);
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

  it("supprime la session, les cookies et le compte Hotspot puis vérifie leur absence", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [
        { ".id": "*A1", address: "192.168.88.20", "mac-address": "AA:BB:CC:DD:EE:01", user: "voucher-1" },
        { ".id": "*A2", user: "autre-voucher" }
      ],
      "/ip/hotspot/cookie/print": [
        { ".id": "*C1", "mac-address": "AA:BB:CC:DD:EE:01", user: "voucher-1" },
        { ".id": "*C2", user: "autre-voucher" }
      ],
      "/ip/hotspot/host/print": [
        { ".id": "*H1", address: "192.168.88.20", "mac-address": "AA:BB:CC:DD:EE:01" },
        { ".id": "*H2", address: "192.168.88.21", "mac-address": "AA:BB:CC:DD:EE:02" }
      ],
      "/ip/hotspot/ip-binding/print": [
        { ".id": "*B1", comment: "TicketPro voucher:voucher-1", type: "bypassed" },
        { ".id": "*B2", comment: "TicketPro infrastructure:antenna-1", type: "bypassed" }
      ],
      "/ip/firewall/connection/print": [
        { ".id": "*F1", "src-address": "192.168.88.20:52100", "dst-address": "1.1.1.1:443" },
        { ".id": "*F2", "src-address": "192.168.88.21:52100", "dst-address": "1.1.1.1:443" }
      ],
      "/ip/hotspot/user/print": [
        { ".id": "*U1", name: "voucher-1", profile: "plan-1h" },
        { ".id": "*U2", name: "autre-voucher", profile: "plan-1h" }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.removeHotspotUser("voucher-1")).resolves.toBeUndefined();

    const removalCalls = transport.calls
      .filter((call) => call.command.endsWith("/remove"))
      .map((call) => ({ command: call.command, numbers: call.params?.numbers }));
    expect(removalCalls).toEqual([
      { command: "/ip/hotspot/active/remove", numbers: "*A1" },
      { command: "/ip/hotspot/cookie/remove", numbers: "*C1" },
      { command: "/ip/hotspot/host/remove", numbers: "*H1" },
      { command: "/ip/hotspot/ip-binding/remove", numbers: "*B1" },
      { command: "/ip/firewall/connection/remove", numbers: "*F1" },
      { command: "/ip/hotspot/user/remove", numbers: "*U1" }
    ]);
    expect(await adapter.listHotspotUsers()).toEqual([
      expect.objectContaining({ username: "autre-voucher" })
    ]);
    expect(await adapter.listActiveUsers()).toEqual([
      expect.objectContaining({ username: "autre-voucher" })
    ]);
  });

  it("inventorie les vouchers TicketPro et leurs bindings orphelins sans inclure les comptes manuels", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/ip-binding/print": [
        { ".id": "*B1", comment: "TicketPro voucher:managed-binding", type: "bypassed" },
        { ".id": "*B2", comment: "TicketPro ticket:legacy-binding", type: "bypassed" },
        { ".id": "*B3", comment: "Administration manuelle", type: "bypassed" }
      ],
      "/ip/hotspot/user/print": [
        { ".id": "*U1", comment: "TicketPro:v1;batch=batch-1;state=new;", name: "managed-user" },
        { ".id": "*U2", comment: "Créé dans WinBox", name: "manual-user" }
      ]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.listTicketProManagedVoucherUsernames()).resolves.toEqual([
      "managed-user",
      "managed-binding",
      "legacy-binding"
    ]);
  });

  it("supprime un lot avec un seul inventaire RouterOS avant et apres les mutations", async () => {
    const usernames = Array.from({ length: 100 }, (_, index) => `voucher-${index + 1}`);
    const allUsernames = [...usernames, "voucher-orphelin"];
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [],
      "/ip/hotspot/cookie/print": [],
      "/ip/hotspot/host/print": [],
      "/ip/hotspot/ip-binding/print": [],
      "/ip/firewall/connection/print": [],
      "/ip/hotspot/user/print": allUsernames.map((username, index) => ({
        ".id": `*U${index + 1}`,
        comment: username === "voucher-orphelin"
          ? "TicketPro:v1;validity=180;expires=0;state=new;batch=batch-yesterday;"
          : "",
        name: username,
        profile: "plan-1h"
      }))
    });
    const adapter = createAdapter(transport);
    const progress: Array<{ completed: number; phase: "removing" | "verifying"; total: number }> = [];

    const result = await adapter.removeHotspotUsersBatch(
      usernames,
      "batch-yesterday",
      (value) => progress.push(value)
    );

    expect(result).toHaveLength(101);
    expect(result.every((item) => item.status === "removed")).toBe(true);
    expect(progress[0]).toEqual({ completed: 0, phase: "removing", total: 101 });
    expect(progress[progress.length - 1]).toEqual({ completed: 101, phase: "verifying", total: 101 });

    for (const command of [
      "/ip/hotspot/user/print",
      "/ip/hotspot/active/print",
      "/ip/hotspot/cookie/print",
      "/ip/hotspot/host/print",
      "/ip/hotspot/ip-binding/print",
      "/ip/firewall/connection/print"
    ]) {
      expect(transport.calls.filter((call) => call.command === command)).toHaveLength(2);
    }
    expect(transport.calls.filter((call) => call.command === "/ip/hotspot/user/remove")).toHaveLength(101);
  });

  it("refuse la suppression définitive si un bypass externe autorise encore l'appareil", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/active/print": [{
        ".id": "*A1",
        address: "192.168.88.20",
        "mac-address": "AA:BB:CC:DD:EE:01",
        user: "voucher-1"
      }],
      "/ip/hotspot/cookie/print": [],
      "/ip/hotspot/host/print": [],
      "/ip/hotspot/ip-binding/print": [{
        ".id": "*B-EXTERNAL",
        comment: "Bypass manuel externe",
        "mac-address": "AA:BB:CC:DD:EE:01",
        type: "bypassed"
      }],
      "/ip/firewall/connection/print": [],
      "/ip/hotspot/user/print": [{
        ".id": "*U1",
        "mac-address": "AA:BB:CC:DD:EE:01",
        name: "voucher-1",
        profile: "plan-1h"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.removeHotspotUser("voucher-1")).rejects.toMatchObject({
      code: "router_rejected"
    });
    expect(transport.calls).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "/ip/hotspot/ip-binding/remove" }),
      expect.objectContaining({ command: "/ip/hotspot/user/remove" })
    ]));
  });

  it("interdit de réactiver un voucher épuisé", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/print": [{
        ".id": "*U1",
        comment: "TicketPro:v1;validity=180;expires=123;state=exhausted;",
        disabled: "true",
        name: "voucher-1",
        profile: "plan-1h"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.enableHotspotUser("voucher-1")).rejects.toMatchObject({
      code: "router_rejected"
    });
    expect(transport.calls.some((call) => call.command === "/ip/hotspot/user/enable")).toBe(false);
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
        comment: "TicketPro WireGuard",
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
      comment: "TicketPro managed:wireguard-interface:v1",
      "listen-port": 13231,
      numbers: "*WG1"
    });
    expect(transport.calls.some((call) => call.command === "/interface/wireguard/add")).toBe(false);
    expect(transport.calls.some((call) => call.command === "/ip/address/add")).toBe(false);
    expect(transport.calls.some((call) => call.command === "/interface/wireguard/peers/add")).toBe(false);
  });

  it("réconcilie les doublons WireGuard TicketPro vers une seule configuration active", async () => {
    const transport = new MockRouterOsTransport({
      "/interface/wireguard/print": [{ ".id": "*WG1", name: "ticketpro-vpn" }],
      "/ip/address/print": [
        { ".id": "*OLDADDR", address: "10.250.0.99/32", interface: "ticketpro-vpn" },
        { ".id": "*ADDR", address: "10.250.0.2/32", interface: "ticketpro-vpn" }
      ],
      "/interface/wireguard/peers/print": [
        { ".id": "*OLDPEER", interface: "ticketpro-vpn", "public-key": "old-server" },
        { ".id": "*PEER", interface: "ticketpro-vpn", "public-key": "server-public" }
      ],
      "/ip/route/print": [
        { ".id": "*OLDROUTE", comment: "TicketPro WireGuard", "dst-address": "10.250.0.0/24", gateway: "ticketpro-vpn" },
        { ".id": "*ROUTE", comment: "TicketPro WireGuard multi-organisation", "dst-address": "10.250.0.0/16", gateway: "ticketpro-vpn" }
      ],
      "/ip/firewall/filter/print": [
        { ".id": "*FW1", comment: "TicketPro WireGuard" },
        { ".id": "*FW2", comment: "TicketPro WireGuard" }
      ]
    });

    await createAdapter(transport).provisionWireGuard({
      assignedAddress: "10.250.0.2/32",
      interfaceName: "ticketpro-vpn",
      serverAllowedIps: "10.250.0.0/16",
      serverEndpoint: "vpn.ticketpro-ne.com",
      serverPort: 51820,
      serverPublicKey: "server-public"
    });

    expect(transport.calls.find((call) => call.command === "/ip/address/set")?.params)
      .toMatchObject({ numbers: "*ADDR", address: "10.250.0.2/32" });
    expect(transport.calls.find((call) => call.command === "/ip/address/remove")?.params)
      .toEqual({ numbers: "*OLDADDR" });
    expect(transport.calls.find((call) => call.command === "/interface/wireguard/peers/set")?.params)
      .toMatchObject({ numbers: "*PEER", "allowed-address": "10.250.0.0/16" });
    expect(transport.calls.find((call) => call.command === "/interface/wireguard/peers/remove")?.params)
      .toEqual({ numbers: "*OLDPEER" });
    expect(transport.calls.find((call) => call.command === "/ip/route/set")?.params)
      .toMatchObject({ numbers: "*ROUTE", "dst-address": "10.250.0.0/16" });
    expect(transport.calls.find((call) => call.command === "/ip/route/remove")?.params)
      .toEqual({ numbers: "*OLDROUTE" });
    expect(transport.calls.find((call) => call.command === "/ip/firewall/filter/remove")?.params)
      .toEqual({ numbers: "*FW2" });
    expect(JSON.stringify(transport.calls)).not.toContain("private-key");
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
      macAddress: "AA:BB:CC:DD:EE:12"
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

  it("gère idempotemment le blocage et le déblocage IP Binding", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/ip-binding/print": []
    });
    const adapter = createAdapter(transport);
    const binding = {
      address: "192.168.88.120",
      comment: "Téléphone indésirable",
      id: "blocked-1",
      macAddress: ""
    };

    await expect(adapter.upsertHotspotBlockedDevice(binding)).resolves.toEqual({ outcome: "created" });
    await expect(adapter.upsertHotspotBlockedDevice(binding)).resolves.toEqual({ outcome: "already_present" });
    await expect(adapter.listManagedHotspotBlockedDevices()).resolves.toEqual([
      expect.objectContaining({
        address: "192.168.88.120",
        id: "blocked-1",
        macAddress: ""
      })
    ]);
    await expect(adapter.removeHotspotBlockedDevice("blocked-1", "")).resolves.toEqual({ outcome: "removed" });
    await expect(adapter.removeHotspotBlockedDevice("blocked-1", "")).resolves.toEqual({ outcome: "not_found" });
  });

  it("refuse d'écraser un IP Binding créé hors de TicketPro", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/ip-binding/print": [{
        ".id": "*MANUAL",
        address: "192.168.88.120",
        comment: "Règle WinBox",
        type: "bypassed"
      }]
    });
    const adapter = createAdapter(transport);

    await expect(adapter.upsertHotspotBlockedDevice({
      address: "192.168.88.120",
      comment: "Téléphone",
      id: "blocked-1",
      macAddress: ""
    })).rejects.toMatchObject({ code: "duplicate_user" });
    expect(transport.calls.some((call) => call.command.endsWith("/add"))).toBe(false);
    expect(transport.calls.some((call) => call.command.endsWith("/set"))).toBe(false);
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
      "/ip/firewall/mangle/print": [],
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
      transport.calls.find((call) => call.command === "/ip/firewall/filter/remove")?.params
    ).toEqual({ numbers: "*TP63" });
    expect(
      transport.calls.find((call) =>
        call.command === "/ip/firewall/mangle/add"
      )?.params
    ).toMatchObject({
      action: "change-ttl",
      chain: "postrouting",
      comment: "TicketPro anti-tethering:IPv4 client TTL ether1",
      hotspot: "to-client",
      "new-ttl": "set:1",
      "out-interface": "ether1",
      passthrough: "no"
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
    ).toHaveLength(0);
  });

  it("lit l'état réel des protections et des bypass TicketPro", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/firewall/filter/print": [],
      "/ip/firewall/mangle/print": [{
        ".id": "*TP4",
        comment: "TicketPro anti-tethering:IPv4 client TTL ether1",
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

  it("ne change pas la limite d'appareils des profils Hotspot", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/print": [{
        ".id": "*HS1",
        disabled: "false",
        interface: "ether1",
        name: "ticketpro-hotspot"
      }],
      "/ip/firewall/filter/print": [],
      "/ip/firewall/mangle/print": [],
      "/ipv6/firewall/filter/print": [],
      "/ip/hotspot/user/profile/print": [
        { ".id": "*P1", name: "famille", "shared-users": "5" }
      ]
    });
    const adapter = createAdapter(transport);

    await adapter.configureHotspotAntiTethering({
      blockIpv4Ttl: true,
      blockIpv6: false,
      enabled: true
    });

    expect(
      transport.calls.some((call) =>
        call.command === "/ip/hotspot/user/profile/print"
        || call.command === "/ip/hotspot/user/profile/set"
      )
    ).toBe(false);
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
      "/ip/firewall/mangle/print": [{
        ".id": "*TP4",
        chain: "postrouting",
        comment: "TicketPro anti-tethering:IPv4 client TTL ether1"
      }],
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
    ).toEqual(["*TP63", "*TP4", "*TPV6"]);
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

describe("MikroTikRouterAdapter.updateHotspotPlan — confirmation RouterOS", () => {
  const draft = { dataLimitMb: null, downloadLimit: null, uploadLimit: null, durationMinutes: 240, validityMinutes: 240, name: "6H", profileName: "6H", sharedUsers: 1, priceHint: null };

  it("confirme un renommage de profil relu sur RouterOS", async () => {
    const transport = new MockRouterOsTransport({
      "/ip/hotspot/user/profile/print": [{ ".id": "*P1", name: "4H", "session-timeout": "4h" }]
    });
    await expect(createAdapter(transport).updateHotspotPlan("4H", draft)).resolves.toMatchObject({ id: "*P1", profileName: "6H" });
  });

  it("refuse de confirmer une modification que RouterOS n'a pas conservée", async () => {
    class IgnoringRenameTransport extends MockRouterOsTransport {
      async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
        if (request.command === "/ip/hotspot/user/profile/set") {
          const params = { ...request.params };
          delete params.name;
          return super.call({ ...request, params });
        }
        return super.call(request);
      }
    }
    const transport = new IgnoringRenameTransport({
      "/ip/hotspot/user/profile/print": [{ ".id": "*P1", name: "4H", "session-timeout": "4h" }]
    });
    await expect(createAdapter(transport).updateHotspotPlan("4H", draft)).rejects.toThrow("RouterOS n'a pas confirmé la modification du profil.");
  });
});
