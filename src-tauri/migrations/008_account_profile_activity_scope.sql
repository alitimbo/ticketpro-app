ALTER TABLE ticket_batches ADD COLUMN account_id TEXT;
ALTER TABLE tickets ADD COLUMN account_id TEXT;
ALTER TABLE generated_files ADD COLUMN account_id TEXT;
ALTER TABLE generated_files ADD COLUMN created_by_profile_id TEXT;
ALTER TABLE app_logs ADD COLUMN account_id TEXT;
ALTER TABLE app_logs ADD COLUMN internal_profile_id TEXT;

UPDATE ticket_batches
SET account_id = COALESCE(
  account_id,
  (SELECT routers.account_id FROM routers WHERE routers.id = ticket_batches.router_id),
  'account-douma-demo'
)
WHERE account_id IS NULL;

UPDATE tickets
SET account_id = COALESCE(
  account_id,
  (SELECT ticket_batches.account_id FROM ticket_batches WHERE ticket_batches.id = tickets.batch_id),
  (SELECT routers.account_id FROM routers WHERE routers.id = tickets.router_id),
  'account-douma-demo'
)
WHERE account_id IS NULL;

UPDATE generated_files
SET
  account_id = COALESCE(
    account_id,
    (SELECT ticket_batches.account_id FROM ticket_batches WHERE ticket_batches.id = generated_files.batch_id),
    (SELECT routers.account_id FROM routers WHERE routers.id = generated_files.router_id),
    'account-douma-demo'
  ),
  created_by_profile_id = COALESCE(
    created_by_profile_id,
    CASE created_by_profile
      WHEN 'admin' THEN 'internal-profile-admin'
      WHEN 'operator' THEN 'internal-profile-operator'
      WHEN 'agent' THEN 'internal-profile-agent'
      WHEN 'guest' THEN 'internal-profile-guest'
      ELSE 'internal-profile-operator'
    END
  )
WHERE account_id IS NULL OR created_by_profile_id IS NULL;

UPDATE app_logs
SET
  account_id = COALESCE(
    account_id,
    (SELECT routers.account_id FROM routers WHERE routers.id = app_logs.router_id),
    'account-douma-demo'
  ),
  internal_profile_id = COALESCE(
    internal_profile_id,
    CASE created_by_profile
      WHEN 'admin' THEN 'internal-profile-admin'
      WHEN 'operator' THEN 'internal-profile-operator'
      WHEN 'agent' THEN 'internal-profile-agent'
      WHEN 'guest' THEN 'internal-profile-guest'
      ELSE created_by_profile
    END
  )
WHERE account_id IS NULL OR internal_profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_batches_account_profile ON ticket_batches(account_id, created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_account_profile ON tickets(account_id, created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_account_profile ON generated_files(account_id, created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_account_profile ON app_logs(account_id, internal_profile_id);
