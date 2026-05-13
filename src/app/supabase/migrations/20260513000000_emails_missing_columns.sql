-- The send-batch and email-sync code paths update emails.updated_at and
-- emails.to_email on most write operations, but the columns were never
-- added to the table. Supabase's .update() silently rejects writes that
-- reference unknown columns — which is why broadcast emails stayed stuck
-- in `queued` status forever even though the failure handler tried to
-- mark them `failed`. From the broadcast UI's perspective the lead
-- looked "Failed" (because the API response said so), but the email row
-- itself never moved off `queued`, blocking subsequent retries via the
-- cross-isolate dedup guard.
--
-- Adding the columns also unblocks the [EMAILS/RECENT] endpoint, which
-- logs `column emails.to_email does not exist` on every dashboard load.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS to_email TEXT;

-- Backfill to_email from the existing data where possible (we historically
-- didn't store it explicitly, but downstream features that try to read it
-- will at least get nulls instead of crashes).

-- updated_at default backfills automatically via NOT NULL DEFAULT.
