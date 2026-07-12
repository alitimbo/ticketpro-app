import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  buildReportSummary,
  createDemoReportTickets,
  emptyReportFilters,
  filterReportTickets,
  getTicketsForMetric,
  scopeReportTicketsForSession
} from "./reportPageModel";

const agentSession = createSession("agent", "doumacorporation@gmail.com", Date.now());

describe("reportPageModel", () => {
  it("calcule les tickets activés, complétés et supprimés sur une période", () => {
    const tickets = createDemoReportTickets();
    const filters = { ...emptyReportFilters, dateFrom: "2026-07-08", dateTo: "2026-07-08" };
    const filtered = filterReportTickets(tickets, filters);
    const summary = buildReportSummary(tickets, filters);

    expect(filtered.length).toBeGreaterThan(0);
    expect(summary.metrics.find((metric) => metric.id === "activated")?.value).toBeGreaterThan(0);
    expect(summary.metrics.find((metric) => metric.id === "completed")?.value).toBeGreaterThan(0);
    expect(summary.metrics.find((metric) => metric.id === "deleted")?.value).toBeGreaterThan(0);
  });

  it("calcule les valeurs théoriques CFA sans notion de paiement", () => {
    const tickets = createDemoReportTickets();
    const filters = { ...emptyReportFilters, planId: "plan-3h" };
    const createdTickets = getTicketsForMetric(filterReportTickets(tickets, filters), "created", filters);
    const summary = buildReportSummary(tickets, filters);

    expect(summary.createdTheoreticalCfa).toBe(createdTickets.length * 200);
    expect(summary.activatedTheoreticalCfa).toBeGreaterThanOrEqual(0);
  });
  it("filtre le rapport par profil interne et limite l'Agent a son activite", () => {
    const tickets = createDemoReportTickets();
    const scoped = scopeReportTicketsForSession(tickets, agentSession);
    const filtered = filterReportTickets(tickets, {
      ...emptyReportFilters,
      internalProfileId: "account-douma-demo:internal-profile-agent"
    });

    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((ticket) => ticket.createdByProfileId === "account-douma-demo:internal-profile-agent")).toBe(true);
    expect(filtered.every((ticket) => ticket.createdByProfileId === "account-douma-demo:internal-profile-agent")).toBe(true);
  });
});
