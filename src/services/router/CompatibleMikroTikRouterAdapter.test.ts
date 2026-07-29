import { describe, expect, it } from "vitest";
import { CompatibleMikroTikRouterAdapter } from "./CompatibleMikroTikRouterAdapter";
import type { RouterOsApiRequest, RouterOsApiRow, RouterOsApiTransport } from "./RouterOsApiTransport";

class ChrTransport implements RouterOsApiTransport {
  readonly commands: string[] = [];

  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.commands.push(request.command);

    if (request.command === "/system/resource/print") {
      return [
        {
          "architecture-name": "x86_64",
          "board-name": "CHR Microsoft Corporation Virtual Machine",
          platform: "MikroTik",
          uptime: "37m50s",
          version: "7.21.5 (long-term)"
        }
      ];
    }

    if (request.command === "/system/routerboard/print") {
      throw new Error("no such command prefix");
    }

    return [];
  }
}

describe("CompatibleMikroTikRouterAdapter", () => {
  it("valide un CHR même si RouterBOARD n'est pas disponible", async () => {
    const transport = new ChrTransport();
    const adapter = new CompatibleMikroTikRouterAdapter({
      host: "192.168.88.1",
      password: "secret",
      port: 8728,
      transport,
      username: "admin"
    });

    await expect(adapter.getSystemInfo()).resolves.toEqual({
      architecture: "x86_64",
      boardName: "CHR Microsoft Corporation Virtual Machine",
      identity: "MikroTik",
      model: "CHR Microsoft Corporation Virtual Machine",
      routerOsVersion: "7.21.5 (long-term)",
      serialNumber: "non disponible",
      uptime: "37m50s"
    });

    expect(transport.commands).toEqual([
      "/system/resource/print",
      "/system/routerboard/print"
    ]);
  });
});
