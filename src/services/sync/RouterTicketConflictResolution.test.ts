import { describe, expect, it, vi } from "vitest";
import { RouterTicketSyncService } from "./RouterTicketSyncService";

describe("résolution des conflits de tickets", () => {
  it("réaligne le profil MikroTik sur le profil local", async () => {
    const users = [
      {
        comment: null,
        createdAt: "2026-07-13T10:00:00.000Z",
        id: "*1",
        passwordSecretRef: "secret://router/ABC123/password",
        planId: "*remote-plan",
        profileName: "remote-profile",
        status: "available" as const,
        username: "ABC123"
      }
    ];
    const updateHotspotUser = vi.fn(async () => {
      users[0].profileName = "local-profile";
      users[0].planId = "*local-plan";
      return users[0];
    });
    const service = new RouterTicketSyncService({
      createHotspotUser: vi.fn(),
      listActiveUsers: async () => [],
      listHotspotUsers: async () => users,
      updateHotspotUser
    });

    const report = await service.resolveConflict({
      activatedAt: null,
      batchId: "batch-1",
      code: "ABC123",
      id: "ticket-1",
      ipAddress: null,
      macAddress: null,
      mikrotikId: "*1",
      passwordSecretRef: "secret://router/ABC123/password",
      planId: "local-plan",
      planProfileName: "local-profile",
      routerId: "router-1",
      status: "disponible",
      syncStatus: "conflict"
    });

    expect(updateHotspotUser).toHaveBeenCalledWith("ABC123", "local-profile");
    expect(report.updates[0]?.syncStatus).toBe("router_synced");
  });
});
