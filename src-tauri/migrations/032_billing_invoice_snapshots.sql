-- A billing invoice keeps the period, pack and router limit it was issued
-- for. The local subscription snapshot is overwritten at each renewal, so it
-- cannot describe an older invoice. No backfill: the period of an existing
-- invoice is unknown and is shown as such.
ALTER TABLE billing_invoices ADD COLUMN period_start TEXT;
ALTER TABLE billing_invoices ADD COLUMN period_end TEXT;
ALTER TABLE billing_invoices ADD COLUMN pack_name TEXT;
ALTER TABLE billing_invoices ADD COLUMN router_limit INTEGER;
