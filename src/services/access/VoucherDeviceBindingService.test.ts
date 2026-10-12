import { describe, expect, it, vi } from "vitest";
import type { TicketRecord } from "../../domain/database";
import type { HotspotUser } from "../../domain/router";
import type { TicketRepository } from "../database/repositories";
import type { RouterService } from "../router";
import { VoucherDeviceBindingService } from "./VoucherDeviceBindingService";

describe("VoucherDeviceBindingService", () => {
  const session = (username: string, macAddress: string) => ({
    downloadedBytes: 0,
    id: `*A-${username}`,
    ipAddress: "192.168.88.101",
    macAddress,
    sessionTimeLeft: "1h",
    uploadedBytes: 0,
    uptime: "1m",
    username
  });

  it("ne compte pas comme nouveau un voucher que RouterOS a déjà verrouillé à la connexion", async () => {
    const ticket = createTicket();
    const update = vi.fn(async (input) => ({ ...ticket, ...input }));
    const bindHotspotUserToMac = vi.fn();
    const service = new VoucherDeviceBindingService({ update } as unknown as TicketRepository);

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [session("123456", "AA:BB:CC:DD:EE:01")],
      hotspotUsers: [{ ...createHotspotUser(), macAddress: "AA:BB:CC:DD:EE:01" }],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: [ticket]
    });

    expect(bindHotspotUserToMac).not.toHaveBeenCalled();
    expect(result.boundUsernames).toEqual([]);
    // The local copy still records the MAC read on RouterOS.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ mac_address: "AA:BB:CC:DD:EE:01" }));
  });

  it("verrouille sur RouterOS un voucher TicketPro absent de la base de ce poste, et ignore les autres comptes hotspot", async () => {
    const update = vi.fn();
    const bindHotspotUserToMac = vi.fn(async (username: string, macAddress: string) => ({
      ...createHotspotUser(), comment: "TicketPro:v1;validity=60;expires=0;state=active;", macAddress, username
    }));
    const service = new VoucherDeviceBindingService({ update } as unknown as TicketRepository);

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [session("777777", "AA:BB:CC:DD:EE:07"), session("admin", "AA:BB:CC:DD:EE:08")],
      hotspotUsers: [
        { ...createHotspotUser(), comment: "TicketPro:v1;validity=60;expires=0;state=active;", username: "777777" },
        { ...createHotspotUser(), comment: null, username: "admin" }
      ],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: []
    });

    expect(bindHotspotUserToMac).toHaveBeenCalledTimes(1);
    expect(bindHotspotUserToMac).toHaveBeenCalledWith("777777", "AA:BB:CC:DD:EE:07");
    expect(result.boundUsernames).toEqual(["777777"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("ne compte pas un verrou que RouterOS n'a pas conservé", async () => {
    const ticket = createTicket();
    const update = vi.fn();
    const bindHotspotUserToMac = vi.fn(async () => createHotspotUser());
    const service = new VoucherDeviceBindingService({ update } as unknown as TicketRepository);

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [{
        downloadedBytes: 0,
        id: "*A1",
        ipAddress: "192.168.88.101",
        macAddress: "AA:BB:CC:DD:EE:01",
        sessionTimeLeft: "1h",
        uploadedBytes: 0,
        uptime: "1m",
        username: "123456"
      }],
      hotspotUsers: [createHotspotUser()],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: [ticket]
    });

    expect(result.boundUsernames).toEqual([]);
    expect(result.verifiedUsers).toEqual([]);
    expect(result.errors).toEqual([{ message: "RouterOS n'a pas conservé l'adresse MAC du voucher.", username: "123456" }]);
    expect(update).not.toHaveBeenCalled();
  });

  it("verrouille un voucher sur la MAC de sa première session", async () => {
    const ticket = createTicket();
    const update = vi.fn(async (input) => ({ ...ticket, ...input }));
    const bindHotspotUserToMac = vi.fn(async (_username: string, macAddress: string) => ({ ...createHotspotUser(), macAddress }));
    const service = new VoucherDeviceBindingService({
      update
    } as unknown as TicketRepository);

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [{
        downloadedBytes: 0,
        id: "*A1",
        ipAddress: "192.168.88.101",
        macAddress: "aa-bb-cc-dd-ee-01",
        sessionTimeLeft: "1h",
        uploadedBytes: 0,
        uptime: "1m",
        username: "123456"
      }],
      hotspotUsers: [createHotspotUser()],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: [ticket]
    });

    expect(bindHotspotUserToMac).toHaveBeenCalledWith(
      "123456",
      "AA:BB:CC:DD:EE:01"
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ip_address: "192.168.88.101",
      mac_address: "AA:BB:CC:DD:EE:01",
      status: "activé",
      sync_status: "synced"
    }));
    expect(result.boundUsernames).toEqual(["123456"]);
    expect(result.conflicts).toEqual([]);
  });

  it("signale un autre appareil sans déplacer le verrou existant", async () => {
    const ticket = {
      ...createTicket(),
      mac_address: "AA:BB:CC:DD:EE:01"
    };
    const update = vi.fn();
    const bindHotspotUserToMac = vi.fn();
    const service = new VoucherDeviceBindingService({
      update
    } as unknown as TicketRepository);

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [{
        downloadedBytes: 0,
        id: "*A2",
        ipAddress: "192.168.88.102",
        macAddress: "AA:BB:CC:DD:EE:02",
        sessionTimeLeft: "1h",
        uploadedBytes: 0,
        uptime: "1m",
        username: "123456"
      }],
      hotspotUsers: [{
        ...createHotspotUser(),
        macAddress: "AA:BB:CC:DD:EE:01"
      }],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: [ticket]
    });

    expect(result.conflicts).toEqual([{
      expectedMacAddress: "AA:BB:CC:DD:EE:01",
      observedMacAddress: "AA:BB:CC:DD:EE:02",
      username: "123456"
    }]);
    expect(bindHotspotUserToMac).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("ne déplace pas le verrou si deux sessions du même voucher sont observées ensemble", async () => {
    const ticket = createTicket();
    const update = vi.fn(async (input) => ({ ...ticket, ...input }));
    const bindHotspotUserToMac = vi.fn(async (_username: string, macAddress: string) => ({ ...createHotspotUser(), macAddress }));
    const service = new VoucherDeviceBindingService({
      update
    } as unknown as TicketRepository);
    const activeBase = {
      downloadedBytes: 0,
      ipAddress: "192.168.88.101",
      sessionTimeLeft: "1h",
      uploadedBytes: 0,
      uptime: "1m",
      username: "123456"
    };

    const result = await service.synchronize({
      accountId: "account-1",
      activeUsers: [
        {
          ...activeBase,
          id: "*A1",
          macAddress: "AA:BB:CC:DD:EE:01"
        },
        {
          ...activeBase,
          id: "*A2",
          ipAddress: "192.168.88.102",
          macAddress: "AA:BB:CC:DD:EE:02"
        }
      ],
      hotspotUsers: [createHotspotUser()],
      routerId: "router-1",
      routerService: { bindHotspotUserToMac } as unknown as RouterService,
      tickets: [ticket]
    });

    expect(bindHotspotUserToMac).toHaveBeenCalledTimes(1);
    expect(bindHotspotUserToMac).toHaveBeenCalledWith(
      "123456",
      "AA:BB:CC:DD:EE:01"
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.observedMacAddress).toBe("AA:BB:CC:DD:EE:02");
  });
});

function createTicket(): TicketRecord {
  return {
    account_id: "account-1",
    activated_at: null,
    batch_id: "batch-1",
    completed_at: null,
    created_at: "2026-07-29T00:00:00.000Z",
    created_by_profile: "admin",
    created_by_profile_id: "account-1:internal-profile-admin",
    deleted_at: null,
    downloaded_bytes: 0,
    expires_at: null,
    id: "ticket-1",
    ip_address: null,
    mac_address: null,
    mikrotik_id: "*U1",
    password_encrypted: "protected",
    plan_id: "plan-1",
    printed_count: 0,
    router_id: "router-1",
    status: "disponible",
    sync_status: "synced",
    updated_at: "2026-07-29T00:00:00.000Z",
    uploaded_bytes: 0,
    username: "123456"
  };
}

function createHotspotUser(): HotspotUser {
  return {
    comment: null,
    createdAt: "",
    id: "*U1",
    macAddress: null,
    passwordSecretRef: "",
    planId: "plan-1",
    profileName: "plan-1",
    status: "active",
    username: "123456"
  };
}
