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
        issued_at, due_at, paid_at, notes
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
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
        input.notes
      ]
    );
    const rows = await this.database.query<BillingInvoiceRecord>("SELECT * FROM billing_invoices WHERE id = ?1", [input.id]);
    if (!rows[0]) {
      throw new Error("La facture n'a pas pu être créée.");
    }
    return rows[0];
  }

  async updateStatus(input: {
    accountId: string;
    id: string;
    paidAt: string | null;
    status: BillingInvoiceRecord["status"];
  }): Promise<void> {
    await this.database.execute(
      "UPDATE billing_invoices SET status = ?1, paid_at = ?2, updated_at = ?3 WHERE id = ?4 AND account_id = ?5",
      [input.status, input.paidAt, new Date().toISOString(), input.id, input.accountId]
    );
  }
}
