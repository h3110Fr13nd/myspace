import { expect, test } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';

/**
 * The tiled graph's security contract, against a real database:
 *
 *  - a public tile never shows a node that is no longer public (draft,
 *    unlisted, revoked, deleted), even before the pyramid is rebuilt;
 *  - a tile untouched by recent changes stays on the fast path;
 *  - an owner layer only ever shows its owner's nodes;
 *  - a change that lands during a build keeps the scope dirty.
 */

const ADMIN_URL = process.env.GRAPH_TEST_DATABASE_URL;
const DB = 'graph_tiles_test';
const ALICE = 'user:aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'user:bbbbbbbb-0000-4000-8000-000000000002';
const CAROL = 'user:cccccccc-0000-4000-8000-000000000003';

test.skip(!ADMIN_URL, 'GRAPH_TEST_DATABASE_URL not set');

let pool: pg.Pool;
let store: typeof import('../../src/lib/graph-tiles/store');
let builder: typeof import('../../src/lib/graph-tiles/builder');
let codec: typeof import('../../src/lib/spatial-tiles/codec');
/** The "engine": which objects user:* (and space:main#member) may view. */
const publicByEngine = new Set<string>();
const engine = async (objects: string[]) => new Map(objects.map((o) => [o, publicByEngine.has(o)]));
const workspaceByEngine = new Set<string>();
const workspaceEngine = async (objects: string[]) => new Map(objects.map((o) => [o, workspaceByEngine.has(o)]));
const members = new Set<string>([ALICE]);
const checks = { checkPublic: engine, checkWorkspace: workspaceEngine };
/** Per-user grants the engine knows about (direct or via group). */
const userGrants = new Map<string, Set<string>>([
  [ALICE, new Set(['document:carol-direct'])],
  [BOB, new Set(['document:carol-group'])],
]);
const userEngine = async (user: string, objects: string[]) =>
  new Map(objects.map((o) => [o, userGrants.get(user)?.has(o) ?? false]));

test.beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${DB}`;
  process.env.DATABASE_URL = url.toString();

  // 0013 edits OpenFGA's `tuple` table, which lives in the same database in
  // deployments; a stub lets the migration chain run here.
  const setup = new pg.Client({ connectionString: url.toString() });
  await setup.connect();
  await setup.query(`CREATE TABLE tuple (object_type text, object_id text, _user text)`);
  await setup.end();
  const { Migrator } = await import('../../src/lib/migrator');
  const migrator = new Migrator(url.toString());
  await migrator.up();

  store = await import('../../src/lib/graph-tiles/store');
  builder = await import('../../src/lib/graph-tiles/builder');
  codec = await import('../../src/lib/spatial-tiles/codec');
  pool = (await import('../../src/lib/db')).default;
  store.setPublicCheckForTests(engine);
  store.setWorkspaceChecksForTests(workspaceEngine, async (u) => members.has(u));
  store.setOverlayCheckForTests(userEngine);

  // A small workspace: a public folder with 40 public notes (linked in a
  // chain), one of Alice's private notes, and one of Bob's.
  const rows: Array<[string, string, string | null, string, boolean, string]> = [
    ['space:main', 'space', null, ALICE, true, '{}'],
    ['folder:pub', 'folder', 'space:main', ALICE, true, '{}'],
  ];
  for (let i = 0; i < 40; i++) {
    const wikilinks = i > 0 ? [`note-${i - 1}`] : [];
    rows.push([`document:n${i}`, 'document', 'folder:pub', ALICE, true, JSON.stringify({ slug: `note-${i}`, wikilinks })]);
  }
  rows.push(['document:alice-private', 'document', 'folder:pub', ALICE, false, JSON.stringify({ slug: 'ap', wikilinks: ['note-3'] })]);
  // Carol's notes: one shared with Alice by name, one with a group Bob is in.
  rows.push(['document:carol-direct', 'document', 'folder:pub', CAROL, false, JSON.stringify({ slug: 'cd' })]);
  rows.push(['document:carol-group', 'document', 'folder:pub', CAROL, false, JSON.stringify({ slug: 'cg' })]);
  // Shared with "everyone in the workspace", not public.
  for (let i = 0; i < 5; i++) {
    rows.push([`document:w${i}`, 'document', 'folder:pub', BOB, false, JSON.stringify({ slug: `ws-${i}`, wikilinks: ['note-2'] })]);
  }
  rows.push(['document:bob-private', 'document', 'folder:pub', BOB, false, JSON.stringify({ slug: 'bp', wikilinks: ['ap'] })]);
  for (const [id, type, parent, owner, isPublic, meta] of rows) {
    await pool.query(
      `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, type, parent, owner, id, `Title ${id}`, meta, isPublic]
    );
    if (isPublic) {
      publicByEngine.add(id);
      await pool.query(
        `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
         VALUES ($1, 'audience', 'user:*', 'viewer', 'audience')`,
        [id]
      );
    }
  }
  for (let i = 0; i < 5; i++) {
    workspaceByEngine.add(`document:w${i}`);
    await pool.query(
      `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
       VALUES ($1, 'group', 'space:main#member', 'viewer', 'audience')`,
      [`document:w${i}`]
    );
  }
  for (const [id, email] of [[BOB, 'bob_mock_user'], [CAROL, 'carol_mock_user']]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [id, email]);
  }
  await pool.query(`INSERT INTO groups (id, name) VALUES ('group:research', 'Research')`);
  await pool.query(`INSERT INTO group_memberships (group_id, user_id) VALUES ('group:research', $1)`, [BOB]);
  await pool.query(
    `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
     VALUES ('document:carol-direct', 'user', $1, 'viewer', 'direct'),
            ('document:carol-group', 'group', 'group:research#member', 'viewer', 'group')`,
    [ALICE]
  );
  await pool.query(`UPDATE acl_projection_state SET stale = FALSE WHERE id = 1`);
  const report = await builder.buildGraphTiles({ pool, scopes: 'all', ...checks });
  expect(report.resources).toBe(51);
});

