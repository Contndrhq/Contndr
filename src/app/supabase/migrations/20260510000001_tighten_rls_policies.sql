-- Tighten RLS policies on user-scoped tables.
--
-- Eight tables had RLS enabled but only an "Allow all on …" policy with
-- USING (true) — equivalent to no RLS. Four more tables had no RLS at all.
-- The backend uses the service-role client which bypasses RLS, so this
-- migration cannot break any existing handler. It adds a real safety net
-- so a missing `.eq('user_id', X)` filter in a backend handler does not
-- become a cross-tenant data leak (the audit found one such case in the
-- pixel tracker — already patched).
--
-- Verified before writing: no frontend code queries these tables directly
-- with the anon key, so tightening these policies cannot regress the UI.

-- ─── 1. Tables with their own user_id column ─────────────────────────
-- automation_rules, signatures, leads_new (also has org_id),
-- admin_events, click_events, visitor_events, visitor_sessions.

DROP POLICY IF EXISTS "Allow all on automation_rules" ON automation_rules;
DROP POLICY IF EXISTS "Allow all on signatures"        ON signatures;
DROP POLICY IF EXISTS "Allow all on leads_new"         ON leads_new;

ALTER TABLE admin_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE click_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_sessions   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'automation_rules',
    'signatures',
    'leads_new',
    'admin_events',
    'click_events',
    'visitor_events',
    'visitor_sessions'
  ]
  LOOP
    -- SELECT: own rows only
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
      tbl || '_select_own', tbl
    );
    -- INSERT: cannot create rows owned by someone else
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
      tbl || '_insert_own', tbl
    );
    -- UPDATE: own rows, cannot reassign ownership to another user
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      tbl || '_update_own', tbl
    );
    -- DELETE: own rows only
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (auth.uid() = user_id)',
      tbl || '_delete_own', tbl
    );
  END LOOP;
END $$;

-- ─── 2. Tables linked to leads via lead_id ───────────────────────────
-- Ownership flows through the parent leads row. Subquery is fine because
-- leads.id is the primary key (indexed lookup).

DROP POLICY IF EXISTS "Allow all on lead_custom_fields" ON lead_custom_fields;
DROP POLICY IF EXISTS "Allow all on lead_emails"        ON lead_emails;
DROP POLICY IF EXISTS "Allow all on lead_phones"        ON lead_phones;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['lead_custom_fields', 'lead_emails', 'lead_phones']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (lead_id IN (SELECT id FROM leads WHERE user_id = auth.uid()))',
      tbl || '_select_own_lead', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (lead_id IN (SELECT id FROM leads WHERE user_id = auth.uid()))',
      tbl || '_insert_own_lead', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (lead_id IN (SELECT id FROM leads WHERE user_id = auth.uid())) WITH CHECK (lead_id IN (SELECT id FROM leads WHERE user_id = auth.uid()))',
      tbl || '_update_own_lead', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (lead_id IN (SELECT id FROM leads WHERE user_id = auth.uid()))',
      tbl || '_delete_own_lead', tbl
    );
  END LOOP;
END $$;

-- ─── 3. Shared / catalog tables with no ownership column ─────────────
-- companies (Apollo company catalog) and organizations have no user_id.
-- The audit flagged the "Allow all" policy as a cross-tenant exposure.
-- The right answer here is service-role-only access — the backend mediates
-- all reads and writes, no direct client queries should ever hit these.

DROP POLICY IF EXISTS "Allow all on companies"     ON companies;
DROP POLICY IF EXISTS "Allow all on organizations" ON organizations;

-- No new policies => default-deny for every non-service-role caller.
-- service_role bypasses RLS entirely, so the backend is unaffected.

-- ─── 4. leads_backup_manual ──────────────────────────────────────────
-- One-shot backup snapshot. Lock down completely.
ALTER TABLE leads_backup_manual ENABLE ROW LEVEL SECURITY;
-- No policies => deny all to non-service-role.
