import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Ban,
  Calendar,
  Clock,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Hash,
  History,
  KeyRound,
  Layers,
  Printer,
  RefreshCw,
  Router,
  Search,
  ShieldCheck,
  Smartphone,
  Ticket,
  Trash2,
  Upload,
  UserRound
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { UserRole } from "../../domain/auth";
import { resolveTicketPdfPassword } from "../../services/pdf";
import {
  LocalPrintService,
  printFormatLabel,
  type LocalPrinter,
  type PrintHistoryEntry,
  type PrintSettings
} from "../../services/printing";
import { FakeRouterAdapter, RouterService } from "../../services/router";
import {
  RouterTicketSyncService,
  syncStatusLabel,
  type RouterTicketSyncStatus,
  type TicketSyncReport,
  type TicketSyncSummary
} from "../../services/sync";
import { ActionMenu, Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  buildTicketLifecycleLogs,
  canDeleteTicket,
  createDemoTickets,
  emptyTicketFilters,
  filterTickets,
  formatBytes,
  formatDataLimit,
  formatDateTime,
  formatDuration,
  getPageCount,
  paginateTickets,
  scopeTicketsForSession,
  ticketPageSize,
  ticketStatusLabel,
  ticketStatusToBadge,
  type TicketFilters,
  type TicketListItem,
  type TicketListStatus
} from "./ticketsPageModel";

type TicketLog = {
  createdAt: string;
  message: string;
  ticketCode: string;
  type: "action" | "delete" | "sync";
};

