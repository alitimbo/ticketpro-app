import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRouters } from "./routerPageModel";
import { ConnectionChoiceDialog, type RemoteAccessView } from "./RoutersPage";

afterEach(cleanup);

const view = (overrides: Partial<RemoteAccessView>): RemoteAccessView => ({
  canChange: true, error: null, progress: null, state: "off", ...overrides
});

function renderDialog(remoteAccess: RemoteAccessView, onToggle = vi.fn()) {
  render(
    <ConnectionChoiceDialog
      onCancel={vi.fn()}
      onLocal={vi.fn()}
      onRemote={vi.fn()}
      onToggleRemoteAccess={onToggle}
      remoteAccess={remoteAccess}
      router={demoRouters[0]}
    />
  );
  return { onToggle, toggle: screen.getByRole("switch", { name: /Accès à distance/ }) };
}

describe("interrupteur Accès à distance", () => {
  it("active l'accès d'un clic", () => {
    const { onToggle, toggle } = renderDialog(view({ state: "off" }));
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/première activation se fait depuis le réseau local/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("affiche un routeur déjà activé comme vérifié et propose de le désactiver", () => {
    const { onToggle, toggle } = renderDialog(view({ state: "on" }));
    expect(toggle).toBeChecked();
    expect(screen.getByText(/accessible de partout/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("relance la vérification d'un accès en attente au lieu de le désactiver", () => {
    const { onToggle, toggle } = renderDialog(view({ state: "pending" }));
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("bloque l'interrupteur pendant l'opération et affiche l'étape", () => {
    const { toggle } = renderDialog(view({ progress: "Vérification à travers le VPN…" }));
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Vérification à travers le VPN…")).toBeInTheDocument();
  });

  it("reste en lecture seule sans droit de modification", () => {
    const { toggle } = renderDialog(view({ canChange: false, state: "on" }));
    expect(toggle).toBeDisabled();
  });
});