test.afterAll(async () => {
  store?.setPublicCheckForTests(null);
  store?.setOverlayCheckForTests(null);
  store?.setWorkspaceChecksForTests(null, null);
  await pool?.end();
});

async function tileNodes(scope: string, z = 0, x = 0, y = 0) {
  store.clearGraphCaches();
  const { rows } = await pool.query(`SELECT generation FROM graph_scopes WHERE scope = $1`, [scope]);
  const res = await store.readTile({ scope, generation: rows[0].generation, z, x, y });
  expect(res.status).toBe(200);
  const tile = codec.decodeTile(
    res.headers['Content-Encoding'] === 'gzip' ? gunzipSync(res.body!) : res.body!
  );
  const gidToId = new Map<number, string>();
  const { rows: map } = await pool.query(`SELECT gid, resource_id FROM graph_nodes`);
  for (const r of map) gidToId.set(Number(r.gid), r.resource_id);
  return {
    ids: new Set(Array.from(tile.nodes.gid, (g) => gidToId.get(g) ?? `gone:${g}`)),
    verified: res.headers['X-Graph-Verified'] === '1',
    labels: tile.labels.text,
  };
}

test('layers hold exactly the right resources', async () => {
  const pub = await tileNodes('public');
  expect(pub.ids.size).toBe(42); // space, folder, 40 notes
  expect(pub.ids.has('document:alice-private')).toBe(false);
  expect(pub.ids.has('document:bob-private')).toBe(false);
  const alice = await tileNodes(`owner:${ALICE}`);
  expect([...alice.ids]).toEqual(['document:alice-private']);
  // Bob's note links to Alice's private note: no layer may draw that edge,
  // and Bob's layer never contains Alice's node.
  const bob = await tileNodes(`owner:${BOB}`);
  expect([...bob.ids]).toEqual(['document:bob-private']);
  // Workspace-shared notes form their own layer, even though Bob owns them.
  const ws = await tileNodes('workspace');
  expect([...ws.ids].sort()).toEqual(['document:w0', 'document:w1', 'document:w2', 'document:w3', 'document:w4']);
});

