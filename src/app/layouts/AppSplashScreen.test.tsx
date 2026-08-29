import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppSplashScreen } from "./AppSplashScreen";
import { isAppBootstrapReady } from "./AppBootstrap";

describe("AppSplashScreen", () => {
  it("affiche l'identité TicketPro et un statut accessible", () => {
    render(<AppSplashScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Préparation de votre espace sécurisé");
    expect(screen.getByRole("img", { name: "Logo TicketPro" })).toBeInTheDocument();
    expect(screen.getByText("par Akicorp Solutions")).toBeInTheDocument();
  });

  it("affiche une erreur d'initialisation sans loader infini", () => {
    render(<AppSplashScreen detail="Relancez l'application." message="Initialisation impossible." status="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Initialisation impossible");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});

describe("isAppBootstrapReady", () => {
  it("attend SQLite puis la restauration SaaS lorsqu'une session existe", () => {
    expect(isAppBootstrapReady({ isInitialized: false, isMainAuthenticated: false, isSubscriptionChecked: false })).toBe(false);
    expect(isAppBootstrapReady({ isInitialized: true, isMainAuthenticated: false, isSubscriptionChecked: false })).toBe(true);
    expect(isAppBootstrapReady({ isInitialized: true, isMainAuthenticated: true, isSubscriptionChecked: false })).toBe(false);
    expect(isAppBootstrapReady({ isInitialized: true, isMainAuthenticated: true, isSubscriptionChecked: true })).toBe(true);
  });
});
