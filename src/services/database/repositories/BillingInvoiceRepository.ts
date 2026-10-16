import type { BillingInvoiceRecord, CreateBillingInvoiceInput } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class BillingInvoiceRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listByAccount(accountId: string): Promise<BillingInvoiceRecord[]> {
    return this.database.query<BillingInvoiceRecord>(
      "SELECT * FROM billing_invoices WHERE account_id = ?1 ORDER BY issued_at DESC, created_at DESC",
      [accountId]
    );
  }

  async create(input: CreateBillingInvoiceInput): Promise<BillingInvoiceRecord> {
    await this.database.execute(
      `INSERT INTO billing_invoices (
        id, account_id, subscription_id, invoice_number, amount_cfa, status,
        issued_at, due_at, paid_at, notes, period_start, period_end, pack_name, router_limit
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      [
        input.id,
        input.account_id,
        input.subscription_id,
        input.invoice_number,
        input.amount_cfa,
        input.status,
        input.issued_at,
        input.due_at,
        input.paid_at,
        input.notes,
        input.period_start ?? null,
        input.period_end ?? null,
        input.pack_name ?? null,
        input.router_limit ?? null
      ]
    );
    const rows = await this.database.query<BillingInvoiceRecord>("SELECT * FROM billing_invoices WHERE id = ?1", [input.id]);
    if (!rows[0]) {
      throw new Error("La facture n'a pas pu être créée.");
    }
    return rows[0];
  }

  /**
   * Applies an allowed status change only: a paid invoice is never cancelled,
   * a cancelled invoice is never paid. Throws with the reason otherwise.
   */
  async updateStatus(input: {
    accountId: string;
    id: string;
    paidAt: string | null;
    status: BillingInvoiceRecord["status"];
  }): Promise<void> {
    const rows = await this.database.query<BillingInvoiceRecord>(
      "SELECT * FROM billing_invoices WHERE id = ?1 AND account_id = ?2",
      [input.id, input.accountId]
    );
    const current = rows[0];
    if (!current) throw new Error("Facture introuvable pour ce compte.");
    const refusal = invoiceStatusChangeRefusal(current.status, input.status);
    if (refusal) throw new Error(refusal);
    await this.database.execute(
      "UPDATE billing_invoices SET status = ?1, paid_at = ?2, updated_at = ?3 WHERE id = ?4 AND account_id = ?5 AND status = ?6",
      [input.status, input.paidAt, new Date().toISOString(), input.id, input.accountId, current.status]
    );
  }
}

/** Why a status change is refused, or null when it is allowed. */
export function invoiceStatusChangeRefusal(
  from: BillingInvoiceRecord["status"],
  to: BillingInvoiceRecord["status"]
): string | null {
  if (from === to) return to === "paid" ? "Cette facture est déjà payée." : "Cette facture est déjà annulée.";
  if (from === "cancelled") return "Une facture annulée ne peut plus changer de statut.";
  if (from === "paid" && to === "cancelled") return "Une facture payée ne peut pas être annulée.";
  if (from === "paid") return "Une facture payée ne peut plus changer de statut.";
  return null;
}
