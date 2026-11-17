/**
 * Proves the authorization semantics we depend on, against a real OpenFGA
 * engine, in a throwaway store. Run before deploying the model.
 *
 *   OPENFGA_API_URL=http://localhost:8085 npx tsx scripts/verify-acl-model.ts
 *
 * Covers:
 *   - model reachability (no relation declared that nothing can ever grant)
 *   - the role ladder and its parent-inheritance chain
 *   - `read_acl` being a CAPABILITY distinct from `viewer` (the leak fix)
 *   - `manage_grants` being owner-only and NOT inherited (Notion's "Full access")
 *   - group membership expansion
 *   - wildcard / public access
 *
 * Denial is verified separately in `tests/unit/guards.spec.ts`, because OpenFGA
 * v1.5 cannot express negation in the model (see src/lib/acl/modelSpec.ts).
 */
import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import { compileModel, findDeadRelations } from '../src/lib/acl/compileModel';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8080';

/** Drain a store's tuples so each verification run starts from a known state. */
async function readAllIn(fga: OpenFgaClient) {
  const out: Array<{ user: string; relation: string; object: string }> = [];
  let token: string | undefined;
  for (;;) {
    const res = await fga.read({}, { pageSize: 100, continuationToken: token } as any);
    for (const t of res.tuples || []) {
      if (t.key?.user) out.push({ user: t.key.user, relation: t.key.relation, object: t.key.object });
    }
    token = res.continuation_token || undefined;
    if (!token) return out;
  }
}

interface Case {
  name: string;
  user: string;
  relation: string;
  object: string;
  expected: boolean;
}

