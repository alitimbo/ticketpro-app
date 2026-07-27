import { describe, expect, it } from "vitest";
import { getRouterNavigation, globalNavigation } from "./routes";

describe("navigation", () => {
  it("expose les entrées globales attendues", () => {
    expect(globalNavigation.map((item) => item.label)).toEqual([
      "Maison",
      "Mon compte",
      "Routeurs",
      "Équipe & accès",
      "VPN distant",
      "Abonnement",
      "Factures",
      "Paramètres"
    ]);
  });

  it("adapte les entrées routeur selon le rôle", () => {
    expect(getRouterNavigation("demo", "operator").map((item) => item.label)).toEqual([
      "Maison",
      "Plans",
      "Tickets",
      "Génération tickets",
      "Fichiers",
      "Rapport",
      "Clients connectés",
      "État réseau",
      "Logs",
      "Paramètres routeur"
    ]);

    expect(getRouterNavigation("demo", "agent").map((item) => item.label)).toContain("Mes tickets");
  });
});
