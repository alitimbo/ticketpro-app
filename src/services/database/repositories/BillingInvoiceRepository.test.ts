// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "../DatabaseClient";
import { BillingInvoiceRepository, invoiceStatusChangeRefusal } from "./BillingInvoiceRepository";
import { invoiceFromRecord } from "../../../pages/global/subscriptionPageModel";

function sqliteClient(db: DatabaseSync): DatabaseClient {
  const bind = (params: unknown[] = []) => Object.fromEntries(params.map((value, i) => [`?${i + 1}`, value as never]));
  return {
    execute: async (sql: string, params: unknown[] = []) => ({ rowsAffected: Number(db.prepare(sql).run(bind(params)).changes) }),
    query: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(bind(params)),
    transaction: async () => []
  } as unknown as DatabaseClient;
}

function invoicesDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE billing_invoices (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, subscription_id TEXT, invoice_number TEXT NOT NULL UNIQUE,
    amount_cfa INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'cancelled')),
    issued_at TEXT, due_at TEXT, paid_at TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  db.exec("INSERT INTO billing_invoices (id, account_id, invoice_number, amount_cfa, issued_at, due_at) VALUES ('old', 'a1', 'FAC-OLD', 1500, '2026-07-01', '2026-08-01')");
  db.exec(readFileSync("src-tauri/migrations/032_billing_invoice_snapshots.sql", "utf8"));
  return db;
}

const base = {
  account_id: "a1",
  amount_cfa: 60000,
  due_at: "2027-10-01T00:00:00.000Z",
  issued_at: "2026-10-16T10:00:00.000Z",
  notes: null,
  paid_at: null,
  status: "draft" as const,
  subscription_id: null
};

describe("factures d'abonnement", () => {
  it("fige la période, le pack et les routeurs de la facture au moment de son émission", async () => {
    const db = invoicesDatabase();
    const repository = new BillingInvoiceRepository(sqliteClient(db));
    const created = await repository.create({
      ...base,
      id: "inv-ultra",
      invoice_number: "FAC-ULTRA",
      pack_name: "Ultra",
      period_end: "2027-10-01T00:00:00.000Z",
      period_start: "2026-10-01T00:00:00.000Z",
      router_limit: 10
    });

    // Even after a renewal changes the current pack, the invoice keeps its own.
    const invoice = invoiceFromRecord(created, "Pack actuel", 3);
    expect(invoice).toMatchObject({
      packName: "Ultra",
      periodEnd: "2027-10-01T00:00:00.000Z",
      periodStart: "2026-10-01T00:00:00.000Z",
      routerLimit: 10
    });
    // An invoice issued before the migration keeps the previous display.
    const [legacy] = (await repository.listByAccount("a1")).filter((row) => row.id === "old");
    expect(invoiceFromRecord(legacy, "Pack actuel", 3)).toMatchObject({ packName: "Pack actuel", routerLimit: 3 });
  });

  it("refuse de payer une facture annulée et d'annuler une facture payée", async () => {
    const db = invoicesDatabase();
    const repository = new BillingInvoiceRepository(sqliteClient(db));
    await repository.create({ ...base, id: "i1", invoice_number: "FAC-1" });
    await repository.create({ ...base, id: "i2", invoice_number: "FAC-2" });

    await repository.updateStatus({ accountId: "a1", id: "i1", paidAt: "2026-10-16T11:00:00.000Z", status: "paid" });
    await expect(repository.updateStatus({ accountId: "a1", id: "i1", paidAt: null, status: "cancelled" }))
      .rejects.toThrow("Une facture payée ne peut pas être annulée.");

    await repository.updateStatus({ accountId: "a1", id: "i2", paidAt: null, status: "cancelled" });
    await expect(repository.updateStatus({ accountId: "a1", id: "i2", paidAt: "2026-10-16T11:00:00.000Z", status: "paid" }))
      .rejects.toThrow("Une facture annulée ne peut plus changer de statut.");

    // Another account cannot touch the invoice.
    await expect(repository.updateStatus({ accountId: "a2", id: "i1", paidAt: null, status: "cancelled" }))
      .rejects.toThrow("Facture introuvable pour ce compte.");

    const rows = await repository.listByAccount("a1");
    expect(rows.find((row) => row.id === "i1")).toMatchObject({ paid_at: "2026-10-16T11:00:00.000Z", status: "paid" });
    expect(rows.find((row) => row.id === "i2")).toMatchObject({ paid_at: null, status: "cancelled" });
  });

  it("autorise seulement les transitions d'une facture encore ouverte", () => {
    expect(invoiceStatusChangeRefusal("draft", "paid")).toBeNull();
    expect(invoiceStatusChangeRefusal("issued", "cancelled")).toBeNull();
    expect(invoiceStatusChangeRefusal("overdue", "paid")).toBeNull();
    expect(invoiceStatusChangeRefusal("paid", "paid")).toBe("Cette facture est déjà payée.");
  });
});
