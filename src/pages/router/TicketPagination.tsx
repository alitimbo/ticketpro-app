import { useState, type ReactNode } from "react";
import { Button } from "../../shared/ui";
import { getPageCount, paginateTickets, ticketPageSize, type TicketListItem } from "./ticketsPageModel";

/** Page navigation is local: it must not rerender the catalogue/sync owner. */
export function TicketPagination({ tickets, renderTicket, empty }: {
  tickets: TicketListItem[];
  renderTicket: (ticket: TicketListItem) => ReactNode;
  empty: ReactNode;
}) {
  const pageCount = getPageCount(tickets.length, ticketPageSize);
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, pageCount);
  // Persist the clamp when a sync removes rows, so Previous works on first click
  // and later additions cannot unexpectedly restore an obsolete page number.
  if (page !== currentPage) setPage(currentPage);
  const visible = paginateTickets(tickets, currentPage, ticketPageSize);
  return <>
    {visible.length > 0 ? <div className="ticket-list">{visible.map(renderTicket)}</div> : empty}
    <nav className="pagination-row" aria-label="Pagination des tickets">
      <Button disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} variant="ghost">Précédent</Button>
      <span aria-current="page">Page {currentPage} / {pageCount}</span>
      <Button disabled={currentPage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))} variant="ghost">Suivant</Button>
    </nav>
  </>;
}
