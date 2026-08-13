ALTER TABLE ticket_batches ADD COLUMN currency TEXT NOT NULL DEFAULT 'CFA';
ALTER TABLE ticket_batches ADD COLUMN price_snapshot INTEGER;

UPDATE ticket_batches
SET currency = 'CFA'
WHERE currency IS NULL OR TRIM(currency) = '';

UPDATE ticket_batches
SET price_snapshot = (
  SELECT price_hint
  FROM hotspot_plans
  WHERE hotspot_plans.id = ticket_batches.plan_id
)
WHERE price_snapshot IS NULL;
