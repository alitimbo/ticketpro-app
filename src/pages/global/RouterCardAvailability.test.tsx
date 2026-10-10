import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRouters, describeRouterAvailability } from "./routerPageModel";
import { RouterCard } from "./RoutersPage";

afterEach(cleanup);

function renderCard(state: "online" | "offline" | undefined, isConnecting = false) {
  const now = Date.now();
  return render(
    <RouterCard
      availability={describeRouterAvailability(state ? { checkedAt: now, state } : undefined, "", now)}
      canDelete={false} canEdit={false} isConnecting={isConnecting}
      onConfigureRemote={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onLocal={vi.fn()}
      onOpen={vi.fn()} onRemote={vi.fn()} onTest={vi.fn()} router={demoRouters[0]}
    />
  );
}

describe("état de connexion d'une carte routeur", () => {
  it("affiche le libellé sur sa propre ligne, hors de l'en-tête", () => {
    const { container } = renderCard("online");
    expect(container.querySelector(".router-card__availability")?.textContent).toBe("ConnexionEn ligne");
    expect(container.querySelector(".router-card__availability-value--active")).not.toBeNull();
  });

  it("indique la connexion en cours et l'état hors ligne", () => {
    renderCard(undefined, true);
    expect(screen.getAllByText("Connexion en cours").length).toBeGreaterThan(0);
    cleanup();
    const { container } = renderCard("offline");
    expect(container.querySelector(".router-card__availability")?.textContent).toBe("ConnexionHors ligne");
  });
});
