-- Les anciens identifiants de profils étaient globaux (internal-profile-admin, etc.).
-- Ils deviennent uniques par compte sans supprimer les données existantes.
UPDATE internal_profiles
SET id = account_id || ':' || id
WHERE instr(id, ':') = 0;

UPDATE routers
SET created_by_profile_id = account_id || ':' || created_by_profile_id
WHERE created_by_profile_id IS NOT NULL
  AND instr(created_by_profile_id, ':') = 0;

UPDATE ticket_batches
SET created_by_profile_id = account_id || ':' || created_by_profile_id
WHERE created_by_profile_id IS NOT NULL
  AND instr(created_by_profile_id, ':') = 0;

UPDATE tickets
SET created_by_profile_id = account_id || ':' || created_by_profile_id
WHERE created_by_profile_id IS NOT NULL
  AND instr(created_by_profile_id, ':') = 0;

UPDATE generated_files
SET created_by_profile_id = account_id || ':' || created_by_profile_id
WHERE created_by_profile_id IS NOT NULL
  AND instr(created_by_profile_id, ':') = 0;

UPDATE app_logs
SET internal_profile_id = account_id || ':' || internal_profile_id
WHERE internal_profile_id IS NOT NULL
  AND instr(internal_profile_id, ':') = 0;

CREATE INDEX IF NOT EXISTS idx_internal_profiles_account_identity
ON internal_profiles(account_id, id);
