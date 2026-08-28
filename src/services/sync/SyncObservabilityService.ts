import type {
  RouterRecord,
  SyncOutboxRecord,
  SyncOutboxStatus,
  TicketRecord,
  VpnPeerRecord
} from "../../domain/database";
import type { AppStatus } from "../../shared/ui";
import {
  RouterManagedResourceManifestRepository,
  RouterRepository,
  SyncOutboxRepository,
  TicketRepository,
  VpnPeerRepository,
  type DatabaseClient,
  type SyncOutboxHealth
} from "../database";

export type SyncDiagnosticCode =
  | "DUPLICATE_LOCAL_VOUCHER"
  | "DUPLICATE_VPN_ASSIGNMENT"
  | "LEGACY_STATUS_ENCODING"
  | "MANIFEST_DRIFT"
  | "MANIFEST_ERROR"
  | "MANIFEST_MISSING"
  | "MANIFEST_WARNING"
  | "OUTBOX_BACKLOG"
  | "OUTBOX_CONFLICT"
  | "OUTBOX_FAILED"
  | "OUTBOX_RETRY"
  | "ROUTER_DATA_MISSING"
  | "ROUTER_DATA_STALE"
  | "TICKET_CACHE_INCOMPLETE"
  | "TICKET_CACHE_STALE"
  | "VPN_PEER_DRAFT"
  | "VPN_PEER_MISSING"
  | "VPN_PEER_STALE";

export type SyncDiagnosticAlert = {
  code: SyncDiagnosticCode;
  message: string;
  status: Exclude<AppStatus, "active" | "offline">;
  title: string;
};

export type SyncFreshnessItem = {
  checkedAt: string | null;
  id: "manifest" | "router" | "tickets" | "vpn";
  label: string;
  message: string;
  status: Exclude<AppStatus, "active" | "offline">;
};

export type SyncObservabilityReport = {
  alerts: SyncDiagnosticAlert[];
  checkedAt: string;
  freshness: SyncFreshnessItem[];
  incidents: SyncOperationIncident[];
  queue: SyncOutboxHealth;
  status: Exclude<AppStatus, "active" | "offline">;
  statusLabel: string;
};

export type SyncOperationIncident = {
  aggregateId: string;
  code: string | null;
  correlationId: string;
  message: string | null;
  operationType: string;
  status: SyncOutboxRecord["status"];
  updatedAt: string;
};

export type SyncObservabilityThresholds = {
  manifestErrorAfterMs: number;
  manifestWarningAfterMs: number;
  outboxErrorAfterMs: number;
  outboxWarningAfterMs: number;
  routerErrorAfterMs: number;
  routerWarningAfterMs: number;
  ticketErrorAfterMs: number;
  ticketWarningAfterMs: number;
  vpnHandshakeWarningAfterMs: number;
};

export const DEFAULT_SYNC_OBSERVABILITY_THRESHOLDS: SyncObservabilityThresholds = {
  manifestErrorAfterMs: 72 * 60 * 60 * 1_000,
  manifestWarningAfterMs: 24 * 60 * 60 * 1_000,
  outboxErrorAfterMs: 30 * 60 * 1_000,
  outboxWarningAfterMs: 5 * 60 * 1_000,
  routerErrorAfterMs: 5 * 60 * 1_000,
  routerWarningAfterMs: 60 * 1_000,
  ticketErrorAfterMs: 30 * 60 * 1_000,
  ticketWarningAfterMs: 5 * 60 * 1_000,
  vpnHandshakeWarningAfterMs: 5 * 60 * 1_000
};

type InspectSyncObservabilityInput = {
  accountId: string;
  liveRouterObservedAt?: string | null;
  liveTicketsObservedAt?: string | null;
  now?: string;
  routerId: string;
};

/**
 * Builds a read-only, secret-free view of local synchronization health.
 * A current timestamp may only be supplied after a real RouterOS read has
 * succeeded; the service never promotes stale cached data to "live" itself.
 */
