import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDatabaseClient } from "../../services/database";
import { FakeRouterAdapter } from "../../services/router";
import { MonitoringPage } from "./MonitoringPage";

const context = vi.hoisted(() => ({ database: null as unknown, routerId: "lab" }));
vi.mock("react-router-dom", async original => ({
  ...await original<typeof import("react-router-dom")>(),
  useParams: () => ({ routerId: context.routerId })
}));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("../../services/database", async original => ({
  ...await original<typeof import("../../services/database")>(),
  useAppDatabase: () => ({ database: context.database, isInitialized: true, isPersistent: false })
}));

describe("MonitoringPage background refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    context.database = new InMemoryDatabaseClient();
    context.routerId = "lab";
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(1); });

  it("keeps measurements during automatic refresh and ignores late replies after a timeout", async () => {
    const health = vi.spyOn(FakeRouterAdapter.prototype, "getRouterHealth");
    render(<MonitoringPage />);
    expect(screen.getByText("Analyse du réseau en cours…")).toBeInTheDocument();
    await flush();
    expect(screen.getByText("Tout fonctionne normalement")).toBeInTheDocument();
    let resolve!: (value: Awaited<ReturnType<FakeRouterAdapter["getRouterHealth"]>>) => void;
    health.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(health).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Analyse du réseau en cours…")).not.toBeInTheDocument();
    expect(screen.getByText("Tout fonctionne normalement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rafraîchir" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText("Actualisation interrompue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rafraîchir" })).toBeEnabled();
    await act(async () => { resolve({ ...await health.mock.results[0].value, cpuLoad: 99 }); });
    expect(screen.queryByText("99%")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    await flush();
    expect(screen.queryByText("Actualisation interrompue")).not.toBeInTheDocument();
  });

  it("ends the initial loading after a timeout and allows retry", async () => {
    vi.spyOn(FakeRouterAdapter.prototype, "getRouterHealth").mockImplementationOnce(() => new Promise(() => {}));
    render(<MonitoringPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByText("Analyse du réseau en cours…")).not.toBeInTheDocument();
    expect(screen.getByText(/Le routeur n'a pas terminé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    await flush();
    expect(screen.getByText("Tout fonctionne normalement")).toBeInTheDocument();
  });

  it("clears previous measurements when changing routers and ignores the previous response", async () => {
    const health = vi.spyOn(FakeRouterAdapter.prototype, "getRouterHealth");
    const view = render(<MonitoringPage />);
    await flush();
    let resolve!: (value: Awaited<ReturnType<FakeRouterAdapter["getRouterHealth"]>>) => void;
    health.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    await flush();
    context.routerId = "other";
    view.rerender(<MonitoringPage />);
    expect(screen.queryByText("Tout fonctionne normalement")).not.toBeInTheDocument();
    await flush();
    await act(async () => { resolve({ ...await health.mock.results[0].value, cpuLoad: 99 }); });
    expect(screen.queryByText("99%")).not.toBeInTheDocument();
    expect(screen.getByText("Tout fonctionne normalement")).toBeInTheDocument();
  });
});
