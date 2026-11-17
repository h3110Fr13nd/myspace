-- 0010: lock in the opaque id format
--
-- Run AFTER `scripts/migrate-user-ids.ts --fix`.
--
-- The constraint cannot live in 0009: NOT VALID skips the initial scan but is
-- still enforced on UPDATE, so it would reject the re-key it was written to
-- protect. An invariant can only be asserted once the data conforms, so it is
-- asserted here — after — rather than as a comment asking the reader to remember
-- the ordering.
--
-- From here a hand-written `user:something` is rejected by the database, not just
-- by review. The defect this whole migration sequence fixes was `register.ts`
-- minting `user:${email.split('@')[0]}`, which is exactly the kind of thing a
-- constraint makes impossible to reintroduce.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_format;

ALTER TABLE users
  ADD CONSTRAINT users_id_format
  CHECK (id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Ids are immutable: a principal that can be renamed is a principal whose grants
-- and audit links can be orphaned, which is what the legacy-id mess was.
CREATE OR REPLACE FUNCTION forbid_user_id_change() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'users.id is immutable (attempted % -> %). Re-key through scripts/migrate-user-ids.ts.', OLD.id, NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_id_immutable ON users;
CREATE TRIGGER users_id_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION forbid_user_id_change();
