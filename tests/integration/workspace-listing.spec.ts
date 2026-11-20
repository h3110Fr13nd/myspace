import { expect, test } from '@playwright/test';
import pg from 'pg';

/**
 * `listWorkspaceResourceCandidates` was rewritten for speed (the ancestor
 * test ran as a correlated subplan: 168 s at 1M resources, 8 s now). This
 * pins the rewrite to the original query's result set, using the original SQL
 * as the oracle, for several users over a tree with nested folders, folders
 * reachable only through `path`, empty folders, private subtrees and owners.
 */

const ADMIN_URL = process.env.GRAPH_TEST_DATABASE_URL;
const DB = 'workspace_listing_test';
const ALICE = 'user:aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'user:bbbbbbbb-0000-4000-8000-000000000002';

test.skip(!ADMIN_URL, 'GRAPH_TEST_DATABASE_URL not set');

let pool: pg.Pool;
let permissions: typeof import('../../src/lib/permissions');

/** The query as it was before the rewrite. */
const ORIGINAL = `WITH RECURSIVE candidates AS (
   SELECT id, parent_id, path FROM resources WHERE owner_id = $1 OR id = ANY($2::varchar[])
 ), ancestor_ids(id) AS (
   SELECT parent_id FROM candidates WHERE parent_id IS NOT NULL
   UNION
   SELECT path_segment.id
   FROM candidates child
   CROSS JOIN LATERAL unnest(string_to_array(child.path, '/')) AS path_segment(id)
   WHERE path_segment.id <> ''
   UNION
   SELECT parent.parent_id
   FROM resources parent
   JOIN ancestor_ids ancestor ON ancestor.id = parent.id
   WHERE parent.type IN ('folder', 'space') AND parent.parent_id IS NOT NULL
 )
 SELECT id FROM resources
 WHERE owner_id = $1
    OR id = ANY($2::varchar[])
    OR (type IN ('folder', 'space') AND id IN (SELECT id FROM ancestor_ids))
 ORDER BY title ASC`;

test.beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${DB}`;
  const setup = new pg.Client({ connectionString: url.toString() });
  await setup.connect();
  await setup.query(`CREATE TABLE tuple (object_type text, object_id text, _user text)`);
  await setup.end();
  const { Migrator } = await import('../../src/lib/migrator');
  await new Migrator(url.toString()).up();
  pool = new pg.Pool({ connectionString: url.toString() });
  permissions = await import('../../src/lib/permissions');

  // space:main
  //   folder:a            (alice)  -> folder:a1 -> public doc, alice private doc
  //   folder:b            (bob)    -> bob private doc only
  //   folder:empty        (bob)    -> nothing
  //   folder:deep1 -> deep2 -> deep3 -> public doc (ancestors via parent chain)
  //   document:orphan     public, parent_id NULL, ancestors only via `path`
  const rows: Array<[string, string, string | null, string, string, boolean]> = [
    ['space:main', 'space', null, ALICE, 'space:main', true],
    ['folder:a', 'folder', 'space:main', ALICE, 'space:main/folder:a', false],
    ['folder:a1', 'folder', 'folder:a', ALICE, 'space:main/folder:a/folder:a1', false],
    ['document:pub1', 'document', 'folder:a1', ALICE, 'space:main/folder:a/folder:a1/document:pub1', true],
    ['document:alice-private', 'document', 'folder:a1', ALICE, 'space:main/folder:a/folder:a1/document:alice-private', false],
    ['folder:b', 'folder', 'space:main', BOB, 'space:main/folder:b', false],
    ['document:bob-private', 'document', 'folder:b', BOB, 'space:main/folder:b/document:bob-private', false],
    ['folder:empty', 'folder', 'space:main', BOB, 'space:main/folder:empty', false],
    ['folder:deep1', 'folder', 'space:main', BOB, 'folder:deep1', false],
    ['folder:deep2', 'folder', 'folder:deep1', BOB, 'folder:deep2', false],
    ['folder:deep3', 'folder', 'folder:deep2', BOB, 'folder:deep3', false],
    ['document:deep-pub', 'document', 'folder:deep3', BOB, 'document:deep-pub', true],
    ['folder:pathonly', 'folder', null, BOB, 'folder:pathonly', false],
    ['document:orphan', 'document', null, BOB, 'folder:pathonly/document:orphan', true],
    ['document:shared-with-alice', 'document', 'folder:b', BOB, 'space:main/folder:b/document:shared-with-alice', false],
  ];
  for (const [id, type, parent, owner, path, isPublic] of rows) {
    await pool.query(
      `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', $7)`,
      [id, type, parent, owner, path, `Title ${id}`, isPublic]
    );
    if (isPublic) {
      await pool.query(
        `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
         VALUES ($1, 'audience', 'user:*', 'viewer', 'audience')`,
        [id]
      );
    }
  }
  await pool.query(
    `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
     VALUES ('document:shared-with-alice', 'user', $1, 'viewer', 'direct')`,
    [ALICE]
  );
  await pool.query(
    `INSERT INTO acl_projection_state (id, stale) VALUES (1, false)
     ON CONFLICT (id) DO UPDATE SET stale = false`
  );
});

test.afterAll(async () => {
  await pool?.end();
});

for (const [name, user] of [
  ['anonymous', 'user:anonymous'],
  ['alice', ALICE],
  ['bob', BOB],
] as const) {
  test(`same rows as the original query for ${name}`, async () => {
    const { rows } = await permissions.listWorkspaceResourceCandidates(user, { db: pool });
    const got = rows.map((r: any) => r.id);

    // The oracle gets the same candidate ids the function computed.
    const client = await pool.connect();
    let expected: string[];
    try {
      const cand = await client.query(
        `SELECT COALESCE(array_agg(DISTINCT resource_id), ARRAY[]::varchar[]) AS ids
         FROM resource_effective_acl
         WHERE source <> 'deny' AND rung IN ('viewer', 'commenter', 'editor', 'owner')
           AND (subject_id = 'user:*' OR subject_id = $1
                OR ($1 <> 'user:anonymous' AND subject_id = 'space:main#member'))`,
        [user]
      );
      expected = (await client.query(ORIGINAL, [user, cand.rows[0].ids])).rows.map((r: any) => r.id);
    } finally {
      client.release();
    }
    expect(got).toEqual(expected);
    // Sanity: the fixture exercises each branch.
    if (user === 'user:anonymous') {
      expect(got).toEqual(expect.arrayContaining(['folder:deep1', 'folder:deep3', 'folder:pathonly', 'folder:a1']));
      expect(got).not.toContain('folder:empty');
      expect(got).not.toContain('document:bob-private');
    }
    if (user === ALICE) expect(got).toContain('document:shared-with-alice');
  });
}
