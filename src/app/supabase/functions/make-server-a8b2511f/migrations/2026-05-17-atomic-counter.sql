-- Atomic-increment-and-fetch for rate-limiting keys.
-- Run once in the Supabase SQL editor (the function is idempotent —
-- CREATE OR REPLACE — so it's safe to re-run after edits.)
--
-- Usage from edge functions:
--   const { data } = await supabase.rpc('kv_atomic_increment', { p_key: 'foo', p_limit: 400 });
--   data === { count: 17, allowed: true }   // succeeded, current count = 17
--   data === { count: 400, allowed: false } // limit hit, NOT incremented

CREATE OR REPLACE FUNCTION public.kv_atomic_increment(
  p_key   TEXT,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current INTEGER;
  v_next    INTEGER;
BEGIN
  -- Take a row-level lock if the key already exists; otherwise insert it
  -- at 0 first. The whole thing is wrapped in the implicit transaction
  -- of the function call so no other caller can interleave between the
  -- read and write.
  INSERT INTO kv_store_a8b2511f (key, value)
  VALUES (p_key, '0'::jsonb)
  ON CONFLICT (key) DO NOTHING;

  -- Lock the row and read the current value
  SELECT (value)::text::integer
    INTO v_current
    FROM kv_store_a8b2511f
   WHERE key = p_key
   FOR UPDATE;

  -- Default to 0 if the cast somehow failed
  IF v_current IS NULL THEN
    v_current := 0;
  END IF;

  -- Check the limit BEFORE incrementing
  IF v_current >= p_limit THEN
    RETURN jsonb_build_object('count', v_current, 'allowed', false);
  END IF;

  v_next := v_current + 1;

  UPDATE kv_store_a8b2511f
     SET value = to_jsonb(v_next)
   WHERE key = p_key;

  RETURN jsonb_build_object('count', v_next, 'allowed', true);
END;
$$;

-- Grant execute to authenticated and service_role so edge functions can call it.
GRANT EXECUTE ON FUNCTION public.kv_atomic_increment(TEXT, INTEGER) TO authenticated, service_role, anon;
