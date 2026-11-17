-- 0013 down: restore public access everywhere 0013 removed it.
--
-- This is the pre-0013 state, not a considered one: it re-publicises the
-- research vault that 0013 deliberately closed, which is why it exists only to
-- let the migration be reverted in a test fixture. Running it against a real
-- workspace reintroduces the leak this migration fixed.
--
-- `ON CONFLICT DO UPDATE` because the rows still exist — 0013 narrowed them
-- rather than deleting them — so a plain INSERT would fail on the primary key.

INSERT INTO resource_audience (resource_id, audience, rung, updated_at)
SELECT a.resource_id, a.audience, a.rung, NOW()
  FROM (
        -- The research tree and its containers, as they were imported.
        SELECT r.id AS resource_id, 'public_link'::varchar AS audience, 'viewer'::varchar AS rung
          FROM resources r
         WHERE r.id LIKE 'paper:%'
            OR r.id LIKE 'folder:research%'
        UNION ALL
        SELECT 'space:docs', 'public_link', 'viewer'
        UNION ALL
        SELECT 'google_sheet:newwer-shhet', 'public_link', 'viewer'
       ) a
ON CONFLICT (resource_id) DO UPDATE
   SET audience = EXCLUDED.audience,
       rung = EXCLUDED.rung,
       updated_at = NOW();

-- Derived flag back in step with the audience rows above.
UPDATE resources r
   SET is_public = true
  FROM resource_audience a
 WHERE a.resource_id = r.id
   AND a.audience = 'public_link'
   AND (
     r.id LIKE 'paper:%'
     OR r.id LIKE 'folder:research%'
     OR r.id IN ('space:docs', 'google_sheet:newwer-shhet')
   );

-- Wildcard grants for exactly the rows re-publicised above. Scoped to resources
-- so the unrelated second store in `tuple` is not touched.
INSERT INTO tuple (store, object_type, object_id, relation, _user, user_type, ulid, inserted_at)
SELECT t.store,
       r.type,
       split_part(r.id, ':', 2),
       a.rung,
       'user:*',
       'userset',
       gen_random_uuid()::text,
       NOW()
  FROM resources r
  JOIN resource_audience a ON a.resource_id = r.id AND a.audience = 'public_link'
  JOIN LATERAL (
        SELECT DISTINCT store FROM tuple
       ) t ON TRUE
 WHERE r.id LIKE 'paper:%'
    OR r.id LIKE 'folder:research%'
    OR r.id IN ('space:docs', 'google_sheet:newwer-shhet');