test('only verified workspace members are offered the workspace layer', async () => {
  store.clearGraphCaches();
  const alice = await store.getGraphMeta(ALICE);
  expect(alice.layers.map((l) => l.layer)).toEqual(['public', 'workspace', 'me']);
  const bob = await store.getGraphMeta(BOB);
  expect(bob.layers.map((l) => l.layer)).toEqual(['public', 'me']);
  const anon = await store.getGraphMeta('user:anonymous');
  expect(anon.layers.map((l) => l.layer)).toEqual(['public']);
});

async function overlayIds(user: string) {
  const { rows } = await pool.query(`SELECT min(x) AS x0, min(y) AS y0, max(x) AS x1, max(y) AS y1 FROM graph_nodes`);
  const r = rows[0];
  const bytes = await store.readOverlay({ currentUser: user, x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x1 + 1, y1: r.y1 + 1, limit: 100 });
  if (!bytes) return null;
  const tile = codec.decodeTile(bytes);
  const { rows: map } = await pool.query(`SELECT gid, resource_id FROM graph_nodes`);
  const byGid = new Map(map.map((m) => [Number(m.gid), m.resource_id]));
  return { ids: Array.from(tile.nodes.gid, (g) => byGid.get(g)).sort(), labels: tile.labels.text };
}

test('the shared-with-me overlay holds exactly what was shared by name or group', async () => {
  store.clearGraphCaches();
  expect(await store.hasSharedOverlay(ALICE)).toBe(true);
  expect((await store.getGraphMeta(ALICE)).overlay).toBe(true);
  const alice = await overlayIds(ALICE);
  expect(alice!.ids).toEqual(['document:carol-direct']);
  expect(alice!.labels).toEqual(['Title document:carol-direct']);
  const bob = await overlayIds(BOB);
  expect(bob!.ids).toEqual(['document:carol-group']);
  // Carol owns both: her own layer shows them; the overlay never repeats them.
  expect((await overlayIds(CAROL))!.ids).toEqual([]);
  expect(await overlayIds('user:anonymous')).toBeNull();
});

test('an overlay node the engine no longer allows is not returned', async () => {
  userGrants.get(ALICE)!.delete('document:carol-direct');
  expect((await overlayIds(ALICE))!.ids).toEqual([]);
  userGrants.get(ALICE)!.add('document:carol-direct');
  // A draft is hidden from everyone but its owner, grant or not.
  await pool.query(`UPDATE resources SET is_draft = TRUE WHERE id = 'document:carol-direct'`);
  expect((await overlayIds(ALICE))!.ids).toEqual([]);
  await pool.query(`UPDATE resources SET is_draft = FALSE WHERE id = 'document:carol-direct'`);
});

test('revoking the workspace audience removes a node from the workspace layer before any rebuild', async () => {
  workspaceByEngine.delete('document:w1');
  await pool.query(`DELETE FROM resource_effective_acl WHERE resource_id = 'document:w1'`);
  const ws = await tileNodes('workspace');
  expect(ws.ids.has('document:w1')).toBe(false);
  expect(ws.ids.has('document:w2')).toBe(true);
});

test('a note turned into a draft disappears from the public tile before any rebuild', async () => {
  await pool.query(`UPDATE resources SET is_draft = TRUE WHERE id = 'document:n5'`);
  const pub = await tileNodes('public');
  expect(pub.verified).toBe(true);
  expect(pub.ids.has('document:n5')).toBe(false);
  expect(pub.ids.has('document:n6')).toBe(true);
  expect(pub.labels).not.toContain('Title document:n5');
});

test('revoking public access removes the node even though its row did not change', async () => {
  publicByEngine.delete('document:n7');
  await pool.query(`DELETE FROM resource_effective_acl WHERE resource_id = 'document:n7'`);
  const pub = await tileNodes('public');
  expect(pub.ids.has('document:n7')).toBe(false);
  expect(pub.ids.has('document:n8')).toBe(true);
});

test('a deleted resource disappears, by the gid it used to have', async () => {
  await pool.query(`DELETE FROM resources WHERE id = 'document:n9'`);
  const pub = await tileNodes('public');
  expect([...pub.ids].some((id) => id.startsWith('gone:'))).toBe(false);
  expect(pub.ids.size).toBe(39); // 42 - n5 - n7 - n9
});

