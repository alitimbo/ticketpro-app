// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "../../services/database";
import { TicketRepository } from "../../services/database";
import { restoreRouterObservation, ticketRouterBadge, createDemoTickets } from "./ticketsPageModel";
import { ticketCloudQueueStates } from "./useTicketCloudQueue";

describe("independent router evidence", () => {
  it("migrates without inventing evidence and persists missing across reload/cloud updates", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE tickets (id TEXT PRIMARY KEY, account_id TEXT, router_id TEXT, sync_status TEXT, last_router_sync_at TEXT)");
      db.exec("INSERT INTO tickets VALUES ('t','a','r','synced',NULL)");
      db.exec(readFileSync("src-tauri/migrations/031_ticket_router_observation.sql", "utf8"));
      const adapter = {
        query: async (sql: string, params: string[] = []) => db.prepare(sql).all(Object.fromEntries(params.map((value, i) => [`?${i + 1}`, value]))),
        transaction: async (statements: { sql: string; params: string[] }[]) => {
          db.exec("BEGIN");
          try { for (const statement of statements) db.prepare(statement.sql).run(Object.fromEntries(statement.params.map((value, i) => [`?${i + 1}`, value]))); db.exec("COMMIT"); }
          catch (error) { db.exec("ROLLBACK"); throw error; }
          return statements.map(() => ({ rowsAffected: 1 }));
        }
      } as unknown as DatabaseClient;
      let repository = new TicketRepository(adapter);
      expect(restoreRouterObservation((await repository.findById("t"))!)).toBe("local_only");
      const observation = { id: "t", accountId: "a", routerId: "r", status: "router_missing", observedAt: "2026-09-10T10:00:00Z" };
      await repository.saveRouterObservations([observation]);
      db.exec("UPDATE tickets SET sync_status='synced'");
      repository = new TicketRepository(adapter);
      expect(restoreRouterObservation((await repository.findById("t"))!)).toBe("router_missing");
      await repository.saveRouterObservations([{ ...observation, accountId: "other", status: "router_synced" }]);
      await repository.saveRouterObservations([{ ...observation, routerId: "other", status: "router_synced" }]);
      expect(restoreRouterObservation((await repository.findById("t"))!)).toBe("router_missing");
      db.exec("UPDATE tickets SET last_router_sync_at='2026-09-10T11:00:00Z'");
      expect(restoreRouterObservation((await repository.findById("t"))!)).toBe("local_only");
    } finally { db.close(); }
  });

  it("keeps unknown, present, missing, failure and removal distinct", () => {
    const ticket = createDemoTickets()[0];
    expect(ticketRouterBadge({ ...ticket, syncStatus: "local_only" }).label).toBe("À vérifier sur le routeur");
    expect(ticketRouterBadge({ ...ticket, status: "disponible", syncStatus: "router_synced" }).label).toBe("Présent sur le routeur");
    expect(ticketRouterBadge({ ...ticket, syncStatus: "router_missing" }).label).toBe("Absent du routeur");
    expect(ticketRouterBadge({ ...ticket, status: "supprimé", syncStatus: "error" }).label).not.toBe("Supprimé du routeur");
    expect(ticketRouterBadge({ ...ticket, status: "archivé", routerDeletedAt: "2026-09-10", syncStatus: "router_synced" }).label).toBe("Supprimé du routeur");
  });

  it("derives cloud warnings only from scoped queue entries, never router sync_status", () => {
    const row = { account_id: "a", router_id: "r", operation_type: "cloud.ticket_catalog.publish", aggregate_id: "batch", status: "retry" };
    expect(ticketCloudQueueStates([row], "a", "r").get("batch")).toBe("pending");
    expect(ticketCloudQueueStates([row, { ...row, status: "failed" }], "a", "r").get("batch")).toBe("error");
    expect(ticketCloudQueueStates([{ ...row, status: "succeeded" }], "a", "r").size).toBe(0);
    expect(ticketCloudQueueStates([row], "other", "r").size).toBe(0);
    expect(ticketCloudQueueStates([row], "a", "other").size).toBe(0);
  });
});
