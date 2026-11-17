-- Intentionally irreversible: this column stores user-authored resource bodies.
-- It may also predate this compatibility migration on databases created by 0001.
DO $$
BEGIN
  RAISE EXCEPTION 'resources.content is retained to protect user content';
END
$$;
