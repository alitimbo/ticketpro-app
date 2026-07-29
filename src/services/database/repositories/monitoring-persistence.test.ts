import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { ActiveSessionCacheRepository } from "./ActiveSessionCacheRepository";
import { AppLogRepository } from "./AppLogRepository";
import { RouterSnapshotRepository } from "./RouterSnapshotRepository";

describe("monitoring persistence", () => {
  it("remplace le cache des sessions et conserve les snapshots et journaux", async () => {
    const database = new InMemoryDatabaseClient();
    const sessions = new ActiveSessionCacheRepository(database);
    const snapshots = new RouterSnapshotRepository(database);
    const logs = new AppLogRepository(database);

    await sessions.replaceForRouter("router-1", [
      {
        downloadedBytes: 10,
        id: "active-1",
        ipAddress: "192.168.1.10",
        macAddress: "AA:BB:CC:DD:EE:FF",
        sessionTimeLeft: "1h",
        uploadedBytes: 5,
        uptime: "5m",
        username: "ticket-1"
      }
    ], "2026-07-13T10:00:00.000Z");

    expect(await sessions.listByRouter("router-1")).toEqual([
      expect.objectContaining({
        id: "router-1:active-1",
        username: "ticket-1"
      })
    ]);

    await sessions.replaceForRouter("router-1", [], "2026-07-13T10:05:00.000Z");
    expect(await sessions.listByRouter("router-1")).toHaveLength(0);

    await snapshots.create({
      active_clients_count: 2,
      captured_at: "2026-07-13T10:00:00.000Z",
      cpu_load: 12,
      id: "snapshot-1",
      memory_total: 100,
      memory_used: 40,
      plans_count: 3,
      router_id: "router-1",
      tickets_count: 20,
      uptime: "1d"
    });

    await logs.create({
      account_id: "account-1",
      category: "monitoring",
      created_at: "2026-07-13T10:00:00.000Z",
      created_by_profile: "operator",
      id: "log-1",
      internal_profile_id: "account-1:profile-1",
      level: "info",
      router_id: "router-1",
      technical_message: "refreshMonitoring",
      user_message: "Monitoring actualisé"
    });

    expect(await snapshots.listByRouter("router-1")).toHaveLength(1);
    expect(await logs.listByAccount("account-1")).toHaveLength(1);
    expect(await logs.deleteBefore("account-1", "2026-07-14T00:00:00.000Z")).toBe(1);
    expect(await logs.listByAccount("account-1")).toHaveLength(0);
  });
});
