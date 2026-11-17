/**
 * Build the public documentation space (Option B).
 *
 * ── What this does and why ───────────────────────────────────────────────────
 *
 * `space:public_vault` currently holds two unrelated things:
 *
 *   platform documentation   product, pricing, permissions, roadmap, guides
 *   third-party research     research/* — 116 arXiv papers, book chapters,
 *                            conference papers, and an author's profile
 *
 * Publishing that space as "the documentation site" would put third-party
 * material under the platform's name and misrepresent content that is not ours
 * to document. So the split is made structural rather than cosmetic.
 *
 * The split is a MOVE, not a copy: the content keeps its ids, so no link, grant
 * or bookmark breaks. The structural `parent_folder` / `parent_space` tuples are
 * rewritten alongside `resources.parent_id`, because inheritance is read from
 * the tuples — leaving them pointing at the old parent would silently keep the
 * old tree in the access graph.
 *
 * ── Audience ─────────────────────────────────────────────────────────────────
 *
 * `user:* [viewer] space:docs` is written ONCE. The model already propagates
 * `viewer from parent_space` and `viewer from parent_folder`, so the whole
 * subtree inherits it. One grant, one place to revoke, and the exposure badge
 * tells the truth on every page.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 * Only the 17 platform-authored items move. The 116 third-party resources stay
 * in the sample vault, untouched and unpublished, because publishing someone
 * else's paper under this platform's name is a decision for a human.
 *
 *   npx tsx scripts/build-docs-space.ts           # report only
 *   npx tsx scripts/build-docs-space.ts --fix     # apply
 */
import 'dotenv/config';
import { query } from '../src/lib/db';
import { setAudience } from '../src/lib/acl/audience';
import { applyGrant, applyRevoke, ensureOwner, linkParent } from '../src/lib/acl/projector';
import { reconcileNow } from '../src/lib/acl/projection';
import { writeAudit } from '../src/lib/audit';
import { checkPermission } from '../src/lib/openfga';
import { logger } from '../src/lib/logger';

const FIX = process.argv.includes('--fix');

const DOCS_SPACE = 'space:docs';
const DOCS_SPACE_TITLE = 'Platform Documentation';
const SERVICE_PRINCIPAL = 'service_account:system';
const ADMIN_PRINCIPAL = 'service_account:system';

/**
 * Platform folders, REPARENTED under the docs space.
 *
 * Reparented rather than recreated under new ids. Their ids stay
 * `folder:public_vault_*`, which reads oddly next to `space:docs`, but changing
 * a resource id breaks every link, grant and bookmark pointing at it — and a
 * stale id is a cosmetic problem while a broken id is a real one. The
 * user-visible name comes from `title`, which these keep.
 */
const DOC_FOLDERS: string[] = [
  'folder:public_vault_product',
  'folder:public_vault_pricing',
  'folder:public_vault_permissions',
  'folder:public_vault_roadmap',
  'folder:public_vault_system-architecture-and-guides',
];

/**
 * A home for the authored pages that were filed under a *research* folder.
 *
 * These are platform-authored but sat inside `research-article-example-chapters-demo`
 * alongside third-party material, so they were one rename away from being
 * published as someone else's chapter.
 */
const GETTING_STARTED_FOLDER = 'folder:docs_getting-started';

const AUTHORED_DOCS = [
  'document:what-is-foss-workspace',
  'document:getting-started',
  'document:introduction',
  'document:built-with-this',
  'document:components',
  'document:debug-components',
  'document:best-practices',
  'document:writing-your-content',
  'document:markdown',
  'document:import-content',
  'document:vibe-coding-charts',
  'document:greetings',
  'document:extensible-resource-architecture-and-plugin-guide',
  'document:pricing',
  'document:permissions-deep-dive',
  'document:roadmap',
];

const SHOWCASE_CANVAS = 'canvas:omni-showcase';
const SHOWCASE_FOLDER = 'folder:docs_showcase';

