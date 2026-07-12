import { describe, expect, it } from "vitest";
import { RouterAdapterError } from "./RouterAdapterError";
import { PreparedRemoteConnectionProvider } from "./RemoteConnectionProvider";

describe("PreparedRemoteConnectionProvider", () => {
  it("prepare un endpoint distant sans cloud", async () => {
    const provider = new PreparedRemoteConnectionProvider();

    await expect(
      provider.resolveEndpoint({
        localHost: "192.168.88.1",
        mode: "distant_ip",
        port: 8729,
        remoteHost: "vpn.example.local",
        routerId: "router-demo",
        useSsl: true
      })
    ).resolves.toMatchObject({
      host: "vpn.example.local",
      mode: "distant_ip",
      port: 8729,
      useSsl: true
    });
  });

  it("bloque l'agent futur tant que le cloud n'est pas implemente", async () => {
    const provider = new PreparedRemoteConnectionProvider();

    await expect(
      provider.resolveEndpoint({
        localHost: "192.168.88.1",
        mode: "agent_future",
        port: 8729,
        remoteHost: "",
        routerId: "router-demo",
        useSsl: true
      })
    ).rejects.toMatchObject({ code: "remote_unavailable" } satisfies Partial<RouterAdapterError>);
  });
});
