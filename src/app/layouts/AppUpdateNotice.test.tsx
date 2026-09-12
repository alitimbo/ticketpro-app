import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateNotice } from "./AppUpdateNotice";

const checkForAppUpdateMock = vi.hoisted(() => vi.fn());
const installAvailableAppUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/app", () => ({
  appUpdatesAreSupported: () => true,
  checkForAppUpdate: checkForAppUpdateMock,
  describeAppUpdateError: () => "Installation impossible.",
  installAvailableAppUpdate: installAvailableAppUpdateMock
}));

describe("AppUpdateNotice", () => {
  beforeEach(() => {
    checkForAppUpdateMock.mockReset();
    checkForAppUpdateMock.mockResolvedValue({
      currentVersion: "0.2.4",
      enforcement: "recommended",
      version: "0.2.5"
    });
    installAvailableAppUpdateMock.mockReset();
    installAvailableAppUpdateMock.mockResolvedValue({});
  });

  it("installe directement une mise à jour disponible pour tout utilisateur du poste", async () => {
    render(<AppUpdateNotice />);

    fireEvent.click(await screen.findByRole("button", { name: "Sauvegarder et mettre à jour" }));

    expect(installAvailableAppUpdateMock).toHaveBeenCalledOnce();
  });
});
