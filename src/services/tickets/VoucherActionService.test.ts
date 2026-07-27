import { describe, expect, it, vi } from "vitest";
import { VoucherActionService } from "./VoucherActionService";

describe("VoucherActionService", () => {
  it("désactive le voucher puis déconnecte sa session active", async () => {
    const events: string[] = [];
    const disableHotspotUser = vi.fn(async () => {
      events.push("disable");
      return {} as never;
    });
    const listActiveUsers = vi.fn(async () => {
      events.push("list-active");
      return [{ username: "123456" }] as never;
    });
    const disconnectActiveUser = vi.fn(async () => {
      events.push("disconnect");
    });
    const removeHotspotUser = vi.fn(async () => undefined);
    const service = new VoucherActionService({
      disableHotspotUser,
      disconnectActiveUser,
      listActiveUsers,
      removeHotspotUser
    } as never);

    await expect(service.disable("123456")).resolves.toEqual({ disconnected: true });
    expect(events).toEqual(["disable", "list-active", "disconnect"]);
    expect(disconnectActiveUser).toHaveBeenCalledWith("123456");
  });

  it("ne demande pas de déconnexion si aucune session n'est active", async () => {
    const disconnectActiveUser = vi.fn(async () => undefined);
    const service = new VoucherActionService({
      disableHotspotUser: vi.fn(async () => ({} as never)),
      disconnectActiveUser,
      listActiveUsers: vi.fn(async () => []),
      removeHotspotUser: vi.fn(async () => undefined)
    } as never);

    await expect(service.disable("654321")).resolves.toEqual({ disconnected: false });
    expect(disconnectActiveUser).not.toHaveBeenCalled();
  });

  it("supprime le voucher sur RouterOS", async () => {
    const removeHotspotUser = vi.fn(async () => undefined);
    const service = new VoucherActionService({
      disableHotspotUser: vi.fn(async () => ({} as never)),
      disconnectActiveUser: vi.fn(async () => undefined),
      listActiveUsers: vi.fn(async () => []),
      removeHotspotUser
    } as never);

    await service.remove("999999");
    expect(removeHotspotUser).toHaveBeenCalledWith("999999");
  });
});