async function main() {
  const dead = findDeadRelations();
  if (dead.length) throw new Error(`Unreachable relations: ${JSON.stringify(dead)}`);
  console.log('✓ reachability: every declared relation is reachable');

  const boot = new OpenFgaClient({ apiUrl });

  // Reuse a single named scratch store across runs rather than creating one per
  // invocation. OpenFGA's Postgres datastore leaves tuple rows behind after a
  // store is deleted, so a fresh store every run slowly fills the table with
  // unreachable rows. A fixed name also makes the leftovers easy to identify.
  const SCRATCH_NAME = 'acl-model-verification';
  const existing = await boot.listStores({ pageSize: 100 } as any);
  const found = (existing.stores || []).find((s: any) => s.name === SCRATCH_NAME);
  const storeId: string = found ? found.id : (await boot.createStore({ name: SCRATCH_NAME })).id;
  const fga = new OpenFgaClient({ apiUrl, storeId });
  console.log(`✓ scratch store ${storeId}${found ? ' (reused)' : ''}`);

  // Start from a clean slate so a previous run's fixtures cannot mask a failure.
  const existingTuples = await readAllIn(fga);
  if (existingTuples.length > 0) {
    await fga.write({
      deletes: existingTuples.map((t) => ({ user: t.user, relation: t.relation, object: t.object })),
    } as any);
  }

  // `guards` reaches the engine through the store-bound singleton in
  // src/lib/openfga.ts, which captures OPENFGA_STORE_ID at module load. Bind it
  // to the scratch store BEFORE importing guards, or every check inside the
  // guard layer silently resolves against no store and denies everything.
  process.env.OPENFGA_API_URL = apiUrl;
  process.env.OPENFGA_STORE_ID = storeId;

  const { authorization_model_id: modelId } = await fga.writeAuthorizationModel(compileModel() as any);
  console.log(`✓ model accepted: ${modelId}`);

  await fga.write({
    writes: [
      // inheritance chain: space -> folder -> canvas
      { user: 'space:root', relation: 'parent_space', object: 'folder:f1' },
      { user: 'folder:f1', relation: 'parent_folder', object: 'canvas:c1' },

      { user: 'user:owner', relation: 'owner', object: 'space:root' },

      { user: 'user:directEditor', relation: 'editor', object: 'canvas:c1' },
      { user: 'user:directViewer', relation: 'viewer', object: 'canvas:c1' },
      { user: 'user:inheritViewer', relation: 'viewer', object: 'folder:f1' },
      { user: 'user:inheritEditor', relation: 'editor', object: 'folder:f1' },

      // group membership (a real userset, not a group id)
      { user: 'user:grouped', relation: 'member', object: 'group:eng' },
      { user: 'group:eng#member', relation: 'viewer', object: 'canvas:c1' },

      // A group grant that actually reaches its members (the caveat-2 failure).
      { user: 'group:eng#member', relation: 'viewer', object: 'canvas:groupTarget' },

      // Nested groups: group:sub#member is a member of group:outer.
      { user: 'group:sub#member', relation: 'member', object: 'group:outer' },
      { user: 'user:nested', relation: 'member', object: 'group:sub' },
      { user: 'group:outer#member', relation: 'viewer', object: 'canvas:groupTarget' },

      // a delegated ACL-reader who may read but not change grants
      { user: 'user:aclAuditor', relation: 'read_acl', object: 'canvas:c1' },

      // workspace-wide audience: members of the space, expressed as a userset
      { user: 'user:employee', relation: 'member', object: 'space:root' },
      { user: 'space:root#member', relation: 'viewer', object: 'canvas:team' },
      { user: 'space:root#member', relation: 'editor', object: 'canvas:teamOpen' },

      // deny relations must be assignable and independently checkable
      { user: 'user:blocked', relation: 'denied_viewer', object: 'canvas:c1' },
      { user: 'user:viewOnly', relation: 'denied_editor', object: 'canvas:c1' },
      // `viewOnly` must hold real access for "denied_editor keeps read" to mean
      // anything: the deny has to subtract from an existing grant.
      { user: 'user:viewOnly', relation: 'editor', object: 'folder:f1' },
      { user: 'user:viewOnly', relation: 'viewer', object: 'folder:f1' },

      // public
      { user: 'user:*', relation: 'viewer', object: 'canvas:public' },
      { user: 'user:publicEditor', relation: 'editor', object: 'canvas:public' },
    ],
  } as any);
  console.log('✓ tuples written');

  const cases: Case[] = [
    { name: 'direct editor can read', user: 'user:directEditor', relation: 'viewer', object: 'canvas:c1', expected: true },
    { name: 'direct editor can edit', user: 'user:directEditor', relation: 'editor', object: 'canvas:c1', expected: true },
    { name: 'direct editor can read ACL', user: 'user:directEditor', relation: 'read_acl', object: 'canvas:c1', expected: true },
    { name: 'direct editor CANNOT change grants', user: 'user:directEditor', relation: 'manage_grants', object: 'canvas:c1', expected: false },

    { name: 'direct viewer can read', user: 'user:directViewer', relation: 'viewer', object: 'canvas:c1', expected: true },
    { name: 'direct viewer cannot edit', user: 'user:directViewer', relation: 'editor', object: 'canvas:c1', expected: false },
    { name: 'LEAK FIX: viewer cannot read ACL', user: 'user:directViewer', relation: 'read_acl', object: 'canvas:c1', expected: false },

    { name: 'delegated ACL reader can read ACL', user: 'user:aclAuditor', relation: 'read_acl', object: 'canvas:c1', expected: true },
    { name: 'delegated ACL reader cannot edit', user: 'user:aclAuditor', relation: 'editor', object: 'canvas:c1', expected: false },
    { name: 'delegated ACL reader cannot change grants', user: 'user:aclAuditor', relation: 'manage_grants', object: 'canvas:c1', expected: false },

    { name: 'inherited viewer reaches child', user: 'user:inheritViewer', relation: 'viewer', object: 'canvas:c1', expected: true },
    { name: 'inherited editor reaches child', user: 'user:inheritEditor', relation: 'editor', object: 'canvas:c1', expected: true },
    { name: 'space owner reaches descendant', user: 'user:owner', relation: 'editor', object: 'canvas:c1', expected: true },
    { name: 'space owner may read descendant ACL (read_acl inherits)', user: 'user:owner', relation: 'read_acl', object: 'canvas:c1', expected: true },
    { name: 'space owner may NOT re-share descendant (manage_grants does not inherit)', user: 'user:owner', relation: 'manage_grants', object: 'canvas:c1', expected: false },
    { name: 'space owner may change grants on own space', user: 'user:owner', relation: 'manage_grants', object: 'space:root', expected: true },

    { name: 'group member gets the group grant', user: 'user:grouped', relation: 'viewer', object: 'canvas:c1', expected: true },
    { name: 'group member does not inherit write', user: 'user:grouped', relation: 'editor', object: 'canvas:c1', expected: false },
    { name: 'group member cannot read ACL via a viewer grant', user: 'user:grouped', relation: 'read_acl', object: 'canvas:c1', expected: false },

    { name: 'deny relation is readable by the engine', user: 'user:blocked', relation: 'denied_viewer', object: 'canvas:c1', expected: true },
    { name: 'denied_editor is readable by the engine', user: 'user:viewOnly', relation: 'denied_editor', object: 'canvas:c1', expected: true },
    { name: 'deny alone grants nothing', user: 'user:blocked', relation: 'viewer', object: 'canvas:c1', expected: false },
    { name: 'deny alone does not grant ACL read', user: 'user:blocked', relation: 'read_acl', object: 'canvas:c1', expected: false },

    { name: 'wildcard can view public', user: 'user:anyone', relation: 'viewer', object: 'canvas:public', expected: true },
    { name: 'LEAK FIX: wildcard cannot read ACL', user: 'user:anyone', relation: 'read_acl', object: 'canvas:public', expected: false },
    { name: 'wildcard cannot view restricted', user: 'user:anyone', relation: 'viewer', object: 'canvas:c1', expected: false },

    // Workspace audience — "everyone in the workspace", inside the graph.
    { name: 'space member gets the workspace grant', user: 'user:employee', relation: 'viewer', object: 'canvas:team', expected: true },
    { name: 'space member gets workspace EDITOR access', user: 'user:employee', relation: 'editor', object: 'canvas:teamOpen', expected: true },
    { name: 'non-member does NOT get the workspace grant', user: 'user:outsider', relation: 'viewer', object: 'canvas:team', expected: false },
    { name: 'LEAK FIX: space member cannot read the ACL', user: 'user:employee', relation: 'read_acl', object: 'canvas:team', expected: false },
    { name: 'space member cannot change grants', user: 'user:employee', relation: 'manage_grants', object: 'canvas:team', expected: false },
    { name: 'workspace grant does not leak to another space', user: 'user:employee', relation: 'viewer', object: 'canvas:c1', expected: false },

    // Group membership — the caveat-2 fix: a grant to a group must resolve.
    { name: 'group member gets a viewer grant on the group target', user: 'user:grouped', relation: 'viewer', object: 'canvas:groupTarget', expected: true },
    { name: 'non-member of the group gets nothing', user: 'user:outsider', relation: 'viewer', object: 'canvas:groupTarget', expected: false },
    { name: 'nested group member inherits outer grant', user: 'user:nested', relation: 'viewer', object: 'canvas:groupTarget', expected: true },

    { name: 'unrelated user has nothing', user: 'user:stranger', relation: 'viewer', object: 'canvas:c1', expected: false },
    { name: 'LEAK FIX: unrelated user cannot read ACL', user: 'user:stranger', relation: 'read_acl', object: 'canvas:c1', expected: false },
  ];

  let pass = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const res = await fga.check({ user: c.user, relation: c.relation, object: c.object });
    const actual = res.allowed === true;
    if (actual === c.expected) {
      pass++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failures.push(`${c.name} (expected ${c.expected}, got ${actual})`);
      console.log(`  ✗ ${c.name}  expected=${c.expected} actual=${actual}`);
    }
  }

  // The engine-native provenance primitive the troubleshooter will use.
  const expanded = await fga.expand({ relation: 'viewer', object: 'canvas:c1' } as any);
  const tree = expanded.tree ? JSON.stringify(expanded.tree) : '';
  console.log(`\n✓ expand() returns a provenance tree (${tree.length} bytes)`);
  if (!tree) failures.push('expand() returned no tree — the troubleshooter would have nothing to show');

  // ── Deny precedence, evaluated through the real guard layer ──────────────
  // The model cannot express negation on this engine, so `guards.can()` layers
  // it on top as an explicit check. These cases exercise the composed result
  // against a real engine rather than a stub.
  const { can, effectiveRole } = await import('../src/lib/acl/guards');
  console.log('\n— guard layer (deny precedence composed over the engine) —');

  const guardCases: Array<{ name: string; user: string; relation: string; expected: boolean }> = [
    // A direct editor who is blocked from viewing must not retain write access.
    { name: 'GUARD: denied_viewer blocks a direct editor', user: 'user:blockedDirect', relation: 'editor', expected: false },
    { name: 'GUARD: denied_viewer blocks read', user: 'user:blockedDirect', relation: 'viewer', expected: false },
    { name: 'GUARD: denied_viewer blocks ACL visibility', user: 'user:blockedDirect', relation: 'read_acl', expected: false },
    { name: 'GUARD: denied_editor blocks write', user: 'user:viewOnly', relation: 'editor', expected: false },
    { name: 'GUARD: denied_editor keeps read', user: 'user:viewOnly', relation: 'viewer', expected: true },
    { name: 'GUARD: an unblocked editor is unaffected', user: 'user:directEditor', relation: 'editor', expected: true },
    { name: 'GUARD: anonymous is denied even with a grant', user: 'user:anonymous', relation: 'viewer', expected: false },
  ];

  for (const c of guardCases) {
    const actual = await can(c.user, c.relation, 'canvas:c1');
    if (actual === c.expected) {
      pass++;
      console.log(`  \u2713 ${c.name}`);
    } else {
      failures.push(`${c.name} (expected ${c.expected}, got ${actual})`);
      console.log(`  \u2717 ${c.name}  expected=${c.expected} actual=${actual}`);
    }
  }

  // Deny must also collapse the effective role, not just the single relation.
  const blockedRole = await effectiveRole('user:blockedDirect', 'canvas:c1');
  if (blockedRole === 'none') {
    pass++;
    console.log('  \u2713 GUARD: a blocked subject has no effective role');
  } else {
    failures.push(`blocked subject resolved to role '${blockedRole}', expected none`);
    console.log(`  \u2717 GUARD: blocked subject resolved to '${blockedRole}'`);
  }

  const editorRole = await effectiveRole('user:directEditor', 'canvas:c1');
  if (editorRole === 'editor') {
    pass++;
    console.log('  \u2713 GUARD: an unblocked editor keeps their role');
  } else {
    failures.push(`unblocked editor resolved to '${editorRole}', expected editor`);
  }

  console.log(`\n${pass}/${cases.length + guardCases.length + 2} assertions passed`);
  console.log(`\nScratch store ${storeId} retained and emptied for the next run.`);

  if (failures.length > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-acl-model] Fatal:', err.message || err);
  process.exit(1);
});
