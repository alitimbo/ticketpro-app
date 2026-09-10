import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketPagination } from "./TicketPagination";
import { createDemoTickets } from "./ticketsPageModel";

const sample = createDemoTickets()[0];
const tickets = Array.from({ length: 10_000 }, (_, index) => ({ ...sample, id: `ticket-${index}`, code: `code-${index}` }));
afterEach(cleanup);

describe("TicketPagination", () => {
  it("renders only 25 of 10000 tickets and navigates without rerendering its owner", () => {
    const owner = vi.fn();
    const row = vi.fn(ticket => <div key={ticket.id} data-testid="ticket">{ticket.code}</div>);
    function Owner() {
      owner();
      return <TicketPagination tickets={tickets} renderTicket={row} empty="Vide" />;
    }
    render(<Owner />);
    expect(row).toHaveBeenCalledTimes(25);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByText("Page 2 / 400")).toBeInTheDocument();
    expect(screen.getByText("code-25")).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: "Précédent" });
    previous.focus();
    fireEvent.click(previous);
    expect(screen.getByText("Page 1 / 400")).toBeInTheDocument();
    expect(screen.getByText("code-0")).toBeInTheDocument();
    expect(screen.getAllByTestId("ticket")).toHaveLength(25);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(row).toHaveBeenCalledTimes(75);
    expect(screen.getByRole("navigation", { name: "Pagination des tickets" })).toBeInTheDocument();
  });

  it("clamps after deletions and Previous works immediately", () => {
    const row = (ticket: typeof sample) => <span key={ticket.id}>{ticket.code}</span>;
    const view = (items: typeof tickets, scope = "router-1") => <TicketPagination key={scope} tickets={items} renderTicket={row} empty="Vide" />;
    const result = render(view(tickets));
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    result.rerender(view(tickets.slice(0, 75)));
    expect(screen.getByText("Page 3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Précédent" }));
    expect(screen.getByText("Page 2 / 3")).toBeInTheDocument();
    result.rerender(view(tickets));
    expect(screen.getByText("Page 2 / 400")).toBeInTheDocument();
    result.rerender(view(tickets, "new-filter-or-router"));
    expect(screen.getByText("Page 1 / 400")).toBeInTheDocument();
    result.rerender(view([], "new-filter-or-router"));
    expect(screen.getByText("Vide")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
  });

  it("uses fresh row values and callbacks after synchronization without losing the page", () => {
    const action = vi.fn();
    const view = (value: string) => <TicketPagination tickets={tickets} empty="Vide"
      renderTicket={ticket => <button key={ticket.id} onClick={() => action(value, ticket.id)}>{value}-{ticket.code}</button>} />;
    const result = render(view("old"));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    result.rerender(view("fresh"));
    fireEvent.click(screen.getByRole("button", { name: "fresh-code-25" }));
    expect(action).toHaveBeenCalledWith("fresh", "ticket-25");
    expect(screen.getByText("Page 2 / 400")).toBeInTheDocument();
  });
});
