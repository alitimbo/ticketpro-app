import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { InMemoryDatabaseClient, RouterRepository, HotspotPlanRepository, TicketRepository,
  TicketBatchRepository, PrintHistoryRepository, RouterConnectionRepository } from "../../services/database";
import { createSession } from "../../services/auth";
import { ReportPage } from "./ReportPage";

const mocks = vi.hoisted(() => ({
  db: null as unknown, auth: null as unknown, routerId: "local-1",
  recovery: vi.fn(), catalog: vi.fn(), createRouter: vi.fn(), publish: vi.fn(), restore: vi.fn()
}));
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useParams: () => ({ routerId: mocks.routerId }) }));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../../services/database", async original => ({ ...await original<typeof import("../../services/database")>(),
  useAppDatabase: () => ({ database: mocks.db, isInitialized: true, isPersistent: true }) }));
vi.mock("../../services/saas", async original => ({ ...await original<typeof import("../../services/saas")>(),
  getSaasRouterRecoveryState: mocks.recovery, getSaasRouterTicketCatalog: mocks.catalog }));
vi.mock("../../services/router", async original => ({ ...await original<typeof import("../../services/router")>(), createPersistedRouterService: mocks.createRouter }));
vi.mock("../../services/recovery", () => ({ RouterCloudRecoveryService: class { restoreMissingRouters = mocks.restore; } }));
vi.mock("../../services/sync", async original => {
  const actual = await original<typeof import("../../services/sync")>();
  return { ...actual, OrganizationTicketCatalogService: class {
    publishRouter = mocks.publish;
    publishBatch = mocks.publish;
    publishObservedCatalog = mocks.publish;
    resumePending = async () => undefined;
  } };
});

describe("ReportPage invited reader", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.routerId = "local-1";
    const session = createSession("guest", "reader@example.test", Date.now());
    mocks.auth = { session, saasAccount: { organization: { id: "org" }, user: { id: "guest" } } };
    const db = new InMemoryDatabaseClient();
    await db.initialize();
    mocks.db = db;
    vi.spyOn(TicketRepository.prototype, "listForReportByAccount").mockResolvedValue([]);
    vi.spyOn(HotspotPlanRepository.prototype, "listByRouter").mockResolvedValue([]);
    vi.spyOn(TicketBatchRepository.prototype, "listByRouter").mockResolvedValue([]);
    vi.spyOn(PrintHistoryRepository.prototype, "listByAccount").mockResolvedValue([]);
    vi.spyOn(RouterConnectionRepository.prototype, "listByRouter").mockResolvedValue([]);
    for (const id of ["local-1", "local-2"]) {
      await new RouterRepository(db).create({
        id, account_id: session.account_id, api_port: 8728, api_ssl_port: 8729,
        board_name: "CHR", cloud_router_id: `cloud-${id}`, connection_mode: "vpn",
        created_by_profile_id: session.internal_profile_id, encrypted_password: "secret://test",
        label: "Lab", last_seen_at: null, local_ip: "192.168.88.1", model: "CHR", name: id,
        routeros_version: "7", serial_number: id, status: "active", username: "test", zone_id: null
      });
    }
    mocks.recovery.mockResolvedValue({ organization_id: "org", routers: [], retired: [] });
    mocks.catalog.mockImplementation(async id => ({ router_id: id, batches: [], tickets: [] }));
    mocks.createRouter.mockResolvedValue({ listHotspotUsers: async () => [], listActiveUsers: async () => [] });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const view = () => <MemoryRouter><ReportPage /></MemoryRouter>;

  it("publishes changed observations of shared tickets only with synchronization permission", async () => {
    const auth = mocks.auth as { session: ReturnType<typeof createSession> };
    mocks.auth = { ...mocks.auth as object, session: { ...auth.session,
      permissions: [...auth.session.permissions, "router.tickets.sync"] } };
    mocks.catalog.mockResolvedValue({ router_id: "cloud-local-1", batches: [], tickets: [{
      id: "cloud-ticket", batch_id: "cloud-batch", plan_id: "cloud-plan", username: "test-voucher",
      created_by_role: "operator", created_by_user_id: "other", created_at: "2026-09-01T00:00:00Z",
      activated_at: null, completed_at: null, expires_at: null, deleted_at: null,
      downloaded_bytes: 0, uploaded_bytes: 0, printed_count: 0, uptime_seconds: 0,
      status: "disponible", last_router_sync_at: null, duration_minutes_snapshot: 60,
      validity_minutes_snapshot: 180
    }] });
    mocks.createRouter.mockResolvedValue({ listHotspotUsers: async () => [{
      id: "*T", username: "test-voucher", planId: "cloud-plan", profileName: "cloud-plan",
      status: "available", uptime: "00:05:00", limitUptime: "01:00:00", downloadedBytes: 123, uploadedBytes: 456
    }], listActiveUsers: async () => [] });
    mocks.publish.mockResolvedValue(undefined);
    render(view());
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith("local-1", expect.objectContaining({
      tickets: expect.arrayContaining([expect.objectContaining({
        id: "cloud-ticket", status: "activé", uptime_seconds: 300, downloaded_bytes: 123, uploaded_bytes: 456
      })])
    })));
  });

  it("finishes for a guest without restoring the entire park or publishing a catalogue", async () => {
    const rendered = render(view());
    await waitFor(() => expect(document.querySelector(".report-live-card")?.textContent).toContain("En direct"));
    expect(mocks.catalog).toHaveBeenCalledWith("cloud-local-1", "report", expect.any(AbortSignal));
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    const auth = mocks.auth as { session: object };
    mocks.auth = { ...auth, session: { ...auth.session } };
    rendered.rerender(view());
    await act(async () => {});
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
  });

  it("ignores a late cloud reply after changing routers", async () => {
    let finish!: (value: unknown) => void;
    mocks.catalog.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = render(view());
    await waitFor(() => expect(mocks.catalog).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.catalog.mock.calls[0][2] as AbortSignal;
    mocks.routerId = "local-2";
    rendered.rerender(view());
    await screen.findByText("En direct");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { finish({ router_id: "cloud-local-1", tickets: [], batches: [] }); });
    expect(mocks.createRouter).toHaveBeenCalledTimes(1);
    expect(mocks.createRouter.mock.calls[0][0].router.id).toBe("local-2");
    expect(screen.getByText("En direct")).toBeInTheDocument();
  });

  it("ends the loading state when cloud access is denied and does not read RouterOS", async () => {
    const { SaasRequestError } = await import("../../services/saas");
    mocks.catalog.mockRejectedValueOnce(new SaasRequestError("Accès refusé", 403));
    render(view());
    await screen.findByText("Mode dégradé");
    expect(document.querySelector(".report-live-card")?.textContent).toContain("Accès refusé");
    expect(mocks.createRouter).not.toHaveBeenCalled();
    expect(screen.queryByText("Synchronisation…")).not.toBeInTheDocument();
  });

  it("releases the spinner and aborts HTTP when the cloud never answers", async () => {
    vi.useFakeTimers();
    mocks.catalog.mockImplementationOnce(() => new Promise(() => {}));
    render(view());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText("Mode dégradé")).toBeInTheDocument();
    expect(document.querySelector(".report-live-card")?.textContent).toContain("délai dépassé");
    expect((mocks.catalog.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    expect(screen.queryByText("Synchronisation…")).not.toBeInTheDocument();
  });
});
