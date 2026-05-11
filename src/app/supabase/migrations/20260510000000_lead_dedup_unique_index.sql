-- Enforce per-user lead uniqueness on EMAIL only.
--
-- Phone uniqueness was considered but rejected: in B2B, hundreds of distinct
-- contacts legitimately share one company switchboard number. A unique index
-- on (user_id, phone) would treat ~23% of a real lead database as duplicates.
-- Email is a true per-person identifier and is the right dedup key.
--
-- Without this index, two concurrent imports can both pass the application
-- dedup check and both insert the same (user_id, email) row.
--
-- Step 1: clean up existing email duplicates by keeping the OLDEST row per
--   (user_id, lower(email)) group. Oldest wins because it has accumulated
--   the most history (campaign sends, replies, status changes).
-- Step 2: create a partial unique index that prevents future duplicates.
--   Partial so rows with NULL email don't collide with each other.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(email)
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM leads
  WHERE email IS NOT NULL AND email <> ''
)
DELETE FROM leads
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS leads_unique_user_email
  ON leads (user_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';
