import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CreditCard, FileDown, ReceiptText, RefreshCw } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import { TauriFileService } from "../../services/files";
import { generateInvoicePdf } from "../../services/pdf";
import { listSaasInvoices, type SaasInvoice } from "../../services/saas";
import { Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";
import {
  describeInvoiceSubscription,
  formatInvoiceAmount,
  formatInvoicePeriod,
  invoicePdfFileName,
  invoicePdfInput
} from "./invoicesPageModel";
import { formatDate } from "./subscriptionPageModel";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; invoices: SaasInvoice[] };

/**
 * Invoices of the organization's paid TicketPro subscriptions, issued by the
 * TicketPro server after each successful payment. Read-only: one invoice per
 * payment, downloadable as PDF at any time.
 */
export function InvoicesPage() {
  const { saasAccount } = useAuth();
  const { isPersistent } = useAppDatabase();
  const fileService = useMemo(() => new TauriFileService(), []);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const isOwner = saasAccount?.user.role === "owner";

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ invoices: await listSaasInvoices(), status: "ready" });
    } catch (error) {
      setState({
        message: error instanceof Error && error.message
          ? error.message
          : "Les factures n'ont pas pu être chargées.",
        status: "error"
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (invoice: SaasInvoice) => {
    setDownloadingId(invoice.id);
    setNotice(null);
    try {
      const bytes = generateInvoicePdf(invoicePdfInput(invoice));
      const fileName = invoicePdfFileName(invoice);
      if (isPersistent) {
        const relativePath = `files/invoices/${fileName}`;
        await fileService.writeBytes(relativePath, bytes);
        await fileService.open(relativePath).catch(() => undefined);
        setNotice({ kind: "success", text: `Facture ${invoice.invoice_number} enregistrée dans vos fichiers TicketPro.` });
      } else {
        downloadPdf(fileName, bytes);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error && error.message ? error.message : "La facture n'a pas pu être téléchargée."
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button icon={RefreshCw} onClick={() => void load()} variant="ghost">
            Actualiser
          </Button>
        }
        description="Retrouvez la facture de chaque abonnement TicketPro payé et téléchargez-la à tout moment."
        eyebrow="Compte SaaS"
        title="Factures"
      />

      {notice ? (
        <p className={notice.kind === "success" ? "form-error form-error--success" : "form-error"} role="status">
          {notice.text}
        </p>
      ) : null}

      {saasAccount && !isOwner ? (
        <div className="notice">Les factures sont réservées au propriétaire de l'organisation.</div>
      ) : state.status === "loading" ? (
        <Card title="Factures">
          <p className="invoice-list__status">Chargement de vos factures…</p>
        </Card>
      ) : state.status === "error" ? (
        <div className="notice notice--warning" role="status">
          <p>{state.message}</p>
          <Button icon={RefreshCw} onClick={() => void load()} variant="secondary">
            Réessayer
          </Button>
        </div>
      ) : state.invoices.length === 0 ? (
        <Card title="Factures">
          <EmptyState
            description="Une facture apparaît ici automatiquement après chaque paiement d'abonnement TicketPro."
            icon={ReceiptText}
            title="Aucune facture pour le moment"
          />
        </Card>
      ) : (
        <div className="invoice-list" role="list" aria-label="Factures des abonnements payés">
          {state.invoices.map((invoice) => (
            <article className="invoice-card" key={invoice.id} role="listitem">
              <div className="invoice-card__main">
                <div className="invoice-card__title">
                  <ReceiptText aria-hidden="true" />
                  <strong>{invoice.invoice_number}</strong>
                  <Badge status="success">Payée</Badge>
                </div>
                <p className="invoice-card__plan">Abonnement TicketPro — {invoice.plan.name}</p>
                <p className="invoice-card__details">{describeInvoiceSubscription(invoice)}</p>
                <div className="invoice-card__meta">
                  <span><CalendarDays aria-hidden="true" />{formatInvoicePeriod(invoice)}</span>
                  <span>
                    <CreditCard aria-hidden="true" />
                    Payée le {formatDate(invoice.paid_at)} · {invoice.payment.method_label}
                  </span>
                </div>
              </div>
              <div className="invoice-card__side">
                <span className="invoice-card__amount">{formatInvoiceAmount(invoice.amount, invoice.currency)}</span>
                <Button
                  disabled={downloadingId === invoice.id}
                  icon={FileDown}
                  onClick={() => void download(invoice)}
                  variant="primary"
                >
                  {downloadingId === invoice.id ? "Préparation…" : "Télécharger"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function downloadPdf(fileName: string, bytes: Uint8Array) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([arrayBuffer], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
