export type TicketLifecyclePhase =
  | "available"
  | "active"
  | "exhausted"
  | "expired"
  | "router_deleted"
  | "archived";

export type TicketLifecycleResolution = {
  regression: boolean;
  status: string;
};

const lifecycleRank: Record<TicketLifecyclePhase, number> = {
  available: 0,
  active: 1,
  exhausted: 2,
  expired: 3,
  router_deleted: 4,
  archived: 5
};

export function ticketLifecyclePhase(status: string): TicketLifecyclePhase | null {
  const normalized = normalizeTicketStatus(status);
  if (
    normalized.includes("router_deleted")
    || (normalized.includes("supprim") && normalized.includes("routeur"))
  ) return "router_deleted";
  if (
    normalized.includes("archiv")
    || normalized === "deleted"
    || normalized.includes("supprim")
  ) return "archived";
  if (normalized.includes("expir")) return "expired";
  if (
    normalized.includes("consomm")
    || normalized.includes("puis")
    || normalized.includes("exhaust")
  ) return "exhausted";
  if (
    isDisabledTicketStatus(normalized)
    || normalized.includes("avail")
    || normalized.includes("dispon")
    || normalized.includes("imprim")
  ) return "available";
  if (
    normalized.includes("active")
    || normalized.includes("activ")
    || normalized.includes("complet")
    || normalized.includes("en_cours")
  ) return "active";
  return null;
}

/**
 * RouterOS observations may advance a voucher, never make an already used or
 * terminal voucher reusable again.
 */
export function resolveObservedTicketStatus(
  currentStatus: string,
  observedStatus: string
): TicketLifecycleResolution {
  const currentPhase = ticketLifecyclePhase(currentStatus);
  const observedPhase = ticketLifecyclePhase(observedStatus);
  if (!observedPhase) return { regression: false, status: currentStatus };
  if (!currentPhase) return { regression: false, status: observedStatus };

  if (lifecycleRank[observedPhase] < lifecycleRank[currentPhase]) {
    return { regression: true, status: currentStatus };
  }

  // Printing is an audit fact, not a RouterOS lifecycle state. Keep it until
  // the router proves that the voucher was activated.
  if (normalizeTicketStatus(currentStatus).includes("imprim") && observedPhase === "available") {
    return { regression: false, status: currentStatus };
  }

  return { regression: false, status: observedStatus };
}

/**
 * Shared organization data may contain an older observation from another PC.
 * Explicit disable/enable actions remain possible, but a consumed or expired
 * voucher can never become reusable through catalog synchronization.
 */
export function resolveSharedTicketStatus(
  currentStatus: string,
  incomingStatus: string
): TicketLifecycleResolution {
  const currentPhase = ticketLifecyclePhase(currentStatus);
  const incomingPhase = ticketLifecyclePhase(incomingStatus);
  if (!incomingPhase) return { regression: false, status: currentStatus };
  if (!currentPhase) return { regression: false, status: incomingStatus };

  const normalizedIncoming = normalizeTicketStatus(incomingStatus);
  if (
    lifecycleRank[currentPhase] >= lifecycleRank.exhausted
    && lifecycleRank[incomingPhase] < lifecycleRank[currentPhase]
  ) {
    return { regression: true, status: currentStatus };
  }
  if (
    currentPhase === "active"
    && incomingPhase === "available"
    && !isDisabledTicketStatus(normalizedIncoming)
  ) {
    return { regression: true, status: currentStatus };
  }
  return { regression: false, status: incomingStatus };
}

export function canApplyPlanChangeToVoucher(ticket: {
  activated_at: string | null;
  completed_at: string | null;
  downloaded_bytes: number;
  exported_at?: string | null;
  expires_at: string | null;
  printed_count: number;
  status: string;
  uploaded_bytes: number;
  uptime_seconds?: number;
}): boolean {
  return ticketLifecyclePhase(ticket.status) === "available"
    && !ticket.activated_at
    && !ticket.completed_at
    && !ticket.expires_at
    && !ticket.exported_at
    && ticket.printed_count === 0
    && ticket.downloaded_bytes === 0
    && ticket.uploaded_bytes === 0
    && (ticket.uptime_seconds ?? 0) === 0;
}

export function isTerminalVoucherStatus(status: string): boolean {
  const phase = ticketLifecyclePhase(status);
  return Boolean(phase && lifecycleRank[phase] >= lifecycleRank.exhausted);
}

function normalizeTicketStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isDisabledTicketStatus(normalized: string): boolean {
  return normalized.includes("disabled")
    || normalized.includes("desactiv")
    || normalized.includes("sactiv");
}