test('an owner layer keeps only nodes its owner still owns', async () => {
  await pool.query(`UPDATE resources SET owner_id = $1 WHERE id = 'document:alice-private'`, [BOB]);
  const alice = await tileNodes(`owner:${ALICE}`);
  expect(alice.ids.size).toBe(0);
});

test('a rebuild returns every scope to the fast path', async () => {
  await builder.buildGraphTiles({ pool, scopes: 'dirty', ...checks });
  const pub = await tileNodes('public');
  // The changed nodes are no longer in the rebuilt tile, so nothing in it
  // needs re-checking even though their change records are still recent.
  expect(pub.verified).toBe(false);
  expect(pub.ids.has('document:n5')).toBe(false);
  const { rows } = await pool.query(`SELECT dirty_at IS NULL AS clean FROM graph_scopes WHERE scope = 'public'`);
  expect(rows[0].clean).toBe(false); // changes within the 5 s snapshot margin keep it scheduled
});

test('a dirty scope whose tile holds no changed node still serves the stored tile', async () => {
  // A brand-new resource: the scope is dirty (rebuild needed to add it), but
  // no node already in the tile changed, so nothing needs re-checking.
  await pool.query(
    `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public)
     VALUES ('document:new', 'document', 'folder:pub', $1, 'document:new', 'New', '{}', TRUE)`,
    [ALICE]
  );
  const { rows } = await pool.query(`SELECT dirty_at > built_at AS dirty FROM graph_scopes WHERE scope = 'public'`);
  expect(rows[0].dirty).toBe(true);
  const pub = await tileNodes('public');
  expect(pub.verified).toBe(false);
  expect(pub.ids.has('document:new')).toBe(false);
});

test('old generations answer 410 so clients re-read meta', async () => {
  const { rows } = await pool.query(`SELECT generation FROM graph_scopes WHERE scope = 'public'`);
  const res = await store.readTile({ scope: 'public', generation: rows[0].generation - 5, z: 0, x: 0, y: 0 });
  expect(res.status).toBe(410);
});

test('the engine being unreachable fails closed for changed public nodes', async () => {
  await pool.query(`UPDATE resources SET title = 'Renamed' WHERE id = 'document:n1'`);
  store.setPublicCheckForTests(async () => {
    throw new Error('engine down');
  });
  try {
    const pub = await tileNodes('public');
    expect(pub.ids.has('document:n1')).toBe(false);
    // Unchanged nodes are unaffected: no engine call was needed for them.
    expect(pub.ids.has('document:n2')).toBe(true);
  } finally {
    store.setPublicCheckForTests(engine);
  store.setWorkspaceChecksForTests(workspaceEngine, async (u) => members.has(u));
  store.setOverlayCheckForTests(userEngine);
  }
});

test('a late-committing privacy change is still caught after a rebuild', async () => {
  // A transaction opens, makes a note private, and commits only after a build
  // has taken its snapshot. Its change record carries the (earlier) statement
  // time; readers must still re-verify it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE resources SET is_draft = TRUE WHERE id = 'document:n13'`);
    const build = builder.buildGraphTiles({ pool, scopes: 'all', ...checks });
    await new Promise((r) => setTimeout(r, 300));
    await client.query('COMMIT');
    await build;
  } finally {
    client.release();
  }
  const pub = await tileNodes('public');
  expect(pub.ids.has('document:n13')).toBe(false);
});

test('an edit that lands while a build runs keeps the scope dirty afterwards', async () => {
  let edited = false;
  const racingEngine = async (objects: string[]) => {
    if (!edited) {
      edited = true;
      // Runs after the build took its snapshot: this change is not in the tiles.
      await pool.query(`UPDATE resources SET is_draft = TRUE WHERE id = 'document:n11'`);
    }
    return engine(objects);
  };
  await builder.buildGraphTiles({ pool, scopes: 'all', checkPublic: racingEngine, checkWorkspace: workspaceEngine });
  const { rows } = await pool.query(`SELECT dirty_at > built_at AS dirty FROM graph_scopes WHERE scope = 'public'`);
  expect(rows[0].dirty).toBe(true);
  const pub = await tileNodes('public');
  expect(pub.ids.has('document:n11')).toBe(false);
});
