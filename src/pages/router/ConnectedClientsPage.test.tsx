import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  ActiveSessionCacheRepository,
  InMemoryDatabaseClient,
  RouterConnectionRepository,
  RouterRepository
} from "../../services/database";
import { RouterAccessPolicySyncService } from "../../services/access";
import { createSession } from "../../services/auth";
import { ConnectedClientsPage } from "./ConnectedClientsPage";

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  createRouter: vi.fn(),
  db: null as unknown,
  routerId: "local-1"
}));
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useParams: () => ({ routerId: mocks.routerId })
}));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../../services/database", async (original) => ({
  ...await original<typeof import("../../services/database")>(),
  useAppDatabase: () => ({ database: mocks.db, isInitialized: true, isPersistent: true })
}));
vi.mock("../../services/router", async (original) => ({
  ...await original<typeof import("../../services/router")>(),
  createPersistedRouterService: mocks.createRouter
}));

function routerService(username: string, delay?: Promise<void>) {
  return {
    getHotspotPlans: vi.fn(async () => []),
    listActiveUsers: vi.fn(async () => {
      await delay;
      return [{
        downloadedBytes: 0, id: `*A-${username}`, ipAddress: "10.0.0.2", macAddress: "AA:BB:CC:DD:EE:01",
        sessionTimeLeft: "1h", uploadedBytes: 0, uptime: "1m", username
      }];
    }),
    listHotspotUsers: vi.fn(async () => {
      throw new Error("La vue live ne doit pas relire tous les vouchers.");
    }),
    listHotspotUsersByUsernames: vi.fn(async () => [])
  };
}

describe("ConnectedClientsPage", () => {
  beforeEach(async () => {
    mocks.routerId = "local-1";
    const session = createSession("admin", "admin@example.test", Date.now());
    mocks.auth = { session };
    const db = new InMemoryDatabaseClient();
    await db.initialize();
    mocks.db = db;
    vi.spyOn(RouterConnectionRepository.prototype, "listByRouter").mockResolvedValue([]);
    vi.spyOn(ActiveSessionCacheRepository.prototype, "replaceForRouter").mockResolvedValue(undefined as never);
    vi.spyOn(RouterAccessPolicySyncService.prototype, "load").mockResolvedValue({
      policy: { lockVoucherToFirstMac: false }
    } as never);
    for (const id of ["local-1", "local-2"]) {
      await new RouterRepository(db).create({
        id, account_id: session.account_id, api_port: 8728, api_ssl_port: 8729,
        board_name: "CHR", cloud_router_id: null, connection_mode: "local",
        created_by_profile_id: session.internal_profile_id, encrypted_password: "secret://test",
        label: "Lab", last_seen_at: null, local_ip: "192.168.88.1", model: "CHR", name: id,
        routeros_version: "7", serial_number: id, status: "active", username: "test", zone_id: null
      });
    }
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.createRouter.mockReset(); });
  const view = () => <MemoryRouter><ConnectedClientsPage /></MemoryRouter>;

  it("lit uniquement les vouchers des sessions actives, sans liste complète", async () => {
    const service = routerService("V-1");
    mocks.createRouter.mockResolvedValue(service);
    render(view());
    await screen.findByText("V-1");
    expect(service.listHotspotUsersByUsernames).toHaveBeenCalledWith(["V-1"]);
    expect(service.listHotspotUsers).not.toHaveBeenCalled();
  });

  it("ignore la réponse tardive d'un routeur précédent", async () => {
    let releaseFirst!: () => void;
    const first = routerService("ANCIEN", new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const second = routerService("NOUVEAU");
    mocks.createRouter.mockImplementation(async (input: { router: { id: string } }) =>
      input.router.id === "local-1" ? first : second
    );
    const rendered = render(view());
    await waitFor(() => expect(first.listActiveUsers).toHaveBeenCalled());

    mocks.routerId = "local-2";
    rendered.rerender(view());
    await screen.findByText("NOUVEAU");

    await act(async () => { releaseFirst(); });
    expect(screen.queryByText("ANCIEN")).toBeNull();
    expect(screen.getByText("NOUVEAU")).toBeInTheDocument();
  });
});
