import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  buildTicketLifecycleLogs,
  canDeleteTicket,
  createDemoTickets,
  emptyTicketFilters,
  filterTickets,
  getPageCount,
  paginateTickets,
  ticketLifecycleBadges,
  scopeTicketsForSession,
  formatRemainingData
} from "./ticketsPageModel";

const adminSession = createSession("admin", "doumacorporation@gmail.com", Date.now());
const agentSession = createSession("agent", "doumacorporation@gmail.com", Date.now());

describe("ticketsPageModel", () => {
  it("distingue epuisement, expiration, utilisation et suppression confirmee", () => {
    const ticket = { ...createDemoTickets()[0], routerDeletedAt: null, syncStatus: "router_synced" as const };
    expect(ticketLifecycleBadges({ ...ticket, status: "consommé" })).toEqual([{ label: "Épuisé", status: "warning" }]);
    expect(ticketLifecycleBadges({ ...ticket, status: "expiré" })).toEqual([{ label: "Expiré", status: "offline" }]);
    expect(ticketLifecycleBadges({ ...ticket, status: "en_cours_utilisation" })).toEqual([{ label: "En cours d'utilisation", status: "active" }]);
    expect(ticketLifecycleBadges({ ...ticket, status: "archivé", routerDeletedAt: "2026-09-10" })).toEqual([
      { label: "Archivé", status: "offline" }, { label: "Supprimé du routeur", status: "offline" }
    ]);
    expect(ticketLifecycleBadges({ ...ticket, status: "supprimé_routeur", routerDeletedAt: "2026-09-10" })).toHaveLength(1);
  });

  it("ne transforme pas une absence ou un horodatage ancien en suppression confirmee", () => {
    const ticket = { ...createDemoTickets()[0], routerDeletedAt: "2026-09-10" };
    expect(ticketLifecycleBadges({ ...ticket, status: "archivé", syncStatus: "router_missing" })).toHaveLength(1);
    expect(ticketLifecycleBadges({ ...ticket, status: "disponible", syncStatus: "router_synced" })).toHaveLength(1);
    expect(ticketLifecycleBadges({ ...ticket, status: "archivé", routerDeletedAt: null, syncStatus: "router_synced" })).toHaveLength(1);
  });
  it("retrouve rapidement un ticket par code", () => {
    const tickets = createDemoTickets();
    const expectedCode = tickets[8].code;

    const filtered = filterTickets(tickets, { ...emptyTicketFilters, code: expectedCode });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].code).toBe(expectedCode);
  });

  it("filtre par statut, date et plan", () => {
    const tickets = createDemoTickets();

    const filtered = filterTickets(tickets, {
      ...emptyTicketFilters,
      dateFrom: "2026-07-08",
      dateTo: "2026-07-08",
      planId: "plan-3h",
      status: "imprimé"
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((ticket) => ticket.status === "imprimé")).toBe(true);
    expect(filtered.every((ticket) => ticket.planId === "plan-3h")).toBe(true);
  });

  it("ne permet la suppression que pour un ticket non utilisé et non imprimé", () => {
    const tickets = createDemoTickets();
    const available = tickets.find((ticket) => ticket.status === "disponible")!;
    const printed = tickets.find((ticket) => ticket.status === "imprimé")!;
    const active = tickets.find((ticket) => ticket.status === "activé")!;

    expect(canDeleteTicket(available)).toBe(true);
    expect(canDeleteTicket(printed)).toBe(false);
    expect(canDeleteTicket(active)).toBe(false);
  });

  it("pagine les longues listes de tickets", () => {
    const tickets = createDemoTickets();

    expect(getPageCount(tickets.length)).toBe(3);
    expect(paginateTickets(tickets, 1)).toHaveLength(25);
    expect(paginateTickets(tickets, 3)).toHaveLength(14);
  });

  it("décrit le cycle de vie sans stocker le mot de passe en clair", () => {
    const ticket = createDemoTickets().find((item) => item.status === "complété")!;
    const logs = buildTicketLifecycleLogs(ticket);

    expect(logs.map((log) => log.message)).toEqual(
      expect.arrayContaining(["Ticket activé par un client.", "Session complétée."])
    );
    expect(ticket.passwordSecretRef).toBe(`secret://routeur-demo/${ticket.code}/password`);
    expect(JSON.stringify(ticket)).not.toContain('"password":"');
  });
  it("limite les tickets Agent a son compte et a son profil interne", () => {
    const tickets = createDemoTickets();
    const adminTickets = scopeTicketsForSession(tickets, adminSession);
    const agentTickets = scopeTicketsForSession(tickets, agentSession);

    expect(adminTickets.length).toBeGreaterThan(agentTickets.length);
    expect(adminTickets.every((ticket) => ticket.accountId === "account-douma-demo")).toBe(true);
    expect(agentTickets.length).toBeGreaterThan(0);
    expect(agentTickets.every((ticket) => ticket.createdByProfileId === "account-douma-demo:internal-profile-agent")).toBe(true);
  });
});

describe("formatRemainingData", () => {
  it("n'affiche « Illimité » que pour un voucher sans quota", () => {
    expect(formatRemainingData({ dataLimitMb: null, dataRemainingBytes: null })).toBe("Illimité");
    expect(formatRemainingData({ dataLimitMb: 2048, dataRemainingBytes: null })).toBe("Non disponible");
    expect(formatRemainingData({ dataLimitMb: 2048, dataRemainingBytes: 1024 * 1024 * 1024 })).not.toBe("Illimité");
  });
});
