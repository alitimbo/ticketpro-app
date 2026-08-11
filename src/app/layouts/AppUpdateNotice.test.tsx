import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateNotice } from "./AppUpdateNotice";

const checkForAppUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/app", () => ({
  appUpdatesAreSupported: () => true,
  checkForAppUpdate: checkForAppUpdateMock
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.hash}</output>;
}

describe("AppUpdateNotice", () => {
  beforeEach(() => {
    checkForAppUpdateMock.mockReset();
    checkForAppUpdateMock.mockResolvedValue({
      currentVersion: "0.2.4",
      version: "0.2.5"
    });
  });

  it("redirige vers la section de mise à jour des paramètres", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppUpdateNotice canManageUpdates />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Voir la mise à jour" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/parametres#mise-a-jour");
  });
});
