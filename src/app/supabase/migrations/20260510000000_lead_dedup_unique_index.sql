-- Enforce per-user lead uniqueness at the database layer.
--
-- Without this, two concurrent imports (e.g. user double-clicked Import) can
-- both pass the application-level dedup check and both insert the same row,
-- producing duplicate leads. The application-level lock added in index.tsx
-- (`lead_import_lock:${user.id}`) handles the common case but a DB unique
-- index is the only ironclad guarantee.
--
-- We use partial indexes so rows with NULL email/phone (legitimate) don't
-- collide with each other.

CREATE UNIQUE INDEX IF NOT EXISTS leads_unique_user_email
  ON leads (user_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS leads_unique_user_phone
  ON leads (user_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';