interface Move {
  id: string;
  type: string;
  title: string;
  from: string | null;
  to: string;
  via: 'parent_space' | 'parent_folder';
}

async function main() {
  console.log(`[build-docs-space] mode: ${FIX ? 'APPLY' : 'report-only'}`);

  // ── Verify every source exists before touching anything ───────────────────
  const ids = [
    ...DOC_FOLDERS,
    ...AUTHORED_DOCS,
    SHOWCASE_CANVAS,
  ];
  const found = await query('SELECT id, type, title, parent_id FROM resources WHERE id = ANY($1)', [ids]);
  const byId = new Map((found.rows || []).map((r: any) => [r.id, r]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Cannot build the docs space: ${missing.length} expected resource(s) are absent — ` +
        `${missing.join(', ')}. Refusing to proceed on a partial picture.`
    );
  }
  console.log(`[build-docs-space] verified ${ids.length} source resource(s) exist`);

  const moves: Move[] = [
    ...DOC_FOLDERS.map((id) => {
      const row: any = byId.get(id);
      return {
        id,
        type: 'folder',
        title: row.title,
        from: row.parent_id ?? null,
        to: DOCS_SPACE,
        via: 'parent_space' as const,
      };
    }),
    {
      id: GETTING_STARTED_FOLDER,
      type: 'folder',
      title: 'Getting Started',
      from: 'folder:public_vault_research-article-example-chapters-demo',
      to: DOCS_SPACE,
      via: 'parent_space' as const,
    },
  ];

  // Each doc keeps its id and moves under the getting-started folder — except
  // the ones already inside a folder that is itself moving, which travel with
  // their parent and must not be reparented twice.
  for (const docId of AUTHORED_DOCS) {
    const row: any = byId.get(docId);
    const travelsWithParent = DOC_FOLDERS.includes(row.parent_id);
    if (travelsWithParent) continue;
    moves.push({
      id: docId,
      type: row.type,
      title: row.title,
      from: row.parent_id ?? null,
      to: GETTING_STARTED_FOLDER,
      via: 'parent_folder',
    });
  }

  // A canvas cannot hang directly off a space: the model gives `canvas` only
  // `parent_folder`, not `parent_space` (only `folder` has both). So the showcase
  // gets a folder to live in — otherwise its row says `parent_id = space:docs`
  // while the access graph has no edge, and it silently fails to inherit the
  // public audience.
  moves.push({
    id: SHOWCASE_FOLDER,
    type: 'folder',
    title: 'Showcase',
    from: null,
    to: DOCS_SPACE,
    via: 'parent_space',
  });
  moves.push({
    id: SHOWCASE_CANVAS,
    type: 'canvas',
    title: (byId.get(SHOWCASE_CANVAS) as any).title,
    from: (byId.get(SHOWCASE_CANVAS) as any).parent_id ?? null,
    to: SHOWCASE_FOLDER,
    via: 'parent_folder',
  });

  console.log(`\n[build-docs-space] plan: create 1 space, move ${moves.length} item(s)\n`);
  for (const m of moves) {
    const arrow = m.id === GETTING_STARTED_FOLDER ? 'NEW ' : 'MOVE';
    console.log(`  ${arrow} ${m.id.padEnd(58)} ${m.from ?? '(root)'} -> ${m.to}`);
  }

  // ── Sanity: never publish the third-party material ───────────────────────
  const thirdParty = await query(
    `SELECT count(*)::int AS n FROM resources
     WHERE owner_id = $1 AND (id ~ '(paper|conf|journal|presented|chapter|book)')`,
    [SERVICE_PRINCIPAL]
  );
  console.log(
    `\n[build-docs-space] ${thirdParty.rows?.[0]?.n ?? 0} third-party resource(s) will be LEFT in the sample vault, unpublished`
  );

  if (!FIX) {
    console.log('\n[build-docs-space] Re-run with --fix to apply.');
    return true;
  }

  // ── 1. The space itself ───────────────────────────────────────────────────
  console.log('[build-docs-space] step 1: the docs space');
  const existingSpace = await query('SELECT id FROM resources WHERE id = $1 LIMIT 1', [DOCS_SPACE]);
  if (!existingSpace.rows?.length) {
    await query(
      // `$1` serves both `id` (varchar) and `path` (text); without explicit
      // casts Postgres reports "inconsistent types deduced for parameter $1".
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
       VALUES ($1::varchar, 'space', 'tenant_default', NULL, $2::varchar, $1::text, $3::varchar, '{}'::jsonb, false, false)`,
      [DOCS_SPACE, SERVICE_PRINCIPAL, DOCS_SPACE_TITLE]
    );
    console.log(`\n[build-docs-space] created ${DOCS_SPACE}`);
  } else {
    console.log(`\n[build-docs-space] ${DOCS_SPACE} already exists`);
  }
  await ensureOwner(DOCS_SPACE, SERVICE_PRINCIPAL);
  await linkParent(DOCS_SPACE, 'space', 'main', 'parent_space');

  console.log('[build-docs-space] step 2: reparent');
  // ── 2. Move items ─────────────────────────────────────────────────────────
  let moved = 0;
  for (const m of moves) {
    // Create the row if it is a new folder id.
    const exists = await query('SELECT id FROM resources WHERE id = $1 LIMIT 1', [m.id]);
    const isNew = !exists.rows?.length;
    if (isNew) {
      await query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
         -- resources.type is a Postgres enum, so $2 is cast to that rather than
         -- to varchar.
         VALUES ($1::varchar, $2::resource_type, 'tenant_default', $3::varchar, $4::varchar, $1::text, $5::varchar, '{}'::jsonb, false, false)`,
        [m.id, m.type, m.to, SERVICE_PRINCIPAL, m.title]
      );
    } else {
      await query('UPDATE resources SET parent_id = $2 WHERE id = $1', [m.id, m.to]);
    }

    // The graph is what inheritance is read from, so the structural edge must be
    // rewritten too — and the old one revoked, or the previous tree would remain
    // in the access graph as a silent second path.
    if (m.from) {
      const via = m.from.startsWith('space:') ? 'parent_space' : 'parent_folder';
      await applyRevoke({ object: m.id, subject: m.from, relation: via }).catch(() => {});
    }
    await linkParent(
      m.id,
      m.via === 'parent_space' ? 'space' : 'folder',
      m.via === 'parent_space' ? m.to.replace('space:', '') : m.to.replace('folder:', ''),
      m.via
    );

    // A new row needs its owner tuple written too. `resources.owner_id` alone
    // leaves the graph not knowing who owns it — which the reconciler had to
    // repair after the first run, and which would have left the space
    // administrable only by the database fallback.
    if (isNew) await ensureOwner(m.id, SERVICE_PRINCIPAL);

    moved++;
  }
  console.log(`[build-docs-space] moved ${moved} item(s)`);

  console.log('[build-docs-space] step 3: audience');
  // ── 3. One audience grant, inherited down the tree ────────────────────────
  await setAudience({
    resourceId: DOCS_SPACE,
    kind: 'public_link',
    rung: 'viewer',
    actor: 'system:build-docs-space',
  });
  console.log('[build-docs-space] space:docs is now public_link @ viewer');

  // The service account's content is administered by a human, per
  // service_account_principals. Keep that true for the new space.
  const admin = await query(
    `SELECT principal_id FROM service_account_principals
     WHERE service_account_id = $1 AND role = 'manage_grants' LIMIT 1`,
    [SERVICE_PRINCIPAL]
  );
  const adminId = admin.rows?.[0]?.principal_id;
  if (adminId) {
    await applyGrant({ object: DOCS_SPACE, subject: adminId, relation: 'manage_grants' });
    await applyGrant({ object: DOCS_SPACE, subject: adminId, relation: 'editor' });
    await query(
      `INSERT INTO service_account_principals (service_account_id, principal_id, role)
       VALUES ($1, $2, 'manage_grants') ON CONFLICT DO NOTHING`,
      [SERVICE_PRINCIPAL, adminId]
    );
    console.log(`[build-docs-space] ${adminId} retains manage_grants on the docs space`);
  }

  await reconcileNow().catch(() => {});
  void writeAudit({
    actor: 'system:build-docs-space',
    action: 'docs.space_publish',
    resourceType: 'space',
    resourceId: DOCS_SPACE,
    detail: { moved, audience: 'public_link', rung: 'viewer' },
  });

  console.log('[build-docs-space] step 4: verify');
  // ── 4. Verify, by re-reading ──────────────────────────────────────────────
  console.log('\n[build-docs-space] verifying…');

  const tree = await query(
    `SELECT count(*)::int AS n FROM resources
     WHERE parent_id = $1 OR parent_id IN (SELECT id FROM resources WHERE parent_id = $1)`,
    [DOCS_SPACE]
  );
  // The datastore table has no `object` column; an object is object_type:object_id.
  // The `store` table can hold more than one row (verification scratch stores do),
  // so `LIMIT 1` can pick the wrong one and report a perfectly good grant as
  // missing. Read the configured store id.
  const wildcard = await query(
    `SELECT object_type || ':' || object_id AS obj, relation FROM tuple
     WHERE store = $1 AND _user = 'user:*'
       AND object_type = 'space' AND object_id = 'docs'`,
    [process.env.OPENFGA_STORE_ID]
  );
  const stillUnderResearch = await query(
    `SELECT count(*)::int AS n FROM resources
     WHERE id = ANY($1) AND parent_id LIKE '%research%'`,
    [AUTHORED_DOCS]
  );

  console.log(`  items in the docs tree:        ${tree.rows?.[0]?.n ?? 0}`);
  console.log(`  wildcard on space:docs:       ${JSON.stringify(wildcard.rows || [])}`);
  console.log(`  authored docs still under research: ${stillUnderResearch.rows?.[0]?.n ?? 0}`);

  // Proof that inheritance really works end to end, not just that a row moved:
  // the showcase canvas must resolve viewer for a stranger via space:docs.
  // `checkPermission` in src/lib/openfga.ts already unwraps to a boolean and
  // denies on engine failure, so this is a boolean, not the SDK response shape.
  const showcaseReadable = await checkPermission({
    user: 'user:dummy_mail',
    relation: 'viewer',
    object: SHOWCASE_CANVAS,
  });
  console.log(`  showcase canvas readable by a stranger: ${showcaseReadable}`);
  if (!showcaseReadable) {
    console.error('[build-docs-space] the showcase canvas does not inherit the public audience');
    return false;
  }

  const spaceAdmin = await query(
    `SELECT principal_id FROM service_account_principals
     WHERE service_account_id = $1 AND role = 'manage_grants' LIMIT 1`,
    [SERVICE_PRINCIPAL]
  );
  console.log(`  service account administrator: ${spaceAdmin.rows?.[0]?.principal_id ?? '(none)'}`);

  if ((stillUnderResearch.rows?.[0]?.n ?? 0) > 0) {
    console.error('[build-docs-space] some authored documents did not move');
    return false;
  }
  if ((wildcard.rows || []).length === 0) {
    console.error('[build-docs-space] the public grant is missing — the site would be unreachable');
    return false;
  }

  console.log('\n[build-docs-space] done');
  return true;
}

main()
  .then((ok) => {
    if (!ok) process.exit(1);
  })
  .catch((err) => {
    logger.error({ err: err.message }, '[build-docs-space] fatal');
    console.error('[build-docs-space] fatal:', err.message || err);
    process.exit(1);
  });
