ALTER TABLE license_state ADD COLUMN activation_id TEXT;
ALTER TABLE license_state ADD COLUMN plan_id TEXT;
ALTER TABLE license_state ADD COLUMN plan_code TEXT;
ALTER TABLE license_state ADD COLUMN plan_name TEXT;
ALTER TABLE license_state ADD COLUMN plan_description TEXT;
ALTER TABLE license_state ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 1;
ALTER TABLE license_state ADD COLUMN device_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE license_state ADD COLUMN price_cfa INTEGER;
ALTER TABLE license_state ADD COLUMN billing_period TEXT NOT NULL DEFAULT 'custom';
