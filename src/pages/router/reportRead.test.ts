import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../../services/auth";
import type { SaasRouterTicketCatalog, SaasTicketSnapshot } from "../../services/saas";
import { cloudReportTickets, reportRead } from "./reportRead";
import { scopeReportTicketsForSession } from "./reportPageModel";

export function reportCatalog(): SaasRouterTicketCatalog {
  const ticket: SaasTicketSnapshot = {
    id: "ticket-1", batch_id: "batch-1", plan_id: "missing-plan", username: "123456",
    created_by_user_id: "user-1", created_by_name: "Agent", created_by_email: "agent@example.test", created_by_role: "agent",
    created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z",
    activated_at: null, archived_at: null, completed_at: null, expires_at: null, exported_at: null,
    deleted_at: null, data_remaining_bytes: null, downloaded_bytes: 0, uploaded_bytes: 0,
    hotspot_server_name: "hotspot", ip_address: null, last_router_sync_at: null, mac_address: null,
    mikrotik_id: "*1", mikrotik_profile_name: "1h", password_is_username: true, printed_count: 1,
    remaining_seconds: 3600, router_deleted_at: null, status: "disponible", sync_status: "synced",
    uptime_seconds: 0, duration_minutes_snapshot: 60, validity_minutes_snapshot: 180
  };
  return { router_id: "cloud-router", tickets: [ticket], batches: [{
    id: "batch-1", plan_id: "missing-plan", code_length: 6, created_at: ticket.created_at, updated_at: ticket.updated_at,
    created_by_email: ticket.created_by_email, created_by_name: "Agent", created_by_user_id: "user-1",
    currency: "EUR", hotspot_server_name: "hotspot", operator_profile: "agent", prefix: null,
    price_snapshot: 2, quantity: 1, status: "generated", sync_status: "synced"
  }] };
}

describe("bounded report reads", () => {
  afterEach(() => vi.useRealTimers());
  it("ends a hung read and ignores its late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: number) => void;
    const result = reportRead(new AbortController().signal, "Cloud", () => new Promise<number>(resolve => { finish = resolve; }), 100);
    const checked = expect(result).rejects.toThrow("Cloud : délai dépassé");
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    finish(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels on navigation and never starts an already cancelled read", async () => {
    const controller = new AbortController();
    const result = reportRead(controller.signal, "Cloud", () => new Promise(() => {}));
    controller.abort();
    await expect(result).rejects.toThrow("annulée");
    const read = vi.fn();
    await expect(reportRead(controller.signal, "Cloud", read)).rejects.toThrow("annulée");
    expect(read).not.toHaveBeenCalled();
  });
  it("returns success and propagates failures without waiting for timeout", async () => {
    expect(await reportRead(new AbortController().signal, "Cloud", async () => 42)).toBe(42);
    await expect(reportRead(new AbortController().signal, "Cloud", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
});

describe("cloud report projection", () => {
  it("includes vouchers even without the local plan, keeping commercial snapshots", () => {
    const session = createSession("guest", "guest@example.test", Date.now());
    const rows = cloudReportTickets(reportCatalog(), session, "guest-id", "local-router", "Nova", []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: "EUR", priceHint: 2, planDurationMinutes: 60,
      planValidityMinutes: 180, routerId: "local-router", passwordSecretRef: "report-only://unavailable", printedAt: [] });
  });
  it("maps the authenticated agent to its local profile and rejects another creator", () => {
    const session = createSession("agent", "agent@example.test", Date.now());
    const rows = cloudReportTickets(reportCatalog(), session, "user-1", "local-router", "Nova", []);
    expect(scopeReportTicketsForSession(rows, session)).toHaveLength(1);
    expect(cloudReportTickets(reportCatalog(), session, "other-user", "local-router", "Nova", [])).toEqual([]);
    expect(cloudReportTickets(reportCatalog(), session, undefined, "local-router", "Nova", [])).toEqual([]);
    expect(cloudReportTickets(reportCatalog(), { ...session, permissions: [] }, "user-1", "local-router", "Nova", [])).toEqual([]);
  });
});