export function TicketsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { routerId = "routeur-demo" } = useParams();
  const [tickets, setTickets] = useState<TicketListItem[]>(() => createDemoTickets());
  const [filters, setFilters] = useState<TicketFilters>(emptyTicketFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<TicketLog[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketListItem | null>(null);
  const [printers, setPrinters] = useState<LocalPrinter[]>([]);
  const [printHistory, setPrintHistory] = useState<PrintHistoryEntry[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    economical: true,
    format: "thermal80",
    printerId: "pdf-export"
  });
  const [syncSummary, setSyncSummary] = useState<TicketSyncSummary | null>(null);
  const printService = useMemo(() => new LocalPrintService(), []);
  const routerService = useMemo(
    () => new RouterService({ adapter: new FakeRouterAdapter({ latencyMs: 0 }), authSession: session }),
    [session]
  );
  const syncService = useMemo(() => new RouterTicketSyncService(routerService), [routerService]);

  useEffect(() => {
    let mounted = true;

    async function loadPrinters() {
      const printerList = await printService.detectPrinters();
      const defaultPrinter = printService.getDefaultPrinter(printerList);

      if (!mounted) {
        return;
      }

      setPrinters(printerList);
      setPrintSettings((current) => ({ ...current, printerId: defaultPrinter?.id ?? current.printerId }));
    }

    void loadPrinters();

    return () => {
      mounted = false;
    };
  }, [printService]);

  const scopedTickets = useMemo(() => scopeTicketsForSession(tickets, session), [session, tickets]);
  const filterOptions = useMemo(() => buildFilterOptions(scopedTickets), [scopedTickets]);
  const filteredTickets = useMemo(() => filterTickets(scopedTickets, filters), [filters, scopedTickets]);
  const pageCount = getPageCount(filteredTickets.length, ticketPageSize);
  const currentPage = Math.min(page, pageCount);
  const visibleTickets = paginateTickets(filteredTickets, currentPage, ticketPageSize);

  const updateFilters = (partial: Partial<TicketFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setPage(1);
    setMessage(null);
  };

  const writeLog = (log: Omit<TicketLog, "createdAt">) => {
    setLogs((current) => [{ ...log, createdAt: new Date().toISOString() }, ...current]);
  };

  const updateTicket = (ticketId: string, updater: (ticket: TicketListItem) => TicketListItem) => {
    setTickets((current) => current.map((item) => (item.id === ticketId ? updater(item) : item)));
    setSelectedTicket((current) => (current?.id === ticketId ? updater(current) : current));
  };

  const markPrinted = (ticket: TicketListItem) => {
    updateTicket(ticket.id, (item) => ({ ...item, printedCount: item.printedCount + 1, status: "imprimé" }));
    setMessage(`${ticket.code} marqué comme imprimé.`);
    writeLog({ message: "Ticket marqué comme imprimé.", ticketCode: ticket.code, type: "action" });
  };

  const disableTicket = (ticket: TicketListItem) => {
    if (ticket.status === "supprimé" || ticket.status === "complété") {
      setMessage("Action impossible sur ce ticket.");
      return;
    }

    updateTicket(ticket.id, (item) => ({ ...item, status: "expiré" }));
    setMessage(`${ticket.code} désactivé.`);
    writeLog({ message: "Ticket désactivé.", ticketCode: ticket.code, type: "action" });
  };

  const deleteTicket = (ticket: TicketListItem) => {
    if (!canDeleteTicket(ticket)) {
      setMessage("Suppression impossible : le ticket est déjà utilisé ou imprimé.");
      return;
    }

    updateTicket(ticket.id, (item) => ({ ...item, status: "supprimé" }));
    setMessage(`${ticket.code} supprimé.`);
    writeLog({ message: "Suppression contrôlée du ticket.", ticketCode: ticket.code, type: "delete" });
  };

  const syncTicket = async (ticket: TicketListItem) => {
    const report = await syncService.resyncTicket(ticket);
    applySyncReport(report);
    setMessage(`${ticket.code} resynchronisé.`);
  };

  const exportTicket = (ticket: TicketListItem) => {
    setMessage(`${ticket.code} prêt pour export.`);
    writeLog({ message: "Export demandé.", ticketCode: ticket.code, type: "action" });
  };

  const applySyncReport = (report: TicketSyncReport) => {
    setTickets((current) =>
      current.map((ticket) => {
        const update = report.updates.find((item) => item.id === ticket.id);

        return update
          ? {
              ...ticket,
              activatedAt: update.activatedAt === undefined ? ticket.activatedAt : update.activatedAt,
              ipAddress: update.ipAddress === undefined ? ticket.ipAddress : update.ipAddress,
              macAddress: update.macAddress === undefined ? ticket.macAddress : update.macAddress,
              mikrotikId: update.mikrotikId === undefined ? ticket.mikrotikId : update.mikrotikId,
              status: (update.status as TicketListStatus | undefined) ?? ticket.status,
              syncStatus: update.syncStatus
            }
          : ticket;
      })
    );
    setSelectedTicket((current) => {
      if (!current) {
        return null;
      }

      const update = report.updates.find((item) => item.id === current.id);

      return update
        ? {
            ...current,
            activatedAt: update.activatedAt === undefined ? current.activatedAt : update.activatedAt,
            ipAddress: update.ipAddress === undefined ? current.ipAddress : update.ipAddress,
            macAddress: update.macAddress === undefined ? current.macAddress : update.macAddress,
            mikrotikId: update.mikrotikId === undefined ? current.mikrotikId : update.mikrotikId,
            status: (update.status as TicketListStatus | undefined) ?? current.status,
            syncStatus: update.syncStatus
          }
        : current;
    });
    setSyncSummary(report.summary);
    report.logs.slice(0, 8).forEach((log) =>
      writeLog({ message: log.message, ticketCode: log.ticketCode ?? "-", type: "sync" })
    );
  };

  const syncAllTickets = async () => {
    const report = await syncService.compareTickets(scopedTickets);
    applySyncReport(report);
    setMessage(
      `${report.summary.routerSynced} synchronisé(s), ${report.summary.routerMissing} absent(s) du routeur, ${report.summary.localMissing} absent(s) localement.`
    );
  };

  const syncBatch = async (batchId: string) => {
    const report = await syncService.resyncBatch(scopedTickets, batchId);
    applySyncReport(report);
    setMessage(`Lot ${batchId} resynchronisé.`);
  };

  const resyncRouterTickets = async () => {
    const report = await syncService.resyncRouter(scopedTickets);
    applySyncReport(report);
    setMessage(
      `Resynchronisation terminée : ${report.summary.routerSynced} synchronisé(s), ${report.summary.error} erreur(s).`
    );
  };

  const resetFilters = () => {
    setFilters(emptyTicketFilters);
    setPage(1);
    setMessage(null);
  };

  const testPrinter = async () => {
    const printResult = await printService.testPrinter({ printers, settings: printSettings });
    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.userMessage);
    writeLog({ message: "Test imprimante demandé.", ticketCode: "-", type: "action" });
  };

  const reprintTicket = async (ticket: TicketListItem) => {
    const printResult = await printService.printTicket({
      printers,
      settings: printSettings,
      ticket: buildPrintTicketFromTicket(ticket)
    });

    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.ok ? `${ticket.code} envoyé vers la réimpression.` : printResult.userMessage);
    writeLog({ message: "Réimpression demandée.", ticketCode: ticket.code, type: "action" });

    if (printResult.ok) {
      updateTicket(ticket.id, (item) => ({ ...item, printedCount: item.printedCount + 1, status: "imprimé" }));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <div className="button-row">
            <Button icon={Ticket} onClick={() => navigate(`/routeurs/${routerId}/tickets/generation`)} size="large" variant="primary">
              Créer des tickets
            </Button>
            <Button icon={Download} onClick={() => setMessage("Export de la liste préparé.")}>
              Exporter
            </Button>
            <Button icon={RefreshCw} onClick={() => void syncAllTickets()}>
              Synchroniser
            </Button>
            {session?.internal_profile_role === "admin" ? (
              <Button icon={ShieldCheck} onClick={() => void resyncRouterTickets()} variant="secondary">
                Réparer absents
              </Button>
            ) : null}
          </div>
        }
        description="Retrouvez rapidement un ticket par code, date, plan, statut ou adresse MAC."
        eyebrow="Routeur"
        title="Tickets"
      />

      <Card>
        <div className="tickets-toolbar">
          <div className="tickets-count">
            <strong>Articles ({filteredTickets.length})</strong>
            <span>
              {scopedTickets.length} tickets visibles · Logs : {logs.length}
              {syncSummary ? ` · Sync : ${syncSummary.routerSynced}/${syncSummary.totalLocal}` : ""}
            </span>
          </div>
          <label className="date-field">
            Depuis
            <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
          </label>
          <label className="date-field">
            À
            <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
          </label>
          <label className="tickets-search">
            <Search aria-hidden="true" />
            <input
              placeholder="Code ticket"
              value={filters.code}
              onChange={(event) => updateFilters({ code: event.target.value })}
            />
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <TicketFiltersPanel
            filters={filters}
            options={filterOptions}
            onChange={updateFilters}
            onReset={resetFilters}
          />
        ) : null}
      </Card>

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card title="Préparation impression" description="Réglez l'impression thermique sans bloquer l'export PDF.">
        <div className="print-setup-grid">
          <label className="form-field">
            Imprimante
            <select value={printSettings.printerId} onChange={(event) => setPrintSettings((current) => ({ ...current, printerId: event.target.value }))}>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Format
            <select
              value={printSettings.format}
              onChange={(event) => setPrintSettings((current) => ({ ...current, format: event.target.value as PrintSettings["format"] }))}
            >
              <option value="thermal58">58 mm</option>
              <option value="thermal80">80 mm</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="toggle-option print-economy-toggle">
            <input
              checked={printSettings.economical}
              onChange={(event) => setPrintSettings((current) => ({ ...current, economical: event.target.checked }))}
              type="checkbox"
            />
            <Printer aria-hidden="true" />
            <span>Impression économique</span>
          </label>
          <Button icon={Printer} onClick={() => void testPrinter()}>
            Tester imprimante
          </Button>
        </div>
        {printHistory.length > 0 ? (
          <div className="print-history-inline">
            {printHistory.slice(0, 3).map((entry) => (
              <span key={entry.id}>
                {entry.userMessage} · {printFormatLabel(entry.format)}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="tickets-list-card">
        {visibleTickets.length > 0 ? (
          <div className="ticket-list">
            {visibleTickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                onDelete={() => deleteTicket(ticket)}
                onDisable={() => disableTicket(ticket)}
                onExport={() => exportTicket(ticket)}
                onMarkPrinted={() => markPrinted(ticket)}
                onReprint={() => reprintTicket(ticket)}
                onSyncBatch={() => void syncBatch(ticket.batchId)}
                onSync={() => void syncTicket(ticket)}
                onView={() => setSelectedTicket(ticket)}
                onOpen={() => setSelectedTicket(ticket)}
                role={session?.internal_profile_role ?? "guest"}
                ticket={ticket}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Button icon={Filter} onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            }
            description="Aucun ticket ne correspond aux critères."
            icon={Search}
            title="Aucun ticket trouvé"
          />
        )}

        <div className="pagination-row">
          <Button disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} variant="ghost">
            Précédent
          </Button>
          <span>
            Page {currentPage} / {pageCount}
          </span>
          <Button disabled={currentPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} variant="ghost">
            Suivant
          </Button>
        </div>
      </Card>

      <TicketDetailDialog
        actionLogs={logs}
        onClose={() => setSelectedTicket(null)}
        onDelete={deleteTicket}
        onDisable={disableTicket}
        onReprint={reprintTicket}
        onSync={(ticket) => void syncTicket(ticket)}
        role={session?.internal_profile_role ?? "guest"}
        ticket={selectedTicket}
      />
    </div>
  );
}

type TicketRowProps = {
  onDelete: () => void;
  onDisable: () => void;
  onExport: () => void;
  onMarkPrinted: () => void;
  onOpen: () => void;
  onReprint: () => void;
  onSyncBatch: () => void;
  onSync: () => void;
  onView: () => void;
  role: UserRole;
  ticket: TicketListItem;
};

function TicketRow({
  onDelete,
  onDisable,
  onExport,
  onMarkPrinted,
  onOpen,
  onReprint,
  onSyncBatch,
  onSync,
  onView,
  role,
  ticket
}: TicketRowProps) {
  const permissions = getTicketActionPermissions(role, ticket);
  const menuItems = [{ icon: Eye, label: "Voir détail", onSelect: onView }];

  if (permissions.canReprint) {
    menuItems.push({ icon: Printer, label: "Réimprimer", onSelect: onReprint });
    menuItems.push({ icon: CheckCircle2, label: "Marquer imprimé", onSelect: onMarkPrinted });
  }

  if (role !== "guest") {
    menuItems.push({ icon: Download, label: "Exporter", onSelect: onExport });
  }

  if (permissions.canDisable) {
    menuItems.push({ icon: Ban, label: "Désactiver", onSelect: onDisable });
  }

  if (permissions.canSync) {
    menuItems.push({ icon: RefreshCw, label: "Resynchroniser", onSelect: onSync });
    menuItems.push({ icon: Layers, label: "Resynchroniser le lot", onSelect: onSyncBatch });
  }

  if (permissions.canDelete) {
    menuItems.push({ icon: Trash2, label: "Supprimer", onSelect: onDelete });
  }

  return (
    <article
      className="ticket-row ticket-row--compact"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="ticket-row__identity">
        <span className="ticket-row__icon">
          <Ticket aria-hidden="true" />
        </span>
        <div className="ticket-row__body">
          <div className="ticket-row__top">
            <div className="ticket-row__code">
              <strong>{ticket.code}</strong>
              {ticket.hasPdf ? <FileText aria-label="PDF" /> : null}
            </div>
            <div className="ticket-row__badges">
              <Badge className="ticket-row__badge" status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
              <Badge className="ticket-row__badge" status={syncStatusToBadge(ticket.syncStatus)}>{syncStatusLabel(ticket.syncStatus)}</Badge>
              {ticket.status === "complété" ? <Badge className="ticket-row__badge" status="active">Complété</Badge> : null}
            </div>
          </div>
          <div className="ticket-row__facts">
            <span><FileText aria-hidden="true" />{ticket.planName}</span>
            <span><Calendar aria-hidden="true" />{formatDateTime(ticket.createdAt)}</span>
            {ticket.macAddress ? <span><Smartphone aria-hidden="true" />{ticket.macAddress}</span> : null}
          </div>
        </div>
      </div>

      <ActionMenu items={menuItems} />
    </article>
  );
}

type TicketDetailDialogProps = {
  actionLogs: TicketLog[];
  onClose: () => void;
  onDelete: (ticket: TicketListItem) => void;
  onDisable: (ticket: TicketListItem) => void;
  onReprint: (ticket: TicketListItem) => void;
  onSync: (ticket: TicketListItem) => void;
  role: UserRole;
  ticket: TicketListItem | null;
};

function TicketDetailDialog({
  actionLogs,
  onClose,
  onDelete,
  onDisable,
  onReprint,
  onSync,
  role,
  ticket
}: TicketDetailDialogProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    setPasswordVisible(false);
  }, [ticket?.id]);

  if (!ticket) {
    return null;
  }

  const permissions = getTicketActionPermissions(role, ticket);
  const lifecycleLogs = buildTicketLifecycleLogs(ticket);
  const relatedActionLogs = actionLogs
    .filter((log) => log.ticketCode === ticket.code)
    .map((log, index) => ({
      createdAt: log.createdAt,
      id: `${ticket.id}-action-${index}`,
      level: log.type === "delete" ? "warning" : "info",
      message: log.message
    }));
  const logs = [...lifecycleLogs, ...relatedActionLogs].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const passwordValue = passwordVisible && permissions.canRevealPassword ? ticket.code : "••••••";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog ticket-detail-dialog" role="dialog">
        <header className="ticket-detail-header">
          <div className="ticket-detail-header__identity">
            <div className="router-card__icon">
              <Ticket aria-hidden="true" />
            </div>
            <div>
              <p className="ticket-detail-header__eyebrow">Détail ticket</p>
              <h2>{ticket.code}</h2>
              <p>{ticket.planName} · {ticket.routerName}</p>
            </div>
          </div>
          <Badge status={ticketStatusToBadge(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
        </header>

        <div className="ticket-detail-layout">
          <section className="ticket-detail-section">
            <h3>Informations principales</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Ticket} label="Code" value={ticket.code} />
              <PasswordDetailLine
                canReveal={permissions.canRevealPassword}
                isVisible={passwordVisible}
                onToggle={() => setPasswordVisible((current) => !current)}
                value={passwordValue}
              />
              <DetailLine icon={FileText} label="Plan" value={ticket.planName} />
              <DetailLine icon={Router} label="Routeur" value={ticket.routerName} />
              <DetailLine icon={Layers} label="Lot" value={ticket.batchId} />
              <DetailLine icon={ShieldCheck} label="Statut" value={ticketStatusLabel(ticket.status)} />
              <DetailLine icon={RefreshCw} label="Synchronisation" value={syncStatusLabel(ticket.syncStatus)} />
              <DetailLine icon={UserRound} label="Créé par" value={profileLabel(ticket.operatorProfile)} />
              <DetailLine icon={Hash} label="ID MikroTik" value={ticket.mikrotikId ?? "Non disponible"} />
            </dl>
          </section>

          <section className="ticket-detail-section">
            <h3>Cycle de vie</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Calendar} label="Date création" value={formatDateTime(ticket.createdAt)} />
              <DetailLine icon={CheckCircle2} label="Date activation" value={formatDateTime(ticket.activatedAt)} />
              <DetailLine icon={CheckCircle2} label="Date complétion" value={formatDateTime(ticket.completedAt)} />
              <DetailLine icon={Clock} label="Date expiration" value={formatDateTime(ticket.expiresAt)} />
              <DetailLine icon={Clock} label="Durée" value={formatDuration(ticket.planDurationMinutes)} />
              <DetailLine icon={Clock} label="Validité" value={formatDuration(ticket.planValidityMinutes)} />
              <DetailLine icon={Database} label="Volume prévu" value={formatDataLimit(ticket.dataLimitMb)} />
            </dl>
          </section>

          <section className="ticket-detail-section">
            <h3>Utilisation client</h3>
            <dl className="ticket-detail-grid">
              <DetailLine icon={Smartphone} label="MAC client" value={ticket.macAddress ?? "Non disponible"} />
              <DetailLine icon={Smartphone} label="IP client" value={ticket.ipAddress ?? "Non disponible"} />
              <DetailLine icon={Upload} label="Upload" value={formatBytes(ticket.uploadedBytes)} />
              <DetailLine icon={Download} label="Download" value={formatBytes(ticket.downloadedBytes)} />
              <DetailLine icon={Printer} label="Impressions" value={`${ticket.printedCount}`} />
              <DetailLine icon={FileText} label="Fichier PDF" value={ticket.generatedFileName ?? "Non disponible"} />
            </dl>
          </section>

          <section className="ticket-detail-section ticket-detail-section--logs">
            <h3>Historique</h3>
            <div className="ticket-log-list">
              {logs.map((log) => (
                <div className={`ticket-log ticket-log--${log.level}`} key={log.id}>
                  <History aria-hidden="true" />
                  <div>
                    <strong>{formatDateTime(log.createdAt)}</strong>
                    <span>{log.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="ticket-detail-actions">
          {permissions.canReprint ? <Button icon={Printer} onClick={() => onReprint(ticket)}>Réimprimer</Button> : null}
          {permissions.canDisable ? <Button icon={Ban} onClick={() => onDisable(ticket)} variant="ghost">Désactiver</Button> : null}
          {permissions.canSync ? <Button icon={RefreshCw} onClick={() => onSync(ticket)} variant="ghost">Resynchroniser</Button> : null}
          {permissions.canDelete ? <Button icon={Trash2} onClick={() => onDelete(ticket)} variant="danger">Supprimer</Button> : null}
          <Button onClick={onClose} variant="primary">Fermer</Button>
        </div>
      </section>
    </div>
  );
}

function DetailLine({ icon: Icon, label, value }: { icon: IconComponent; label: string; value: string }) {
  return (
    <div>
      <dt>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function PasswordDetailLine({
  canReveal,
  isVisible,
  onToggle,
  value
}: {
  canReveal: boolean;
  isVisible: boolean;
  onToggle: () => void;
  value: string;
}) {
  return (
    <div>
      <dt>
        <KeyRound aria-hidden="true" />
        <span>Mot de passe</span>
      </dt>
      <dd className="ticket-password-value">
        <span>{value}</span>
        {canReveal ? (
          <button aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={onToggle} type="button">
            {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        ) : (
          <small>Masqué</small>
        )}
      </dd>
    </div>
  );
}

function getTicketActionPermissions(role: UserRole, ticket: TicketListItem) {
  if (role === "admin") {
    return {
      canDelete: canDeleteTicket(ticket),
      canDisable: ticket.status !== "supprimé" && ticket.status !== "complété",
      canRevealPassword: true,
      canReprint: true,
      canSync: true
    };
  }

  if (role === "operator") {
    return {
      canDelete: false,
      canDisable: false,
      canRevealPassword: false,
      canReprint: true,
      canSync: false
    };
  }

  if (role === "agent") {
    return {
      canDelete: false,
      canDisable: false,
      canRevealPassword: false,
      canReprint: ticket.operatorProfile === "agent",
      canSync: false
    };
  }

  return {
    canDelete: false,
    canDisable: false,
    canRevealPassword: false,
    canReprint: false,
    canSync: false
  };
}

function syncStatusToBadge(status: RouterTicketSyncStatus): AppStatus {
  if (status === "router_synced") {
    return "success";
  }

  if (status === "error") {
    return "error";
  }

  if (status === "conflict" || status === "local_missing" || status === "router_missing") {
    return "warning";
  }

  return "offline";
}

function buildPrintTicketFromTicket(ticket: TicketListItem) {
  return {
    batchId: ticket.batchId,
    code: ticket.code,
    dataLimitLabel: formatDataLimit(ticket.dataLimitMb),
    durationLabel: formatDuration(ticket.planDurationMinutes),
    id: ticket.id,
    passwordLabel: resolveTicketPdfPassword({
      passwordSecretRef: ticket.passwordSecretRef,
      username: ticket.code
    }),
    planName: ticket.planName,
    zoneName: ticket.routerName
  };
}

type FilterOptions = {
  batches: string[];
  operators: string[];
  plans: Array<{ id: string; name: string }>;
  routers: Array<{ id: string; name: string }>;
  statuses: TicketListStatus[];
};

function TicketFiltersPanel({
  filters,
  onChange,
  onReset,
  options
}: {
  filters: TicketFilters;
  onChange: (partial: Partial<TicketFilters>) => void;
  onReset: () => void;
  options: FilterOptions;
}) {
  return (
    <div className="tickets-filter-panel">
      <label className="form-field">
        Plan
        <select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}>
          <option value="">Tous les plans</option>
          {options.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Profil
        <select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}>
          <option value="">Tous les profils</option>
          {options.operators.map((operator) => (
            <option key={operator} value={operator}>
              {profileLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Statut
        <select value={filters.status} onChange={(event) => onChange({ status: event.target.value as TicketFilters["status"] })}>
          <option value="">Tous les statuts</option>
          {options.statuses.map((status) => (
            <option key={status} value={status}>
              {ticketStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Lot
        <select value={filters.batchId} onChange={(event) => onChange({ batchId: event.target.value })}>
          <option value="">Tous les lots</option>
          {options.batches.map((batch) => (
            <option key={batch} value={batch}>
              {batch}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Routeur
        <select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}>
          <option value="">Tous les routeurs</option>
          {options.routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Recherche MAC
        <input placeholder="A8:6B..." value={filters.macAddress} onChange={(event) => onChange({ macAddress: event.target.value })} />
      </label>
      <div className="tickets-filter-panel__actions">
        <Button onClick={onReset} variant="ghost">
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}

function buildFilterOptions(tickets: TicketListItem[]): FilterOptions {
  return {
    batches: unique(tickets.map((ticket) => ticket.batchId)),
    operators: unique(tickets.map((ticket) => ticket.operatorProfile)),
    plans: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.planId, name: ticket.planName })),
      (plan) => plan.id
    ),
    routers: uniqueBy(
      tickets.map((ticket) => ({ id: ticket.routerId, name: ticket.routerName })),
      (router) => router.id
    ),
    statuses: unique(tickets.map((ticket) => ticket.status))
  };
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const map = new Map<string, T>();

  values.forEach((value) => {
    map.set(getKey(value), value);
  });

  return Array.from(map.values());
}

function profileLabel(profile: string): string {
  const labels: Record<string, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[profile] ?? profile;
}
