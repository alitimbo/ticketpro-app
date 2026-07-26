PRAGMA foreign_keys = ON;

ALTER TABLE ticket_batches ADD COLUMN created_by_profile_id TEXT;
ALTER TABLE tickets ADD COLUMN created_by_profile_id TEXT;

UPDATE ticket_batches
SET created_by_profile_id = CASE created_by_profile
  WHEN 'admin' THEN 'internal-profile-admin'
  WHEN 'operator' THEN 'internal-profile-operator'
  WHEN 'agent' THEN 'internal-profile-agent'
  WHEN 'guest' THEN 'internal-profile-guest'
  ELSE COALESCE(created_by_profile_id, 'internal-profile-operator')
END
WHERE created_by_profile_id IS NULL;

UPDATE tickets
SET created_by_profile_id = CASE created_by_profile
  WHEN 'admin' THEN 'internal-profile-admin'
  WHEN 'operator' THEN 'internal-profile-operator'
  WHEN 'agent' THEN 'internal-profile-agent'
  WHEN 'guest' THEN 'internal-profile-guest'
  ELSE COALESCE(created_by_profile_id, 'internal-profile-operator')
END
WHERE created_by_profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_batches_created_by_profile_id ON ticket_batches(created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by_profile_id ON tickets(created_by_profile_id);
