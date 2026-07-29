import { describe, expect, it, vi } from "vitest";
import { TauriRouterOsApiTransport } from "./RouterOsApiTransport";

describe("TauriRouterOsApiTransport", () => {
  it("limite à trois les appels simultanés vers le même routeur", async () => {
    let active = 0;
    let maximumObserved = 0;
    const releases: Array<() => void> = [];
    const invoke = vi.fn(async () => {
      active += 1;
      maximumObserved = Math.max(maximumObserved, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return [];
    });
    const transport = new TauriRouterOsApiTransport(invoke);
    const requests = Array.from({ length: 7 }, (_, index) =>
      transport.call({
        command: `/test/${index}`,
        host: "10.250.0.2",
        password: "secret",
        port: 8728,
        username: "admin"
      })
    );

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    while (releases.length > 0 || invoke.mock.calls.length < requests.length) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(requests);

    expect(maximumObserved).toBe(3);
  });
});
