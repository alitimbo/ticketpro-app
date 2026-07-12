import { useMemo, useState } from "react";
import { CheckCircle2, Eye, FileDown, FileText, Plus, XCircle } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { generateInvoicePdf } from "../../services/pdf";
import { ActionMenu, Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader } from "../../shared/ui";
import {
  cancelInvoice,
  createManualInvoice,
  formatInvoiceDate,
  formatInvoicePeriod,
  getInvoiceDetail,
  invoiceStatusBadge,
  invoiceStatusLabel,
  listInvoices,
  markInvoicePaid,
  type InvoiceDetail
} from "./invoicesPageModel";
import { formatCfa } from "./subscriptionPageModel";

export function InvoicesPage() {
  const { accountSession, session } = useAuth();
  const isAdmin = session?.internal_profile_role === "admin";
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<string | null>(null);
  const invoices = useMemo(() => listInvoices(), [refreshKey]);
  const selectedDetail = useMemo<InvoiceDetail | null>(
    () => (selectedInvoiceId ? getInvoiceDetail(selectedInvoiceId) : null),
    [selectedInvoiceId, refreshKey]
  );

  const refresh = () => setRefreshKey((current) => current + 1);

  const createInvoice = () => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de créer une facture.");
      return;
    }

    createManualInvoice();
    refresh();
    setMessage("Facture manuelle créée en brouillon.");
  };

  const markPaid = (invoiceId: string) => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de modifier les factures.");
      return;
    }

    markInvoicePaid(invoiceId);
    refresh();
    setMessage("Facture marquée comme payée en mode manuel.");
  };

  const confirmCancel = () => {
    if (!invoiceToCancel) {
      return;
    }

    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission d'annuler une facture.");
      setInvoiceToCancel(null);
      return;
    }

    cancelInvoice(invoiceToCancel);
    refresh();
    setInvoiceToCancel(null);
    setMessage("Facture annulée.");
  };

  const exportPdf = (detail: InvoiceDetail) => {
    const bytes = generateInvoicePdf({
      accountEmail: detail.accountEmail,
      accountName: detail.accountName,
      amountLabel: formatCfa(detail.invoice.amountCfa),
      dueAtLabel: formatInvoiceDate(detail.invoice.dueAt),
      invoiceNumber: detail.invoice.invoiceNumber,
      issuedAtLabel: formatInvoiceDate(detail.invoice.issuedAt),
      notes: detail.invoice.notes,
      packName: detail.packName,
      paidAtLabel: formatInvoiceDate(detail.invoice.paidAt),
      periodLabel: detail.periodLabel,
      routerLimit: detail.invoice.routerLimit,
      statusLabel: invoiceStatusLabel(detail.invoice.status)
    });
    downloadPdf(`${detail.invoice.invoiceNumber}.pdf`, bytes);
    setMessage("PDF de facture généré.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={createInvoice} variant="primary">
              Créer facture manuelle
            </Button>
          ) : null
        }
        description="Facturation de l'abonnement logiciel uniquement. Aucun paiement en ligne ni vente de tickets WiFi."
        eyebrow="Global"
        title="Factures"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card title={`Factures (${invoices.length})`} description={`Compte connecté : ${accountSession?.email ?? "non renseigné"}`}>
        {invoices.length === 0 ? (
          <EmptyState description="Aucune facture d'abonnement logiciel pour le moment." icon={FileText} title="Aucune facture" />
        ) : (
          <div className="invoice-table" role="table" aria-label="Factures d'abonnement logiciel">
            <div className="invoice-table__header" role="row">
              <span>Numéro</span>
              <span>Période</span>
              <span>Pack</span>
              <span>Montant</span>
              <span>Statut</span>
              <span>Émission</span>
              <span>Échéance</span>
              <span>Paiement</span>
              <span>Actions</span>
            </div>
            {invoices.map((invoice) => {
              const detail = getInvoiceDetail(invoice.id);

              return (
                <article className="invoice-table__row" key={invoice.id} role="row">
                  <strong>{invoice.invoiceNumber}</strong>
                  <span>{formatInvoicePeriod(invoice)}</span>
                  <span>{invoice.packName}</span>
                  <span>{formatCfa(invoice.amountCfa)}</span>
                  <span>
                    <Badge status={invoiceStatusBadge(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
                  </span>
                  <span>{formatInvoiceDate(invoice.issuedAt)}</span>
                  <span>{formatInvoiceDate(invoice.dueAt)}</span>
                  <span>{formatInvoiceDate(invoice.paidAt)}</span>
                  <ActionMenu
                    items={[
                      { icon: Eye, label: "Voir détail", onSelect: () => setSelectedInvoiceId(invoice.id) },
                      {
                        icon: FileDown,
                        label: "Exporter PDF",
                        onSelect: () => {
                          if (detail) {
                            exportPdf(detail);
                          }
                        }
                      },
                      {
                        icon: CheckCircle2,
                        label: "Marquer payée",
                        onSelect: () => markPaid(invoice.id)
                      },
                      {
                        icon: XCircle,
                        label: "Annuler",
                        onSelect: () => setInvoiceToCancel(invoice.id)
                      }
                    ].filter((item) => isAdmin || item.label === "Voir détail" || item.label === "Exporter PDF")}
                  />
                </article>
              );
            })}
          </div>
        )}
      </Card>

      {selectedDetail ? (
        <InvoiceDetailDialog
          detail={selectedDetail}
          isAdmin={isAdmin}
          onCancelInvoice={() => setInvoiceToCancel(selectedDetail.invoice.id)}
          onClose={() => setSelectedInvoiceId(null)}
          onExport={() => exportPdf(selectedDetail)}
          onMarkPaid={() => markPaid(selectedDetail.invoice.id)}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel="Annuler la facture"
        description="Cette action marque la facture comme annulée. Aucun fichier local n'est supprimé."
        isOpen={Boolean(invoiceToCancel)}
        onCancel={() => setInvoiceToCancel(null)}
        onConfirm={confirmCancel}
        title="Annuler cette facture ?"
      />
    </div>
  );
}

function InvoiceDetailDialog({
  detail,
  isAdmin,
  onCancelInvoice,
  onClose,
  onExport,
  onMarkPaid
}: {
  detail: InvoiceDetail;
  isAdmin: boolean;
  onCancelInvoice: () => void;
  onClose: () => void;
  onExport: () => void;
  onMarkPaid: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="invoice-detail-dialog" role="dialog">
        <div className="connection-dialog__header">
          <div>
            <p>Facture abonnement logiciel</p>
            <h2>{detail.invoice.invoiceNumber}</h2>
          </div>
          <Badge status={invoiceStatusBadge(detail.invoice.status)}>{invoiceStatusLabel(detail.invoice.status)}</Badge>
        </div>

        <div className="invoice-detail-grid">
          <DetailLine label="Entreprise" value={detail.accountName} />
          <DetailLine label="Email compte" value={detail.accountEmail} />
          <DetailLine label="Pack" value={detail.packName} />
          <DetailLine label="Routeurs inclus" value={String(detail.invoice.routerLimit)} />
          <DetailLine label="Montant" value={formatCfa(detail.invoice.amountCfa)} />
          <DetailLine label="Période" value={detail.periodLabel} />
          <DetailLine label="Statut" value={invoiceStatusLabel(detail.invoice.status)} />
          <DetailLine label="Émission" value={formatInvoiceDate(detail.invoice.issuedAt)} />
          <DetailLine label="Échéance" value={formatInvoiceDate(detail.invoice.dueAt)} />
          <DetailLine label="Paiement" value={formatInvoiceDate(detail.invoice.paidAt)} />
          <DetailLine label="Notes" value={detail.invoice.notes ?? "Aucune note."} />
        </div>

        <p className="invoice-scope-note">Ce module ne gère pas les paiements en ligne, Mobile Money ou la vente de tickets WiFi.</p>

        <div className="confirm-dialog__actions">
          <Button icon={FileDown} onClick={onExport} variant="secondary">
            Exporter PDF
          </Button>
          {isAdmin ? (
            <>
              <Button icon={CheckCircle2} onClick={onMarkPaid} variant="secondary">
                Marquer payée
              </Button>
              <Button icon={XCircle} onClick={onCancelInvoice} variant="ghost">
                Annuler facture
              </Button>
            </>
          ) : null}
          <Button onClick={onClose} variant="primary">
            Fermer
          </Button>
        </div>
      </section>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="invoice-detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function downloadPdf(fileName: string, bytes: Uint8Array) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
