import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../../services/auth";
import type { SaasRouterTicketCatalog, SaasTicketSnapshot } from "../../services/saas";
import { cloudReportTickets, mergeReportTickets, planPriceAt, reportRead } from "./reportRead";
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
  it("conserve les dates d'impression partagées sans les inventer", () => {
    const catalog = reportCatalog();
    catalog.tickets[0].printed_at = ["2026-09-02T12:00:00Z"];
    const session = createSession("guest", "guest@example.test", Date.now());
    expect(cloudReportTickets(catalog, session, "guest-id", "local-router", "Nova", [])[0].printedAt)
      .toEqual(["2026-09-02T12:00:00Z"]);
  });

  it("fusionne le cache, SQLite et le cloud sans régression ni perte d'historique", () => {
    const session = createSession("guest", "guest@example.test", Date.now());
    const base = cloudReportTickets(reportCatalog(), session, "guest-id", "local-router", "Nova", [])[0];
    const current = { ...base, status: "consommé" as const, lastRouterSyncAt: "2026-09-03T12:00:00Z",
      uploadedBytes: 100, uptimeSeconds: 3600, printedAt: ["2026-09-02T12:00:00Z"], remainingSeconds: 0 };
    const old = { ...base, id: "other-pc-id", lastRouterSyncAt: "2026-09-01T12:00:00Z", printedCount: 2 };
    expect(mergeReportTickets([current], [old])[0]).toMatchObject({
      id: current.id, status: "consommé", uploadedBytes: 100, uptimeSeconds: 3600,
      printedAt: current.printedAt, printedCount: 2, remainingSeconds: 0, lastRouterSyncAt: current.lastRouterSyncAt
    });
    expect(mergeReportTickets([old], [current])[0].status).toBe("consommé");
  });
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

describe("planPriceAt", () => {
  const entry = (created_at: string, price_hint: number | null, revision: number, currency = "CFA") => ({
    action: "updated" as const, actor_profile_id: null, created_at, currency, id: `h${revision}`, mikrotik_id: null,
    mikrotik_profile_name: "4H", name: "4H", plan_id: "plan-4h", price_hint, revision, router_id: "r1",
    snapshot_json: "{}", source: "test"
  });
  const history = [entry("2026-01-01T00:00:00Z", 200, 1), entry("2026-03-01T00:00:00Z", 300, 2), entry("2026-05-01T00:00:00Z", 500, 3, "XOF")];
  const current = { currency: "XOF", id: "plan-4h", price_hint: 500 };

  it("garde le prix en vigueur à la création du ticket, malgré un changement de prix ultérieur", () => {
    expect(planPriceAt(history, current, "plan-4h", "2026-02-15T10:00:00Z")).toEqual({ currency: "CFA", priceHint: 200 });
    expect(planPriceAt(history, current, "plan-4h", "2026-04-01T10:00:00Z")).toEqual({ currency: "CFA", priceHint: 300 });
    expect(planPriceAt(history, current, "plan-4h", "2026-06-01T10:00:00Z")).toEqual({ currency: "XOF", priceHint: 500 });
  });

  it("utilise la plus ancienne révision connue, puis le plan actuel faute d'historique", () => {
    expect(planPriceAt(history, current, "plan-4h", "2025-12-01T00:00:00Z")).toEqual({ currency: "CFA", priceHint: 200 });
    expect(planPriceAt([], current, "plan-4h", "2026-02-15T10:00:00Z")).toEqual({ currency: "XOF", priceHint: 500 });
  });
});
