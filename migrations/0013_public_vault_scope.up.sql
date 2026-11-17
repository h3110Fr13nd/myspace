-- 0013: confine public access to content/public_vault
--
-- The workspace held 102 resources carrying a `public_link` audience, and only
-- 16 of them were actually meant to be public. The rest leaked for two reasons.
--
-- First, the research tree. `content/public_vault/research` was meant to be a
-- personal vault belonging to one user; it sat inside the public directory, was
-- imported with `is_public = true`, and was given `user:*` viewer grants at
-- import time. Its files have since moved to
-- `content/user_user_demo/research`, so the directory
-- layout already says it is private while the graph still says it is public —
-- the two disagreed, and the graph is what the reader consults.
--
-- Second, `space:docs` and `google_sheet:newwer-shhet`, which are unrelated to
-- the public vault: one is an empty legacy space, the other a spreadsheet in a
-- user's private root folder. `space:docs` had no children at all, so it was
-- pure directory disclosure.
--
-- Why the earlier manual fix did not hold: deleting the `user:*` tuples and
-- setting `is_public = false` is not durable on its own. `resource_audience` is
-- the declared intent, and `scripts/reconcile-acl.ts` re-creates the wildcard
-- grant for any row with `is_public = true` — and reports a `public_link`
-- audience whose tuple is missing as a divergence to be "repaired". Any one-off
-- UPDATE that leaves the two halves disagreeing gets undone by the next
-- reconcile run, which is how a private vault reverts to public on its own.
-- This migration moves all three representations together so there is nothing
-- left to disagree.
--
-- `is_public` is not dropped. `canUserViewResource` no longer reads it, but it
-- remains an indexed column that list queries filter on, and `setAudience` in
-- `src/lib/acl/audience.ts` keeps it in step. Flipping it alone would be the
-- half-fix described above.
--
-- THE PREDICATE IS WRITTEN WITH `COALESCE`, AND THAT IS NOT COSMETIC.
--
-- Every public_vault container — `folder:public_vault_*`, `space:public_vault` —
-- and every non-file resource (`space:docs`, the google_sheet) has no
-- `metadata->>'filePath'` at all, so `metadata->>'filePath' LIKE '...'` evaluates
-- to NULL, not false. `NOT (NULL OR false)` is NULL, and `WHERE NULL` does not
-- match. The first draft of this migration used the bare form and silently
-- updated *zero* container rows while updating every file row — the papers went
-- private and `space:docs` stayed public, which is precisely the class of row
-- this migration exists to catch. Containers are also exactly the rows with no
-- file path, so the failure is invisible on any check that looks only at files.
--
-- The scope is "lives under content/public_vault", taken from
-- `metadata->>'filePath'`, plus the `public_vault` container ids, because that is
-- the actual intent. Restricting by a hand-written id list would re-open the
-- hole the next time the importer creates a folder.

-- 1. Containers for the public vault keep their existing grants; everything
--    else loses its public audience. Derived from the file path rather than from
--    `path`, since `path` encodes the *old* public location of the research tree
--    and would therefore exempt exactly the rows that must change.
UPDATE resource_audience a
   SET audience = 'restricted',
       rung = NULL,
       updated_at = NOW()
 WHERE a.audience <> 'restricted'
   AND NOT EXISTS (
         SELECT 1
           FROM resources r
          WHERE r.id = a.resource_id
            AND (
              COALESCE(r.metadata->>'filePath' LIKE '%/content/public_vault/%', false)
              OR r.id LIKE 'folder:public_vault%'
            )
       );

-- 2. The derived flag that indexed listing queries read, kept in step with (1).
--    Without this the reconcile job re-grants `user:*` on its next pass.
UPDATE resources r
   SET is_public = false
 WHERE r.is_public = true
   AND NOT (
         COALESCE(r.metadata->>'filePath' LIKE '%/content/public_vault/%', false)
         OR r.id LIKE 'folder:public_vault%'
       );

-- 3. The wildcard grants themselves, including objects that never had an
--    audience row at all. Scoped by the same predicate: anything outside the
--    public vault loses `user:*`, whatever declared it.
--
--    Joining `resources` also scopes this to the store that actually holds
--    grants for these objects. `tuple` is shared across every store in the
--    database, and this one contains a second store whose 23 tuples reference no
--    resource at all — a leftover from a discarded store id. Those are left
--    untouched, since they cannot be attributed to a resource and a wildcard
--    delete over the table would take unrelated grants with it.
DELETE FROM tuple t
 USING resources r
  WHERE t.object_type || ':' || t.object_id = r.id
    AND t._user = 'user:*'
    AND NOT (
          COALESCE(r.metadata->>'filePath' LIKE '%/content/public_vault/%', false)
          OR r.id LIKE 'folder:public_vault%'
        );

-- 4. `space:docs` has no audience row and no children, but the reconcile job
--    looks it up by `is_public`, and it is not under the public vault. Covered
--    by (2) for the flag; this clears any wildcard that survived on the space
--    itself when it had no audience row to anchor the join in (3).
DELETE FROM tuple t
 WHERE t._user = 'user:*'
   AND t.object_type = 'space'
   AND t.object_id = 'docs';