import { useEffect, useState } from "react";
import type { DatabaseClient } from "../../services/database";

type QueueRow = { account_id: string; router_id: string; operation_type: string; aggregate_id: string; status: string };
export type TicketCloudQueueState = "pending" | "error";
export function ticketCloudQueueStates(rows: QueueRow[], accountId: string, routerId: string) {
  const states = new Map<string, TicketCloudQueueState>();
  for (const row of rows) {
    if (row.account_id !== accountId || row.router_id !== routerId || row.operation_type !== "cloud.ticket_catalog.publish") continue;
    if (["failed", "conflict"].includes(row.status)) states.set(row.aggregate_id, "error");
    else if (["pending", "processing", "retry"].includes(row.status) && states.get(row.aggregate_id) !== "error") states.set(row.aggregate_id, "pending");
  }
  return states;
}

export function useTicketCloudQueue(database: DatabaseClient, accountId: string | undefined, routerId: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; routerId: string; states: Map<string, TicketCloudQueueState> } | null>(null);
  useEffect(() => {
    if (!enabled || !accountId) return;
    let disposed = false;
    let running = false;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        // Queue metadata only: never load voucher payloads/passwords for badges.
        const rows = await database.query<QueueRow>(`SELECT account_id, router_id, operation_type, aggregate_id, status
          FROM sync_outbox WHERE account_id = ?1 AND router_id = ?2 AND operation_type = ?3`,
          [accountId, routerId, "cloud.ticket_catalog.publish"]);
        if (!disposed) setSnapshot({ accountId, routerId, states: ticketCloudQueueStates(rows, accountId, routerId) });
      } catch { if (!disposed) setSnapshot(null); }
      finally { running = false; }
    };
    void read();
    const timer = window.setInterval(() => void read(), 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [database, accountId, routerId, enabled]);
  return snapshot?.accountId === accountId && snapshot?.routerId === routerId ? snapshot.states : null;
}
