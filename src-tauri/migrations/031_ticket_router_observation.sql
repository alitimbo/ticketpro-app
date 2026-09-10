-- Local RouterOS evidence is independent of cloud catalogue sync_status.
-- No backfill: legacy sync_status cannot prove presence or absence.
ALTER TABLE tickets ADD COLUMN router_observation_status TEXT;
ALTER TABLE tickets ADD COLUMN router_observation_at TEXT;
