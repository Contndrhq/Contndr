-- Self-healing cleanup for duplicate auto-generated indexes on kv_store_a8b2511f.
--
-- Background: 1,757 duplicate indexes named `kv_store_a8b2511f_key_idxNNNN`
-- accumulated on the KV table over time, consuming 24 GB and starving the
-- database of shared memory until endpoints started 500'ing. They were all
-- redundant with the table's primary key. After dropping them by hand the
-- table fell from 24 GB to 67 MB.
--
-- Root cause is most likely Supabase Dashboard's "Apply Index Suggestion"
-- feature in the Performance tab — each click creates an anonymous index
-- on `key`, which Postgres auto-suffixes with the next available number.
--
-- This function is idempotent and safe to call on every cold-boot. It only
-- targets indexes whose names match the auto-generated pattern (digits
-- after `_key_idx`) so the table's primary key and any explicitly-named
-- indexes are never touched.
--
-- SECURITY DEFINER lets the Edge Function call it via supabase.rpc()
-- without granting raw DDL privileges to the anon/authenticated roles.

CREATE OR REPLACE FUNCTION public.cleanup_kv_dup_indexes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r record;
  cnt int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS idx_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'kv_store_a8b2511f'
      AND c.relname ~ '^kv_store_a8b2511f_key_idx[0-9]+$'
    LIMIT 500
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idx_name);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- Restrict execution to the service role. The frontend should never invoke
-- this — it's a server-internal maintenance helper.
REVOKE ALL ON FUNCTION public.cleanup_kv_dup_indexes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_kv_dup_indexes() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_kv_dup_indexes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_kv_dup_indexes() TO service_role;
