import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, FileDown, FileText, Plus, XCircle } from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import {
  AccountSubscriptionRepository,
  BillingInvoiceRepository,
  SubscriptionPlanRepository
} from "../../services/database/repositories";
import { TauriFileService } from "../../services/files";
import { AuditLogService } from "../../services/logging";
import { generateInvoicePdf } from "../../services/pdf";
import { ActionMenu, Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader } from "../../shared/ui";
import {
  cancelInvoice,
  buildInvoiceNumber,
  createManualInvoice,
  formatInvoiceDate,
  formatInvoicePeriod,
  invoiceStatusBadge,
  invoiceStatusLabel,
  listInvoices,
  markInvoicePaid,
  type InvoiceDetail
} from "./invoicesPageModel";
import {
  formatCfa,
  invoiceFromRecord,
  subscriptionFromRecord,
  subscriptionPlanFromRecord,
  type BillingInvoice
} from "./subscriptionPageModel";

export function InvoicesPage() {
  const { accountSession, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const isAdmin = session?.internal_profile_role === "admin";
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<string | null>(null);
  const [persistentInvoices, setPersistentInvoices] = useState<BillingInvoice[]>([]);
  const localInvoices = useMemo(() => listInvoices(), [refreshKey]);
  const invoices = isPersistent ? persistentInvoices : localInvoices;
  const invoiceRepository = useMemo(() => new BillingInvoiceRepository(database), [database]);
  const subscriptionRepository = useMemo(() => new AccountSubscriptionRepository(database), [database]);
  const planRepository = useMemo(() => new SubscriptionPlanRepository(database), [database]);
  const fileService = useMemo(() => new TauriFileService(), []);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const selectedDetail = useMemo<InvoiceDetail | null>(
    () => {
      const invoice = selectedInvoiceId ? invoices.find((item) => item.id === selectedInvoiceId) : null;
      return invoice
        ? {
            accountEmail: accountSession?.email ?? session?.account_email ?? "",
            accountName: accountSession?.companyLabel ?? "Compte principal",
            invoice,
            packName: invoice.packName,
            periodLabel: formatInvoicePeriod(invoice)
          }
        : null;
    },
    [accountSession, invoices, selectedInvoiceId, session]
  );

  const refresh = () => setRefreshKey((current) => current + 1);

  const writeAudit = async (action: string, messageText: string, level: "info" | "warning" = "info") => {
    if (isPersistent && accountId && session) {
      await auditLogService.write({
        accountId,
        action,
        category: "systeme",
        internalProfileId: session.internal_profile_id,
        level,
        message: messageText
      });
    }
  };

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountId) {
      return undefined;
    }

    let mounted = true;
    const scopedAccountId = accountId;
    async function loadInvoices() {
      const [records, subscriptionRecord, planRecords] = await Promise.all([
        invoiceRepository.listByAccount(scopedAccountId),
        subscriptionRepository.findCurrentByAccount(scopedAccountId),
        planRepository.listActive()
      ]);
      const subscription = subscriptionRecord ? subscriptionFromRecord(subscriptionRecord) : null;
      const plan = subscription ? planRecords.map(subscriptionPlanFromRecord).find((item) => item.id === subscription.planId) : null;
      const mapped = records.map((record) => invoiceFromRecord(record, plan?.name ?? "Abonnement logiciel", plan?.routerLimit ?? subscription?.routerLimitSnapshot ?? 0));
      if (mounted) {
        setPersistentInvoices(mapped);
      }
    }

    void loadInvoices().catch(() => {
      if (mounted) {
        setMessage("Les factures persistantes n'ont pas pu être chargées.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [accountId, invoiceRepository, isInitialized, isPersistent, planRepository, subscriptionRepository]);

  const refreshPersistent = async () => {
    if (!accountId) {
      return;
    }
    const records = await invoiceRepository.listByAccount(accountId);
    const subscriptionRecord = await subscriptionRepository.findCurrentByAccount(accountId);
    const planRecords = await planRepository.listActive();
    const subscription = subscriptionRecord ? subscriptionFromRecord(subscriptionRecord) : null;
    const plan = subscription ? planRecords.map(subscriptionPlanFromRecord).find((item) => item.id === subscription.planId) : null;
    setPersistentInvoices(records.map((record) => invoiceFromRecord(record, plan?.name ?? "Abonnement logiciel", plan?.routerLimit ?? subscription?.routerLimitSnapshot ?? 0)));
  };

  const createInvoice = async () => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de créer une facture.");
      return;
    }

    if (isPersistent && accountId) {
      const subscription = await subscriptionRepository.findCurrentByAccount(accountId);
      if (!subscription) {
        setMessage("Abonnement introuvable.");
        return;
      }
      const plan = await planRepository.findById(subscription.subscription_plan_id);
      const now = new Date();
      await invoiceRepository.create({
        account_id: accountId,
        amount_cfa: subscription.price_cfa_snapshot ?? plan?.price_cfa ?? 0,
        due_at: subscription.current_period_end,
        id: `invoice-manual-${now.getTime()}`,
        invoice_number: buildInvoiceNumber(now),
        issued_at: now.toISOString(),
        notes: "Facture manuelle d'abonnement logiciel.",
        paid_at: null,
        status: "draft",
        subscription_id: subscription.id
      });
      await refreshPersistent();
      await writeAudit("invoice.created", "Facture manuelle créée.");
    } else {
      createManualInvoice();
      refresh();
    }
    setMessage("Facture manuelle créée en brouillon.");
  };

  const markPaid = async (invoiceId: string) => {
    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission de modifier les factures.");
      return;
    }

    if (isPersistent && accountId) {
      await invoiceRepository.updateStatus({ accountId, id: invoiceId, paidAt: new Date().toISOString(), status: "paid" });
      await refreshPersistent();
      await writeAudit("invoice.paid", `Facture ${invoiceId} marquée comme payée.`);
    } else {
      markInvoicePaid(invoiceId);
      refresh();
    }
    setMessage("Facture marquée comme payée en mode manuel.");
  };

  const confirmCancel = async () => {
    if (!invoiceToCancel) {
      return;
    }

    if (!isAdmin) {
      setMessage("Vous n'avez pas la permission d'annuler une facture.");
      setInvoiceToCancel(null);
      return;
    }

    if (isPersistent && accountId) {
      await invoiceRepository.updateStatus({ accountId, id: invoiceToCancel, paidAt: null, status: "cancelled" });
      await refreshPersistent();
      await writeAudit("invoice.cancelled", `Facture ${invoiceToCancel} annulée.`, "warning");
    } else {
      cancelInvoice(invoiceToCancel);
      refresh();
    }
    setInvoiceToCancel(null);
    setMessage("Facture annulée.");
  };

  const exportPdf = async (detail: InvoiceDetail) => {
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
    if (isPersistent) {
      await fileService.writeBytes(`files/invoices/${detail.invoice.invoiceNumber}.pdf`, bytes);
    } else {
      downloadPdf(`${detail.invoice.invoiceNumber}.pdf`, bytes);
    }
    await writeAudit("invoice.exported", `PDF de la facture ${detail.invoice.invoiceNumber} exporté.`);
    setMessage("PDF de facture généré.");
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={() => void createInvoice()} variant="primary">
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
              const detail: InvoiceDetail = {
                accountEmail: accountSession?.email ?? session?.account_email ?? "",
                accountName: accountSession?.companyLabel ?? "Compte principal",
                invoice,
                packName: invoice.packName,
                periodLabel: formatInvoicePeriod(invoice)
              };

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
                            void exportPdf(detail);
                          }
                        }
                      },
                      {
                        icon: CheckCircle2,
                        label: "Marquer payée",
                        onSelect: () => void markPaid(invoice.id)
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
          onExport={() => void exportPdf(selectedDetail)}
          onMarkPaid={() => void markPaid(selectedDetail.invoice.id)}
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
