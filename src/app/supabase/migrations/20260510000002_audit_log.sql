-- Audit log table for sensitive / destructive actions.
--
-- Required by SOC2 Type II: a record of WHO did WHAT to WHICH resource WHEN,
-- and from WHERE. Not a full activity log — that would be too noisy. We only
-- record actions that are:
--   - destructive (delete, bulk_delete, account_delete)
--   - admin-privileged (plan changes, user impersonation)
--   - integration-changing (OAuth connect/disconnect)
--   - financial (credit adjustment, refund)
--
-- Append-only by design. We never UPDATE or DELETE rows from this table —
-- the integrity of the audit trail depends on it being immutable. RLS lets
-- a user see their own events for transparency; only service role can write.

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  resource     TEXT,
  resource_id  TEXT,
  metadata     JSONB,
  ip           TEXT,
  user_agent   TEXT,
  request_id   TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx     ON audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx    ON audit_log (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx  ON audit_log (resource, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_occurred_idx  ON audit_log (occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Users can see events where they were the actor (transparency / "what did
-- I do" view). Admins / support tooling reads via service role.
CREATE POLICY audit_log_select_own
  ON audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = actor_id);

-- No INSERT/UPDATE/DELETE policies for authenticated users — the audit log
-- is service-role-only for writes. service_role bypasses RLS entirely.
