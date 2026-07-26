import { describe, expect, it } from "vitest";
import { hasAnyPermission, hasPermission, permissionsByRole } from "./permissions";

describe("permissions", () => {
  it("donne un accès complet à l'Admin", () => {
    expect(permissionsByRole.admin).toEqual(expect.arrayContaining(permissionsByRole.operator));
    expect(hasPermission("admin", "global.routers.add")).toBe(true);
    expect(hasPermission("admin", "global.settings.profiles")).toBe(true);
    expect(hasPermission("admin", "global.subscription")).toBe(true);
    expect(hasPermission("admin", "global.invoices")).toBe(true);
    expect(hasPermission("admin", "router.logs.clean")).toBe(true);
  });

  it("limite l'Opérateur aux actions d'exploitation", () => {
    expect(hasPermission("operator", "global.routers.select")).toBe(true);
    expect(hasPermission("operator", "router.home")).toBe(true);
    expect(hasPermission("operator", "router.plans.read")).toBe(true);
    expect(hasPermission("operator", "router.plans.write")).toBe(false);
    expect(hasPermission("operator", "router.tickets.generate")).toBe(true);
    expect(hasPermission("operator", "router.tickets.reprint")).toBe(true);
    expect(hasPermission("operator", "router.clients.read")).toBe(true);
    expect(hasPermission("operator", "router.settings")).toBe(false);
    expect(hasPermission("operator", "global.settings")).toBe(false);
    expect(hasPermission("operator", "global.invoices")).toBe(false);
  });

  it("sépare Agent et Invité des accès sensibles", () => {
    expect(hasAnyPermission("agent", ["router.tickets.read", "router.tickets.own"])).toBe(true);
    expect(hasPermission("agent", "router.tickets.generate")).toBe(true);
    expect(hasPermission("agent", "router.files.own")).toBe(true);
    expect(hasPermission("agent", "router.files.read")).toBe(false);
    expect(hasPermission("agent", "router.plans.read")).toBe(false);
    expect(hasPermission("guest", "router.tickets.read")).toBe(true);
    expect(hasPermission("guest", "router.tickets.generate")).toBe(false);
    expect(hasPermission("guest", "router.network.read")).toBe(true);
  });
});
