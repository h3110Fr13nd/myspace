import { expect, test } from '@playwright/test';
import { MODEL } from '../../src/lib/acl/modelSpec';
import { declaredRelations, compileModel, findDeadRelations } from '../../src/lib/acl/compileModel';
import { toMemberUserset, groupIdsIn } from '../../src/lib/acl/groups';
import { exposureOf, isExpired, WORKSPACE_SUBJECT } from '../../src/lib/acl/audience';

/**
 * The two caveats this suite exists to keep closed.
 *
 * CAVEAT 1 — public access bypassed the authorization graph. `is_public` was
 * read in application code *before* OpenFGA, so 101 resources were public in
 * Postgres and private in the model. Publicness is now an audience slot that
 * projects real `user:*` / `space:main#member` grants.
 *
 * CAVEAT 2 — group grants resolved to nobody. `group_memberships` had rows and
 * the graph had zero `group:X#member` tuples, so a grant to a group returned
 * 200 "success" and reached zero people.
 *
 * A third bug bit three separate times during this work: parsing a fully
 * qualified OpenFGA object with `split(':')[1]`, which drops the type prefix.
 * `group:engineers` became `engineers`, so keys never matched and cleanup loops
 * deleted tuples they had just written. The tests below pin the safe helpers.
 */

const AUDIENCE_TYPES = [
  'space', 'folder', 'document', 'blog', 'canvas', 'canvas_node', 'sheet', 'form',
  'image', 'excalidraw', 'mermaid', 'paper', 'google_doc', 'google_sheet', 'todo',
  'collection', 'pdf', 'tag',
];

test.describe('audience subjects reach every content type', () => {
  // `folder` overrides `viewer`/`editor` to add `parent_space` inheritance. When
  // the audience subjects were injected inside the shared helper, that override
  // replaced them and 8 public folders silently could not be made public.
  for (const type of AUDIENCE_TYPES) {
    test(`${type} admits the public wildcard and the workspace userset`, () => {
      // `tag` deliberately has no `editor` rung, so assert per relation that
      // exists rather than demanding a relation the type never declared.
      const contentRungs = ['viewer', 'editor'].filter((r) => MODEL[type].relations[r]);
      expect(contentRungs.length, `${type} has no content rung at all`).toBeGreaterThan(0);
      for (const rel of contentRungs) {
        const spec = MODEL[type].relations[rel];
        expect(spec.wildcard, `${type}#${rel} lost the public wildcard`).toBeDefined();
        expect(
          spec.from?.some((f) => f === 'space#member'),
          `${type}#${rel} lost the workspace userset`
        ).toBe(true);
      }
    });

    test(`${type} never grants the ACL to an audience`, () => {
      const spec = MODEL[type].relations.read_acl;
      if (!spec) return;
      expect(spec.wildcard, `${type}#read_acl must not admit a wildcard`).toBeUndefined();
      expect(spec.from?.some((f) => f === 'space#member')).toBe(false);
    });
  }

  test('the compiled metadata agrees with the spec', () => {
    const compiled = compileModel();
    for (const type of ['folder', 'canvas', 'paper']) {
      const td = compiled.type_definitions.find((t) => t.type === type)!;
      const viewer = td.metadata!.relations.viewer.directly_related_user_types!;
      expect(viewer.some((t) => t.wildcard), `${type}#viewer lost its wildcard`).toBe(true);
      expect(
        viewer.some((t) => t.type === 'space' && t.relation === 'member'),
        `${type}#viewer lost space#member`
      ).toBe(true);
    }
  });
});

test.describe('workspace audience', () => {
  test('the workspace subject is the space userset', () => {
    expect(WORKSPACE_SUBJECT).toBe('space:main#member');
  });

  test('the space declares a member relation so the userset is valid', () => {
    // Without this the model rejects every `space:main#member` subject, and the
    // workspace audience silently resolves to nobody — caveat 2 all over again.
    expect(declaredRelations('space')).toContain('member');
    const member = MODEL.space.relations.member;
    expect(member.from).toContain('user');
  });
});

test.describe('group principals are parsed safely', () => {
  test('toMemberUserset adds the userset suffix and is idempotent', () => {
    expect(toMemberUserset('group:engineers')).toBe('group:engineers#member');
    expect(toMemberUserset('group:engineers#member')).toBe('group:engineers#member');
  });

  test('groupIdsIn keeps the type prefix', () => {
    // The bug: `t.object.split(':')[1]` yields `engineers`, which never matches
    // a `group:engineers` key and makes every membership look orphaned.
    const ids = groupIdsIn([{ user: 'group:engineers#member' }, { user: 'user:dummy_mail' }]);
    expect(ids).toEqual(['group:engineers']);
  });

  test('groupIdsIn ignores non-group subjects', () => {
    expect(groupIdsIn([{ user: 'user:*' }, { user: 'space:main#member' }, { user: 'user:ann' }])).toEqual([]);
  });
});

test.describe('exposure reporting', () => {
  test('public link outranks everything', () => {
    expect(exposureOf({ kind: 'public_link', rung: 'viewer', expiresAt: null }, true)).toBe('public_link');
  });

  test('an external grant outranks the workspace audience', () => {
    expect(exposureOf({ kind: 'workspace', rung: 'viewer', expiresAt: null }, true)).toBe('shared_externally');
  });

  test('workspace with no external grant reads as workspace', () => {
    expect(exposureOf({ kind: 'workspace', rung: 'viewer', expiresAt: null }, false)).toBe('workspace');
  });

  test('restricted with no external grant reads as restricted', () => {
    expect(exposureOf({ kind: 'restricted', rung: null, expiresAt: null }, false)).toBe('restricted');
  });
});

test.describe('audience expiry', () => {
  const past = new Date('2020-01-01T00:00:00Z');
  const future = new Date('2999-01-01T00:00:00Z');

  test('a lapsed link is expired', () => {
    expect(isExpired({ kind: 'public_link', rung: 'viewer', expiresAt: past })).toBe(true);
  });

  test('a future expiry is not expired', () => {
    expect(isExpired({ kind: 'public_link', rung: 'viewer', expiresAt: future })).toBe(false);
  });

  test('no expiry never lapses', () => {
    expect(isExpired({ kind: 'public_link', rung: 'viewer', expiresAt: null })).toBe(false);
  });
});

test.describe('the model is still coherent after the audience work', () => {
  test('no dead relations', () => {
    expect(findDeadRelations()).toEqual([]);
  });

  test('every audience type is a known type', () => {
    for (const type of AUDIENCE_TYPES) {
      expect(MODEL[type], `${type} is not in the model`).toBeTruthy();
    }
  });
});
