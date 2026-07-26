import { describe, expect, it } from "vitest";
import { formatBytes, getRouterQuickActions } from "./routerHomeModel";

describe("routerHomeModel", () => {
  it("adapte les actions rapides selon le rôle", () => {
    expect(getRouterQuickActions("operator", "demo").map((action) => action.id)).toEqual([
      "createTickets",
      "tickets",
      "clients",
      "report",
      "testRouter"
    ]);

    expect(getRouterQuickActions("agent", "demo").map((action) => action.id)).toEqual([
      "createTickets",
      "tickets",
      "report",
      "testRouter"
    ]);

    expect(getRouterQuickActions("guest", "demo").map((action) => action.id)).toEqual([
      "tickets",
      "report"
    ]);
  });

  it("formate les volumes mémoire", () => {
    expect(formatBytes(84 * 1024 * 1024)).toBe("84 Mo");
    expect(formatBytes(256 * 1024 * 1024)).toBe("256 Mo");
  });
});