export class SyncObservabilityService {
  private readonly manifests: RouterManagedResourceManifestRepository;
  private readonly outbox: SyncOutboxRepository;
  private readonly routers: RouterRepository;
  private readonly tickets: TicketRepository;
  private readonly vpnPeers: VpnPeerRepository;

  constructor(
    database: DatabaseClient,
    private readonly thresholds = DEFAULT_SYNC_OBSERVABILITY_THRESHOLDS
  ) {
    this.manifests = new RouterManagedResourceManifestRepository(database);
    this.outbox = new SyncOutboxRepository(database);
    this.routers = new RouterRepository(database);
    this.tickets = new TicketRepository(database);
    this.vpnPeers = new VpnPeerRepository(database);
  }

  async inspect(input: InspectSyncObservabilityInput): Promise<SyncObservabilityReport> {
    const checkedAt = input.now ?? new Date().toISOString();
    const nowMs = parseDate(checkedAt) ?? Date.now();
    const router = await this.routers.findById(input.routerId);
    if (!router || router.account_id !== input.accountId) {
      throw new Error("Routeur introuvable pour ce diagnostic de synchronisation.");
    }

    const [tickets, storedManifest, peers, queue, queuedOperations] = await Promise.all([
      this.tickets.listByRouter(input.routerId),
      this.manifests.findByRouter(input.routerId),
      this.vpnPeers.listByAccount(input.accountId),
      this.outbox.health(input.accountId, input.routerId),
      this.outbox.listByAccount(input.accountId)
    ]);
    const alerts: SyncDiagnosticAlert[] = [];
    const freshness: SyncFreshnessItem[] = [];

    const routerObservedAt = latestDate(input.liveRouterObservedAt, router.last_seen_at);
    const routerFreshness = freshnessFromDate({
      checkedAt: routerObservedAt,
      errorAfterMs: this.thresholds.routerErrorAfterMs,
      errorMessage: "Aucune lecture récente du MikroTik n'est disponible.",
      freshMessage: "Les données RouterOS viennent d'être relues.",
      id: "router",
      label: "Lecture RouterOS",
      missingMessage: "Le MikroTik n'a encore jamais été observé depuis cette installation.",
      nowMs,
      warningAfterMs: this.thresholds.routerWarningAfterMs,
      warningMessage: "La dernière lecture RouterOS commence à dater."
    });
    freshness.push(routerFreshness);
    if (routerFreshness.status !== "success") {
      alerts.push({
        code: routerObservedAt ? "ROUTER_DATA_STALE" : "ROUTER_DATA_MISSING",
        message: routerFreshness.message,
        status: routerFreshness.status,
        title: "Données du routeur"
      });
    }

    const ticketObservedAt = latestDate(
      input.liveTicketsObservedAt,
      ...tickets.map((ticket) => ticket.last_router_sync_at)
    );
    const ticketFreshness = tickets.length === 0
      ? freshnessItem("tickets", "Cache des tickets", null, "Aucun ticket local à synchroniser.", "success")
      : freshnessFromDate({
          checkedAt: ticketObservedAt,
          errorAfterMs: this.thresholds.ticketErrorAfterMs,
          errorMessage: "Le cache local des tickets n'a pas été confirmé récemment.",
          freshMessage: "Les tickets ont été comparés récemment avec RouterOS.",
          id: "tickets",
          label: "Cache des tickets",
          missingMessage: "Aucun ticket local n'a encore été confirmé par RouterOS.",
          nowMs,
          warningAfterMs: this.thresholds.ticketWarningAfterMs,
          warningMessage: "La confirmation RouterOS des tickets commence à dater."
        });
    freshness.push(ticketFreshness);
    if (ticketFreshness.status !== "success") {
      alerts.push({
        code: ticketObservedAt ? "TICKET_CACHE_STALE" : "TICKET_CACHE_INCOMPLETE",
        message: ticketFreshness.message,
        status: ticketFreshness.status,
        title: "Synchronisation des tickets"
      });
    }

    const manifestFreshness = storedManifest
      ? freshnessFromDate({
          checkedAt: storedManifest.record.observed_at,
          errorAfterMs: this.thresholds.manifestErrorAfterMs,
          errorMessage: "Le manifeste de configuration RouterOS est trop ancien.",
          freshMessage: "Le manifeste de configuration RouterOS est récent.",
          id: "manifest",
          label: "Configuration gérée",
          missingMessage: "Aucun manifeste RouterOS n'est disponible.",
          nowMs,
          warningAfterMs: this.thresholds.manifestWarningAfterMs,
          warningMessage: "Le manifeste RouterOS doit être revérifié."
        })
      : freshnessItem(
          "manifest",
          "Configuration gérée",
          null,
          "Aucun audit de configuration RouterOS n'a encore été enregistré.",
          "warning"
        );
    freshness.push(manifestFreshness);
    if (!storedManifest) {
      alerts.push({
        code: "MANIFEST_MISSING",
        message: manifestFreshness.message,
        status: "warning",
        title: "Audit RouterOS absent"
      });
    } else if (storedManifest.record.status === "error") {
      alerts.push({
        code: "MANIFEST_ERROR",
        message: storedManifest.record.last_error ?? "Le dernier audit RouterOS a échoué.",
        status: "error",
        title: "Audit RouterOS en erreur"
      });
    } else if (storedManifest.record.status === "drift") {
      const driftResources = storedManifest.manifest.resources.filter((resource) => resource.state !== "present");
      const driftCount = driftResources.length;
      const hotspotProfiles = driftResources
        .filter((resource) => resource.kind === "hotspot_user_profile_extension")
        .map((resource) => String(resource.attributes.profileName ?? "").trim())
        .filter(Boolean);
      alerts.push({
        code: "MANIFEST_DRIFT",
        message: hotspotProfiles.length > 0
          ? `${driftCount} ressource(s) gérée(s) diffèrent de l'état attendu. Profils concernés : ${hotspotProfiles.join(", ")}.`
          : `${driftCount} ressource(s) gérée(s) diffèrent de l'état attendu.`,
        status: "warning",
        title: "Dérive de configuration détectée"
      });
    }
    if (storedManifest?.manifest.warnings.length) {
      alerts.push({
        code: "MANIFEST_WARNING",
        message: storedManifest.manifest.warnings.join(" · "),
        status: "warning",
        title: "Avertissement RouterOS"
      });
    }

    addQueueAlerts(alerts, queue, nowMs, this.thresholds);
    addLocalVoucherAlerts(alerts, tickets);
    const routerPeers = peers.filter((peer) => peer.router_id === router.id || peer.resource_id === router.id);
    freshness.push(addVpnAlerts(
      alerts,
      router,
      routerPeers,
      peers,
      input.liveRouterObservedAt ?? null,
      nowMs,
      this.thresholds
    ));

    const status = overallStatus(alerts);
    const incidents = queuedOperations
      .filter((operation) => operation.router_id === input.routerId)
      .filter((operation) => operation.status !== "succeeded" && operation.status !== "cancelled")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 10)
      .map((operation): SyncOperationIncident => ({
        aggregateId: operation.aggregate_id,
        code: operation.last_error_code,
        correlationId: operation.correlation_id,
        message: operation.last_error_message,
        operationType: operation.operation_type,
        status: operation.status,
        updatedAt: operation.updated_at
      }));
    return {
      alerts,
      checkedAt,
      freshness,
      incidents,
      queue,
      status,
      statusLabel: status === "error"
        ? "Action requise"
        : status === "warning"
          ? "À surveiller"
          : "Synchronisation saine"
    };
  }
}

