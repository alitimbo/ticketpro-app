import { describe, expect, it } from "vitest";
import {
  allocateWireGuardAddress,
  buildOperatorWireGuardConfig,
  buildRouterOsWireGuardScript,
  generateWireGuardKeyPair
} from "./wireguard";

describe("wireguard provisioning", () => {
  it("génère deux clés base64 de 32 octets", () => {
    const pair = generateWireGuardKeyPair();

    expect(atob(pair.privateKey)).toHaveLength(32);
    expect(atob(pair.publicKey)).toHaveLength(32);
    expect(pair.privateKey).not.toBe(pair.publicKey);
  });

  it("alloue une adresse libre sans réutiliser celles déjà attribuées", () => {
    expect(allocateWireGuardAddress("10.250.0.0/30", ["10.250.0.1/30"])).toBe("10.250.0.2/30");
    expect(() => allocateWireGuardAddress("10.250.0.0/30", ["10.250.0.1/30", "10.250.0.2/30"])).toThrow("plus d'adresse");
  });

  it("produit les deux formats de configuration attendus", () => {
    const script = buildRouterOsWireGuardScript({
      assignedAddress: "10.250.0.2/24",
      interfaceName: "ticketpro-vpn",
      privateKey: "router-private",
      serverAllowedIps: "10.250.0.0/24",
      serverEndpoint: "vpn.example.com",
      serverPort: 51820,
      serverPublicKey: "server-public"
    });
    const config = buildOperatorWireGuardConfig({
      address: "10.250.0.3/24",
      allowedIps: "10.250.0.0/24",
      endpoint: "vpn.example.com:51820",
      privateKey: "operator-private",
      publicKey: "server-public"
    });

    expect(script).toContain("/interface/wireguard/add");
    expect(script).toContain("persistent-keepalive=25");
    expect(config).toContain("[Interface]");
    expect(config).toContain("AllowedIPs = 10.250.0.0/24");
  });
});
