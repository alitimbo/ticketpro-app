import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  buildReportCsv,
  buildReportSummary,
  createDemoReportTickets,
  emptyReportFilters,
  filterReportTickets,
  getTicketsForMetric,
  scopeReportTicketsForSession
} from "./reportPageModel";

const agentSession = createSession("agent", "doumacorporation@gmail.com", Date.now());

describe("reportPageModel", () => {
  it("compte le nettoyage automatique confirmé sous son jour de suppression", () => {
    const ticket = { ...createDemoReportTickets()[1], createdAt: "2026-07-01T08:00:00Z",
      deletedAt: null, routerDeletedAt: "2026-07-12T10:00:00Z", archivedAt: "2026-07-12T10:00:00Z",
      status: "archivé" as const };
    const filters = { ...emptyReportFilters, dateFrom: "2026-07-12", dateTo: "2026-07-12" };
    expect(buildReportSummary([ticket], filters).metrics.find(metric => metric.id === "deleted")?.value).toBe(1);
    expect(buildReportSummary([{ ...ticket, routerDeletedAt: null }], filters).metrics.find(metric => metric.id === "deleted")?.value).toBe(0);
  });
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

  it("calcule les valeurs théoriques par devise sans notion de paiement", () => {
    const tickets = createDemoReportTickets();
    const filters = { ...emptyReportFilters, planId: "plan-3h" };
    const createdTickets = getTicketsForMetric(filterReportTickets(tickets, filters), "created", filters);
    const summary = buildReportSummary(tickets, filters);

    expect(summary.createdTheoreticalByCurrency.CFA).toBe(createdTickets.length * 200);
    expect(summary.activatedTheoreticalByCurrency.CFA ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("sépare les totaux de devises différentes dans le rapport", () => {
    const base = createDemoReportTickets()[0];
    const filters = { ...emptyReportFilters, dateFrom: "", dateTo: "" };
    const summary = buildReportSummary([
      { ...base, currency: "CFA", id: "ticket-cfa", priceHint: 100 },
      { ...base, currency: "EUR", id: "ticket-eur", priceHint: 5 }
    ], filters);

    expect(summary.createdTheoreticalByCurrency).toEqual({ CFA: 100, EUR: 5 });
    expect(buildReportCsv([{ ...base, currency: "EUR", priceHint: 5 }])).toContain("Prix théorique;Devise");
    expect(buildReportCsv([{ ...base, currency: "EUR", priceHint: 5 }])).toContain(";5;EUR");
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

  it("utilise les vraies dates d'impression et de suppression", () => {
    const base = createDemoReportTickets()[0];
    const ticket = {
      ...base,
      createdAt: "2026-07-01T10:00:00.000Z",
      deletedAt: "2026-07-12T10:00:00.000Z",
      printedAt: ["2026-07-11T10:00:00.000Z"],
      printedCount: 1,
      status: "supprimé" as const
    };
    const printFilters = { ...emptyReportFilters, dateFrom: "2026-07-11", dateTo: "2026-07-11" };
    const deletionFilters = { ...emptyReportFilters, dateFrom: "2026-07-12", dateTo: "2026-07-12" };

    expect(getTicketsForMetric([ticket], "printed", printFilters)).toHaveLength(1);
    expect(getTicketsForMetric([ticket], "created", printFilters)).toHaveLength(0);
    expect(getTicketsForMetric([ticket], "deleted", deletionFilters)).toHaveLength(1);
  });

  it("classe une activation sous son jour réel et non sous le jour de création", () => {
    const base = createDemoReportTickets()[0];
    const ticket = {
      ...base,
      activatedAt: "2026-07-15T08:00:00.000Z",
      createdAt: "2026-07-01T08:00:00.000Z",
      deletedAt: null,
      printedAt: []
    };
    const filters = { ...emptyReportFilters, dateFrom: "2026-07-15", dateTo: "2026-07-15" };
    const summary = buildReportSummary([ticket], filters);

    expect(summary.byDay).toEqual([
      expect.objectContaining({ activated: 1, created: 0, id: "2026-07-15" })
    ]);
  });

  it("exporte un CSV détaillé et échappe les cellules dangereuses", () => {
    const ticket = {
      ...createDemoReportTickets()[0],
      ipAddress: "10.0.0.2",
      macAddress: "AA:BB:CC:DD:EE:FF",
      planName: 'Plan; "VIP"',
      printedAt: ["2026-07-10T10:00:00.000Z"]
    };
    const csv = buildReportCsv([ticket]);

    expect(csv.startsWith("\uFEFFCode;Lot;Plan")).toBe(true);
    expect(csv).toContain('"Plan; ""VIP"""');
    expect(csv).toContain("Nombre d'impressions");
    expect(csv).toContain("10.0.0.2");
    expect(csv).toContain("AA:BB:CC:DD:EE:FF");
  });
  it("garde les tickets imprimés non utilisés dans le stock disponible", () => {
    const base = createDemoReportTickets()[1];
    const ticket = { ...base, status: "imprimé" as const, activatedAt: null, deletedAt: null, archivedAt: null, uptimeSeconds: 0 };
    const filters = { ...emptyReportFilters, dateFrom: "", dateTo: "" };
    expect(getTicketsForMetric([ticket], "available", filters)).toHaveLength(1);
    expect(getTicketsForMetric([{ ...ticket, activatedAt: ticket.createdAt }], "available", filters)).toHaveLength(0);
  });

  it("conserve l’expiration après archivage et exclut une suppression avant expiration", () => {
    const ticket = { ...createDemoReportTickets()[1], status: "archivé" as const,
      expiresAt: "2026-07-10T10:00:00.000Z", archivedAt: "2026-07-11T10:00:00.000Z",
      routerDeletedAt: "2026-07-11T10:00:00.000Z", deletedAt: null };
    const filters = { ...emptyReportFilters, dateFrom: "2026-07-10", dateTo: "2026-07-10" };
    expect(buildReportSummary([ticket], filters).metrics.find(m => m.id === "expired")?.value).toBe(1);
    expect(getTicketsForMetric([{ ...ticket, deletedAt: "2026-07-09T10:00:00.000Z" }], "expired", filters)).toHaveLength(0);
  });

  it("ne fabrique pas une date d’impression à partir de la création ou synchronisation", () => {
    const ticket = { ...createDemoReportTickets()[1], printedAt: [], printedCount: 2 };
    expect(getTicketsForMetric([ticket], "printed", emptyReportFilters)).toHaveLength(0);
    expect(getTicketsForMetric([ticket], "printed", { ...emptyReportFilters, dateFrom: "", dateTo: "" })).toHaveLength(1);
    expect(getTicketsForMetric([{ ...ticket, printedCount: 0, printedAt: [ticket.createdAt] }], "printed", emptyReportFilters)).toHaveLength(0);
  });

  it("applique les droits du rapport indépendamment des droits de la liste des tickets", () => {
    const tickets = createDemoReportTickets();
    const session = { ...agentSession, permissions: ["router.report.read" as const] };
    expect(scopeReportTicketsForSession(tickets, session)).toEqual(tickets.filter(ticket => ticket.accountId === session.account_id));
    expect(scopeReportTicketsForSession(tickets, { ...session, permissions: [] })).toEqual([]);
  });

});

