import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRouters } from "./routerPageModel";
import { ConnectionChoiceDialog } from "./RoutersPage";

afterEach(cleanup);

describe("ConnectionChoiceDialog", () => {
  it("propose les deux modes de connexion sans consigne de développement", () => {
    const onLocal = vi.fn();
    const onRemote = vi.fn();
    const router = { ...demoRouters[0], remoteHost: "remote.example.test", remoteMode: "distant_ip" as const };
    const { container } = render(<ConnectionChoiceDialog onCancel={vi.fn()} onLocal={onLocal} onRemote={onRemote} router={router} />);

    expect(screen.queryByText(/exposer/i)).toBeNull();
    expect(screen.queryByText(/VPN ou un agent distant/i)).toBeNull();
    expect(container.querySelector(".form-error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Connexion locale/ }));
    fireEvent.click(screen.getByRole("button", { name: /Connexion à distance/ }));
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onRemote).toHaveBeenCalledTimes(1);
  });
});

describe("parcours routeur", () => {
  it("n'affiche la consigne d'exposition RouterOS ni dans la connexion ni dans le formulaire", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src/pages/global/RoutersPage.tsx"), "utf8");
    expect(source).not.toContain("remoteSecurityWarnings");
  });
});
