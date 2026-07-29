import { describe, expect, it } from "vitest";
import { buildWireGuardTunnelName } from "./WireGuardWindowsService";

describe("WireGuard Windows tunnel names", () => {
  it("produit un nom stable accepté par WireGuard Windows", () => {
    const peerId = "vpn-peer-12345678-1234-1234-1234-123456789abc";
    const name = buildWireGuardTunnelName(peerId);

    expect(name).toBe(buildWireGuardTunnelName(peerId));
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^[a-zA-Z0-9_=+.-]{1,32}$/);
  });

  it("normalise les caractères interdits sans produire de nom vide", () => {
    expect(buildWireGuardTunnelName("PC Ali / Test 2")).toMatch(/^tp-[a-zA-Z0-9_=+.-]+$/);
    expect(buildWireGuardTunnelName("")).toBe("tp-tunnel");
  });
});
