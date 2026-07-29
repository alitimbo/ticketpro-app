PRAGMA foreign_keys = ON;

-- A voucher code must identify at most one active local ticket per router.
-- Deleted historical tickets remain available for audit and do not block reuse.
-- Repair databases created before this invariant existed so the index migration
-- cannot fail. The oldest row stays active; later duplicates remain auditable.
WITH ranked_tickets AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY router_id, username
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM tickets
  WHERE deleted_at IS NULL
)
UPDATE tickets
SET
  deleted_at = CURRENT_TIMESTAMP,
  status = 'supprimé',
  sync_status = 'conflict',
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id
  FROM ranked_tickets
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_router_username_active
ON tickets(router_id, username)
WHERE deleted_at IS NULL;