function addQueueAlerts(
  alerts: SyncDiagnosticAlert[],
  queue: SyncOutboxHealth,
  nowMs: number,
  thresholds: SyncObservabilityThresholds
): void {
  if (queue.failed > 0) {
    alerts.push({ code: "OUTBOX_FAILED", message: `${queue.failed} opération(s) ont atteint leur limite de tentatives.`, status: "error", title: "Synchronisation en échec" });
  }
  if (queue.conflict > 0) {
    alerts.push({ code: "OUTBOX_CONFLICT", message: `${queue.conflict} conflit(s) nécessitent une vérification.`, status: "error", title: "Conflit de synchronisation" });
  }
  if (queue.retry > 0) {
    alerts.push({ code: "OUTBOX_RETRY", message: `${queue.retry} opération(s) seront reprises automatiquement.`, status: "warning", title: "Reprise en attente" });
  }
  const oldestPendingMs = parseDate(queue.oldestPendingAt);
  if (oldestPendingMs === null) return;
  const ageMs = Math.max(0, nowMs - oldestPendingMs);
  if (ageMs >= thresholds.outboxErrorAfterMs) {
    alerts.push({ code: "OUTBOX_BACKLOG", message: `Une opération attend depuis ${formatAge(ageMs)}.`, status: "error", title: "File de synchronisation bloquée" });
  } else if (ageMs >= thresholds.outboxWarningAfterMs) {
    alerts.push({ code: "OUTBOX_BACKLOG", message: `Une opération attend depuis ${formatAge(ageMs)}.`, status: "warning", title: "File de synchronisation ralentie" });
  }
}

