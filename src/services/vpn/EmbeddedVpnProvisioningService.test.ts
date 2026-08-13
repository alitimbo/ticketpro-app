import { describe, expect, it, vi } from "vitest";
import {
  EmbeddedVpnProvisioningService,
  type EmbeddedVpnProvisioningDependencies
} from "./EmbeddedVpnProvisioningService";

function dependencies(overrides: Partial<EmbeddedVpnProvisioningDependencies> = {}): EmbeddedVpnProvisioningDependencies {
  return {
    applyConfig: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ensureIdentity: vi.fn().mockResolvedValue({
      installationId: "11111111-2222-4333-8444-555555555555",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      keyVersion: 1
    }),
    getMetadata: vi.fn().mockResolvedValue({
      identifier: "solutions.akicorp.ticketpro",
      name: "TicketPro",
      version: "0.2.3"
    }),
    getStatus: vi.fn()
      .mockResolvedValueOnce({
        provider: "EMBEDDED",
        state: "DISCONNECTED",
        serviceName: "TicketProVpnService",
        serviceVersion: "0.1.0",
        detailCode: null,
        lastHandshakeUnixSeconds: null,
        rxBytes: 0,
        txBytes: 0
      })
      .mockResolvedValue({
        provider: "EMBEDDED",
        state: "CONNECTED",
        serviceName: "TicketProVpnService",
        serviceVersion: "0.1.0",
        detailCode: null,
        lastHandshakeUnixSeconds: 1,
        rxBytes: 1,
        txBytes: 1
      }),
    heartbeat: vi.fn().mockResolvedValue({ ok: true, device_id: "device-1", status: "active", vpn_access: true }),
    registerDevice: vi.fn().mockResolvedValue({
      active_device_count: 1,
      device_limit_mode: "limited",
      device: {
        id: "device-1",
        installation_id: "11111111-2222-4333-8444-555555555555",
        name: "PC test",
        platform: "windows",
        os_version: "Windows",
        app_version: "0.2.3",
        status: "active",
        is_current: false,
        vpn: {
          gateway_id: "gateway-main",
          assigned_address: "10.250.1.2/32",
          key_version: 1,
          config_version: 1,
          desired_state: "enabled",
          applied_state: "enabled",
          last_handshake_at: null,
          last_error_code: null
        },
        last_seen_at: null,
        created_at: "2026-08-10T00:00:00.000Z",
        revoked_at: null
      },
      max_devices: 2,
      vpn: {
        address: "10.250.1.2/32",
        allowed_ips: ["10.250.0.0/16"],
        config_version: 1,
        endpoint: "vpn.ticketpro-ne.com",
        gateway_id: "gateway-main",
        gateway_public_key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        persistent_keepalive: 25,
        port: 51820
      }
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("EmbeddedVpnProvisioningService", () => {
  it("enregistre seulement l'identite publique puis applique une configuration split tunnel", async () => {
    const mocks = dependencies();
    const result = await new EmbeddedVpnProvisioningService(mocks).ensureConnected("PC Bureau");

    expect(result.state).toBe("CONNECTED");
    expect(mocks.registerDevice).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "11111111-2222-4333-8444-555555555555",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      name: "PC Bureau"
    }));
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      configVersion: 1,
      address: "10.250.1.2/32",
      gatewayPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      endpointHost: "vpn.ticketpro-ne.com",
      endpointPort: 51820,
      allowedIps: ["10.250.0.0/16"],
      persistentKeepalive: 25
    });
    expect(JSON.stringify(vi.mocked(mocks.registerDevice).mock.calls)).not.toContain("privateKey");
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.heartbeat).toHaveBeenCalledOnce();
  });

  it("laisse le provider historique intact tant que le mode embarque n'est pas active", async () => {
    const mocks = dependencies({
      getStatus: vi.fn().mockResolvedValue({
        provider: "LEGACY",
        state: "CONNECTED",
        serviceName: "WireGuardTunnel$tp-*",
        serviceVersion: null,
        detailCode: null,
        lastHandshakeUnixSeconds: null,
        rxBytes: 0,
        txBytes: 0
      })
    });
    const result = await new EmbeddedVpnProvisioningService(mocks).ensureConnected();

    expect(result.state).toBe("SKIPPED");
    expect(mocks.ensureIdentity).not.toHaveBeenCalled();
    expect(mocks.registerDevice).not.toHaveBeenCalled();
    expect(mocks.applyConfig).not.toHaveBeenCalled();
  });

  it("sérialise les provisionnements pour empêcher deux configurations concurrentes", async () => {
    const firstGate = { release: () => undefined as void };
    let markFirstStarted: (() => void) | null = null;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      firstGate.release = resolve;
    });
    const legacyStatus = {
      provider: "LEGACY" as const,
      state: "CONNECTED" as const,
      serviceName: "WireGuardTunnel$tp-*",
      serviceVersion: null,
      detailCode: null,
      lastHandshakeUnixSeconds: null,
      rxBytes: 0,
      txBytes: 0
    };
    const first = dependencies({
      getStatus: vi.fn().mockImplementation(async () => {
        markFirstStarted?.();
        await firstBlocked;
        return legacyStatus;
      })
    });
    const second = dependencies({
      getStatus: vi.fn().mockResolvedValue(legacyStatus)
    });

    const firstRun = new EmbeddedVpnProvisioningService(first).ensureConnected();
    await firstStarted;
    const secondRun = new EmbeddedVpnProvisioningService(second).ensureConnected();
    await Promise.resolve();

    expect(second.getStatus).not.toHaveBeenCalled();
    firstGate.release();
    await Promise.all([firstRun, secondRun]);
    expect(second.getStatus).toHaveBeenCalledOnce();
  });
});
