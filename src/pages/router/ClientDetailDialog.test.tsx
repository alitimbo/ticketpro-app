import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HotspotPlan, HotspotUser } from "../../domain/router";
import { ClientDetailDialog } from "./ConnectedClientsPage";
import { buildConnectedClientViewModels } from "./connectedClientsPageModel";

afterEach(cleanup);

const plan: HotspotPlan = {
  dataLimitMb: 8192,
  downloadLimit: "5M",
  durationMinutes: 10080,
  id: "*P7",
  name: "1 Semaine-7G",
  priceHint: 2000,
  profileName: "1-semaine",
  sharedUsers: 1,
  status: "active",
  uploadLimit: "2M",
  validityMinutes: 10080
};
const voucher = (limitBytesTotal: number | null): HotspotUser => ({
  comment: "TicketPro:v1;validity=10080;expires=0;state=active;",
  createdAt: "2026-10-01T10:00:00.000Z",
  downloadedBytes: 2 * 1024 ** 3,
  id: "*U1",
  limitBytesTotal,
  passwordSecretRef: "secret://u1",
  planId: "1-semaine",
  profileName: "1-semaine",
  status: "active",
  uploadedBytes: 439 * 1024 ** 2,
  username: "456548"
});
const clientWith = (limitBytesTotal: number | null) => buildConnectedClientViewModels(
  [{
    downloadedBytes: 0,
    id: "a1",
    ipAddress: "192.168.88.16",
    macAddress: "F2:7A:26:42:91:E8",
    sessionTimeLeft: "6d9h",
    uploadedBytes: 0,
    uptime: "2h21m53s",
    username: "456548"
  }],
  [voucher(limitBytesTotal)],
  [plan],
  { id: "r1", name: "AYMANE WIFI ZONE" }
)[0];

describe("fiche d'un client connecté", () => {
  it("se ferme par la croix, la touche Échap et un clic en dehors de la fiche", () => {
    const onClose = vi.fn();
    const { container } = render(<ClientDetailDialog client={clientWith(null)} isCached={false} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Fermer la fiche client" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(container.querySelector(".dialog-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
    // The content scrolls inside the card; header and actions stay visible.
    expect(container.querySelector(".plan-detail-dialog__body .client-detail-grid")).not.toBeNull();
  });

  it("signale un voucher sans le quota de son plan et permet de l'appliquer", () => {
    const onApplyQuota = vi.fn();
    render(<ClientDetailDialog client={clientWith(null)} isCached={false} onApplyQuota={onApplyQuota} onClose={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toContain("8.0 Go");
    fireEvent.click(screen.getByRole("button", { name: /Appliquer le quota du plan/ }));
    expect(onApplyQuota).toHaveBeenCalledWith(expect.objectContaining({ planDataLimitBytes: 8 * 1024 ** 3, username: "456548" }));
  });

  it("n'affiche ni alerte ni bouton quand RouterOS porte déjà le quota", () => {
    render(<ClientDetailDialog client={clientWith(8 * 1024 ** 3)} isCached={false} onApplyQuota={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Appliquer le quota du plan/ })).toBeNull();
    expect(screen.getByText("8.0 Go")).not.toBeNull();
  });
});
