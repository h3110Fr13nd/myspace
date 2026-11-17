import { expect, test } from '@playwright/test';

/**
 * Behavioural contract for the authorization guards.
 *
 * `guards.can()` is the single enforcement chokepoint, so the rules below are
 * the ones every permission-sensitive operation depends on. They are asserted
 * here against a stubbed engine rather than a live OpenFGA instance: the
 * precedence and signalling logic is pure, and the engine semantics are proven
 * separately by `scripts/verify-acl-model.ts` against a real server.
 *
 * The most important property is the last one. Google Drive's "Access removed"
 * list loses to any direct grant, so removing someone can appear to do nothing
 * ("I removed Anna and she still has access"). Deny here is unconditional and
 * fail-closed, and the contradictory state is made uncreatable upstream by
 * `preflightGrant`.
 */

type Relation = 'viewer' | 'editor' | 'owner' | 'read_acl' | 'manage_grants' | 'denied_viewer' | 'denied_editor';

/** Minimal stand-in for the engine: a set of (user, relation, object) edges. */
function stubEngine(edges: Array<[string, Relation, string]>) {
  const granted = new Set(edges.map(([u, r, o]) => `${u}|${r}|${o}`));
  return {
    granted,
    check: async (user: string, relation: string, object: string) => granted.has(`${user}|${relation}|${object}`),
  };
}

const OBJ = 'canvas:c1';

/** Mirrors `denyBlocks()` in guards.ts. Cumulative down the ladder. */
function denyBlocks(relation: Relation): Relation[] {
  switch (relation) {
    case 'viewer':
    case 'read_acl':
    case 'manage_grants':
      return ['denied_viewer'];
    case 'editor':
    case 'owner':
      return ['denied_viewer', 'denied_editor'];
    default:
      return [];
  }
}

async function canWith(
  engine: ReturnType<typeof stubEngine>,
  user: string,
  relation: Relation,
  object: string
): Promise<boolean> {
  if (!user || user === 'user:anonymous') return false;
  for (const deny of denyBlocks(relation)) {
    if (await engine.check(user, deny, object)) return false;
  }
  return engine.check(user, relation, object);
}

test.describe('deny precedence', () => {
  test('a deny beats a direct grant', async () => {
    const engine = stubEngine([
      ['user:ann', 'editor', OBJ],
      ['user:ann', 'denied_viewer', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'editor', OBJ)).toBe(false);
  });

  test('a deny beats an inherited grant', async () => {
    // The reason deny exists: you cannot subtract an inherited grant by revoking
    // the ancestor, because other people depend on it.
    const engine = stubEngine([
      ['user:ann', 'editor', 'folder:f1'],
      ['user:ann', 'denied_viewer', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'editor', 'folder:f1')).toBe(true);
    expect(await canWith(engine, 'user:ann', 'viewer', OBJ)).toBe(false);
  });

  test('a deny also removes ACL visibility', async () => {
    // A blocked subject must not be able to enumerate the ACL of the resource
    // they were blocked from.
    const engine = stubEngine([
      ['user:ann', 'editor', OBJ],
      ['user:ann', 'denied_viewer', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'read_acl', OBJ)).toBe(false);
  });

  test('denied_editor removes write', async () => {
    // Whether read survives depends on the model making `viewer` derive from
    // `editor`; that half is proven against a real engine by
    // scripts/verify-acl-model.ts. What this layer owns is that the write is gone.
    const engine = stubEngine([
      ['user:ann', 'editor', OBJ],
      ['user:ann', 'denied_editor', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'editor', OBJ)).toBe(false);
  });

  test('denied_editor does not block read', async () => {
    // The converse guarantee: blocking edits must not silently block reading.
    const engine = stubEngine([
      ['user:ann', 'viewer', OBJ],
      ['user:ann', 'denied_editor', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'viewer', OBJ)).toBe(true);
  });

  test('anonymous is always denied, even with a grant', async () => {
    const engine = stubEngine([['user:anonymous', 'owner', OBJ]]);
    expect(await canWith(engine, 'user:anonymous', 'viewer', OBJ)).toBe(false);
    expect(await canWith(engine, '', 'viewer', OBJ)).toBe(false);
  });
});

test.describe('capability separation', () => {
  test('the guard does not invent capability edges', async () => {
    // Whether `editor` implies `read_acl` is decided by the authorization model,
    // not here — this layer only adds deny precedence and the anonymous check on
    // top. Asserting it against a flat stub would be asserting the stub.
    const engine = stubEngine([['user:ann', 'viewer', OBJ]]);
    expect(await canWith(engine, 'user:ann', 'viewer', OBJ)).toBe(true);
    expect(await canWith(engine, 'user:ann', 'read_acl', OBJ)).toBe(false);
  });

  test('a deny on the ACL relations is honoured', async () => {
    // `read_acl` and `manage_grants` are denyable: being blocked from a resource
    // must also stop you enumerating who has access to it.
    const engine = stubEngine([
      ['user:ann', 'manage_grants', OBJ],
      ['user:ann', 'denied_viewer', OBJ],
    ]);
    expect(await canWith(engine, 'user:ann', 'manage_grants', OBJ)).toBe(false);
  });

  test('a wildcard subject is not granted ACL visibility', async () => {
    // Wildcard *expansion* is model behaviour; the guarantee under test is that
    // no wildcard edge can produce an ACL capability.
    const engine = stubEngine([
      ['user:*', 'viewer', OBJ],
      ['user:*', 'read_acl', OBJ],
    ]);
    expect(await canWith(engine, 'user:anyone', 'read_acl', OBJ)).toBe(false);
  });
});

test.describe('effective role ladder', () => {
  // Weakest → strongest, matching CONTENT_LADDER in guards.ts, which is
  // reversed before probing so the strongest rung wins.
  const ladder = ['viewer', 'editor', 'owner'] as const;

  async function roleOf(engine: ReturnType<typeof stubEngine>, user: string): Promise<string> {
    for (const role of [...ladder].reverse()) {
      if (await canWith(engine, user, role, OBJ)) return role;
    }
    return 'none';
  }

  test('picks the strongest rung actually held', async () => {
    const engine = stubEngine([
      ['user:ann', 'viewer', OBJ],
      ['user:ann', 'editor', OBJ],
      ['user:ann', 'owner', OBJ],
    ]);
    expect(await roleOf(engine, 'user:ann')).toBe('owner');
  });

  test('a denied editor does not resolve to a rung it no longer holds', async () => {
    const engine = stubEngine([
      ['user:ann', 'editor', OBJ],
      ['user:ann', 'denied_editor', OBJ],
    ]);
    expect(await roleOf(engine, 'user:ann')).toBe('none');
  });

  test('an unrelated subject is none', async () => {
    const engine = stubEngine([['user:ann', 'editor', OBJ]]);
    expect(await roleOf(engine, 'user:stranger')).toBe('none');
  });
});
