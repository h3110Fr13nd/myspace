-- The app's original 0001 schema includes this field, but some long-lived
-- Compose databases were initialized from docker/postgres/init.sql instead.
-- Keep vault-sync's database-backed content path available on those installs.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content TEXT;