function addLocalVoucherAlerts(alerts: SyncDiagnosticAlert[], tickets: TicketRecord[]): void {
  const usernames = groupDuplicates(tickets.map((ticket) => ticket.username.trim().toLowerCase()).filter(Boolean));
  if (usernames.length > 0) {
    alerts.push({
      code: "DUPLICATE_LOCAL_VOUCHER",
      message: `${usernames.length} identifiant(s) de voucher sont présents plusieurs fois localement.`,
      status: "error",
      title: "Doublons de vouchers"
    });
  }
  const malformedStatuses = tickets.filter((ticket) => hasBrokenEncoding(ticket.status)).length;
  if (malformedStatuses > 0) {
    alerts.push({
      code: "LEGACY_STATUS_ENCODING",
      message: `${malformedStatuses} ancien(s) statut(s) doivent être normalisés sans modifier le voucher RouterOS.`,
      status: "warning",
      title: "Anciennes données mal encodées"
    });
  }
}

function addVpnAlerts(
  alerts: SyncDiagnosticAlert[],
  router: RouterRecord,
  routerPeers: VpnPeerRecord[],
  allPeers: VpnPeerRecord[],
  liveRouterObservedAt: string | null,
  nowMs: number,
  thresholds: SyncObservabilityThresholds
): SyncFreshnessItem {
  const activePeers = allPeers.filter((peer) => peer.status !== "revoked");
  const duplicateAddresses = groupDuplicates(activePeers.map((peer) => peer.assigned_address));
  const duplicatePublicKeys = groupDuplicates(activePeers.map((peer) => peer.public_key));
  if (duplicateAddresses.length > 0 || duplicatePublicKeys.length > 0) {
    alerts.push({
      code: "DUPLICATE_VPN_ASSIGNMENT",
      message: "Au moins deux pairs VPN actifs partagent une adresse ou une clé publique.",
      status: "error",
      title: "Conflit d'identité VPN"
    });
  }

  if (router.connection_mode !== "vpn") {
    return freshnessItem("vpn", "Accès distant", null, "Ce routeur utilise prioritairement une connexion locale.", "success");
  }
  const liveRouterObservedMs = parseDate(liveRouterObservedAt);
  if (
    liveRouterObservedMs !== null
    && Math.max(0, nowMs - liveRouterObservedMs) < thresholds.routerWarningAfterMs
  ) {
    return freshnessItem(
      "vpn",
      "Accès distant",
      liveRouterObservedAt,
      "Accès distant confirmé par une lecture RouterOS réelle.",
      "success"
    );
  }
  const peer = routerPeers.find((candidate) => candidate.status === "active")
    ?? routerPeers.find((candidate) => candidate.status === "draft");
  if (!peer) {
    alerts.push({ code: "VPN_PEER_MISSING", message: "Aucun pair VPN actif n'est associé à ce routeur.", status: "error", title: "Accès distant indisponible" });
    return freshnessItem("vpn", "Accès distant", null, "Pair VPN absent ou révoqué.", "error");
  }
  if (peer.status === "draft") {
    alerts.push({ code: "VPN_PEER_DRAFT", message: "Le pair du routeur n'est pas encore confirmé actif.", status: "warning", title: "Accès distant en préparation" });
    return freshnessItem("vpn", "Accès distant", peer.updated_at, "Le pair VPN est encore en brouillon.", "warning");
  }
  const handshakeMs = parseDate(peer.last_handshake_at);
  if (handshakeMs !== null && nowMs - handshakeMs >= thresholds.vpnHandshakeWarningAfterMs) {
    alerts.push({ code: "VPN_PEER_STALE", message: `Le dernier handshake historisé date de ${formatAge(nowMs - handshakeMs)}.`, status: "warning", title: "Handshake VPN ancien" });
    return freshnessItem("vpn", "Accès distant", peer.last_handshake_at, "Le dernier handshake historisé doit être revérifié.", "warning");
  }
  return freshnessItem(
    "vpn",
    "Accès distant",
    peer.last_handshake_at ?? peer.updated_at,
    peer.last_handshake_at ? "Le pair VPN est actif et son handshake est récent." : "Le pair VPN est actif ; le handshake n'est pas historisé localement.",
    "success"
  );
}

