PRAGMA foreign_keys = ON;

-- A voucher is a commercial contract. Once issued, its duration, validity,
-- quota and access limits must no longer follow later edits to its plan.
ALTER TABLE tickets ADD COLUMN duration_minutes_snapshot INTEGER;
ALTER TABLE tickets ADD COLUMN validity_minutes_snapshot INTEGER;
ALTER TABLE tickets ADD COLUMN data_limit_mb_snapshot INTEGER;
ALTER TABLE tickets ADD COLUMN download_limit_snapshot TEXT;
ALTER TABLE tickets ADD COLUMN upload_limit_snapshot TEXT;
ALTER TABLE tickets ADD COLUMN shared_users_snapshot INTEGER;

-- Existing vouchers inherit the last known local plan only once. Future plan
-- changes never rewrite these columns.
UPDATE tickets
SET
  duration_minutes_snapshot = (
    SELECT duration_minutes FROM hotspot_plans WHERE hotspot_plans.id = tickets.plan_id
  ),
  validity_minutes_snapshot = (
    SELECT COALESCE(validity_minutes, duration_minutes)
    FROM hotspot_plans
    WHERE hotspot_plans.id = tickets.plan_id
  ),
  data_limit_mb_snapshot = (
    SELECT data_limit_mb FROM hotspot_plans WHERE hotspot_plans.id = tickets.plan_id
  ),
  download_limit_snapshot = (
    SELECT download_limit FROM hotspot_plans WHERE hotspot_plans.id = tickets.plan_id
  ),
  upload_limit_snapshot = (
    SELECT upload_limit FROM hotspot_plans WHERE hotspot_plans.id = tickets.plan_id
  ),
  shared_users_snapshot = (
    SELECT shared_users FROM hotspot_plans WHERE hotspot_plans.id = tickets.plan_id
  )
WHERE duration_minutes_snapshot IS NULL
   OR validity_minutes_snapshot IS NULL
   OR shared_users_snapshot IS NULL;
