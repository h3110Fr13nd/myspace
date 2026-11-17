DROP TRIGGER IF EXISTS users_id_immutable ON users;
DROP FUNCTION IF EXISTS forbid_user_id_change();
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_format;