function freshnessFromDate(input: {
  checkedAt: string | null;
  errorAfterMs: number;
  errorMessage: string;
  freshMessage: string;
  id: SyncFreshnessItem["id"];
  label: string;
  missingMessage: string;
  nowMs: number;
  warningAfterMs: number;
  warningMessage: string;
}): SyncFreshnessItem {
  const checkedAtMs = parseDate(input.checkedAt);
  if (checkedAtMs === null) return freshnessItem(input.id, input.label, null, input.missingMessage, "warning");
  const ageMs = Math.max(0, input.nowMs - checkedAtMs);
  if (ageMs >= input.errorAfterMs) return freshnessItem(input.id, input.label, input.checkedAt, `${input.errorMessage} Dernière lecture : ${formatAge(ageMs)}.`, "error");
  if (ageMs >= input.warningAfterMs) return freshnessItem(input.id, input.label, input.checkedAt, `${input.warningMessage} Dernière lecture : ${formatAge(ageMs)}.`, "warning");
  return freshnessItem(input.id, input.label, input.checkedAt, input.freshMessage, "success");
}

function freshnessItem(
  id: SyncFreshnessItem["id"],
  label: string,
  checkedAt: string | null,
  message: string,
  status: SyncFreshnessItem["status"]
): SyncFreshnessItem {
  return { checkedAt, id, label, message, status };
}

function latestDate(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => parseDate(value) !== null)
    .sort((left, right) => (parseDate(right) ?? 0) - (parseDate(left) ?? 0))[0] ?? null;
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function hasBrokenEncoding(value: string): boolean {
  return /(?:Ã.|Â.|â.|ï¿½|�)/u.test(value);
}

function overallStatus(alerts: SyncDiagnosticAlert[]): SyncObservabilityReport["status"] {
  if (alerts.some((alert) => alert.status === "error")) return "error";
  if (alerts.some((alert) => alert.status === "warning")) return "warning";
  return "success";
}

function formatAge(ageMs: number): string {
  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function isTerminalSyncOutboxStatus(status: SyncOutboxStatus): boolean {
  return status === "cancelled" || status === "conflict" || status === "failed" || status === "succeeded";
}
