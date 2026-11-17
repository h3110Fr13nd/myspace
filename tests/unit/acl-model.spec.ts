import { expect, test } from '@playwright/test';
import {
  assignableRelations,
  compileModel,
  declaredRelations,
  findDeadRelations,
} from '../../src/lib/acl/compileModel';
import { MODEL, STRUCTURAL_RELATIONS } from '../../src/lib/acl/modelSpec';
import { roleOptionsFor, principalKind, principalLabel, DENY_RELATIONS } from '../../src/components/iam/types';

/**
 * Structural guards on the authorization model.
 *
 * Each of these locks down a bug class that actually occurred in this codebase,
 * where the failure was silent rather than loud:
 *
 *  - `denied_viewer` was declared on 11 types and referenced by ZERO unions, so
 *    every "restrict access" rule was a no-op that failed OPEN.
 *  - `commenter` appeared in every role dropdown but was not in the model, so
 *    every grant of it was rejected by the engine while the UI kept offering it.
 *  - `user:*` was never an admissible subject, so the Public Access toggle could
 *    not write the tuple it claimed to write.
 */

test.describe('model reachability', () => {
  test('no declared relation is unreachable', () => {
    // A relation nothing can ever grant is dead weight that looks like a
    // security control. `denied_viewer` was exactly this.
    expect(findDeadRelations()).toEqual([]);
  });

  test('every deny relation is actually consulted somewhere', () => {
    // Denial is enforced in `guards.can()` rather than in the model, because
    // OpenFGA v1.5 cannot express negation. Assert the relations the guard
    // depends on therefore exist on every type that has a content ladder.
    for (const [type, spec] of Object.entries(MODEL)) {
      const rels = Object.keys(spec.relations);
      // Each deny guards the rung it names, so a type only needs the deny that
      // matches a relation it actually has. `tag` has no editor, so it needs no
      // denied_editor.
      if (rels.includes('viewer')) {
        expect(rels, `${type} has viewer but no denied_viewer`).toContain('denied_viewer');
      }
      if (rels.includes('editor')) {
        expect(rels, `${type} has editor but no denied_editor`).toContain('denied_editor');
      }
    }
  });

  test('every content type exposes the ACL capability relations', () => {
    // Without `read_acl` there is no way to gate "who can see who has access",
    // and the endpoint falls back to leaking the ACL to any viewer.
    for (const [type, spec] of Object.entries(MODEL)) {
      const rels = Object.keys(spec.relations);
      if (!rels.includes('viewer')) continue;
      expect(rels, `${type} is missing read_acl`).toContain('read_acl');
      expect(rels, `${type} is missing manage_grants`).toContain('manage_grants');
    }
  });

  test('structural relations are treated as structure, not grants', () => {
    for (const rel of STRUCTURAL_RELATIONS) {
      expect(rel.startsWith('parent_') || rel === 'tagged').toBe(true);
    }
  });
});

test.describe('public access is expressible but not over-powered', () => {
  test('content relations admit the public wildcard', () => {
    // The Public Access toggle writes `user:*`. If the model does not admit it,
    // the write is rejected and the toggle silently does nothing — which is what
    // happened for the entire life of this feature.
    const canvas = MODEL.canvas.relations;
    expect(canvas.viewer.wildcard).toBeDefined();
    expect(canvas.editor.wildcard).toBeDefined();
  });

  test('the ACL relations never admit the public wildcard', () => {
    // "Anyone with the link" must never be able to enumerate the ACL.
    for (const [type, spec] of Object.entries(MODEL)) {
      const readAcl = spec.relations.read_acl;
      if (!readAcl) continue;
      expect(readAcl.wildcard, `${type}#read_acl must not admit a wildcard`).toBeUndefined();
    }
  });

  test('wildcards are absent from the compiled metadata for ACL relations', () => {
    const compiled = compileModel();
    for (const td of compiled.type_definitions) {
      const meta = td.metadata?.relations;
      if (!meta?.read_acl?.directly_related_user_types) continue;
      const wildcards = meta.read_acl.directly_related_user_types.filter((t) => t.wildcard);
      expect(wildcards, `${td.type}#read_acl compiled a wildcard`).toEqual([]);
    }
  });
});

test.describe('role options are derived, not hand-maintained', () => {
  test('a type without commenter does not offer commenter', () => {
    const rels = declaredRelations('canvas');
    expect(rels).not.toContain('commenter');
    const options = roleOptionsFor(rels).map((r) => r.id);
    expect(options).not.toContain('commenter');
  });

  test('adding a relation to the model makes it offerable', () => {
    // Proves the picker is model-driven: if `commenter` were added to the spec,
    // it would appear without a UI change.
    const options = roleOptionsFor(['viewer', 'editor', 'owner', 'commenter']).map((r) => r.id);
    expect(options).toContain('commenter');
  });

  test('options are ordered strongest first', () => {
    const options = roleOptionsFor(['viewer', 'editor', 'owner']).map((r) => r.id);
    expect(options).toEqual(['owner', 'editor', 'viewer']);
  });

  test('an unknown type falls back rather than rendering an empty picker', () => {
    const options = roleOptionsFor(declaredRelations('not_a_real_type')).map((r) => r.id);
    expect(options.length).toBeGreaterThan(0);
  });

  test('deny relations are opt-in, never in the default grant list', () => {
    const rels = declaredRelations('canvas');
    const withDenies = roleOptionsFor(rels, { includeDenies: true }).map((r) => r.id);
    const without = roleOptionsFor(rels).map((r) => r.id);
    expect(withDenies).toContain('denied_viewer');
    expect(without).not.toContain('denied_viewer');
  });
});

test.describe('principal classification', () => {
  test('there is no circle type — groups are group#member', () => {
    // The UI advertised `circle:engineering`, a type that has never existed, so
    // its group-membership explanation was permanently unreachable.
    expect('circle' in MODEL).toBe(false);
    expect(principalKind('group:eng#member')).toBe('group');
    expect(principalKind('user:dummy_mail')).toBe('user');
    expect(principalKind('user:*')).toBe('public');
  });

  test('labels unwrap the type and userset prefix', () => {
    expect(principalLabel('group:eng#member')).toBe('eng');
    expect(principalLabel('user:dummy_mail')).toBe('dummy_mail');
    expect(principalLabel('user:*')).toBe('Anyone with the link');
  });
});

test.describe('assignable relations', () => {
  test('deny relations are directly assignable so they can be written', () => {
    for (const deny of DENY_RELATIONS) {
      expect(assignableRelations('canvas'), `canvas must allow writing ${deny}`).toContain(deny);
    }
  });

  test('an unknown type yields nothing rather than throwing', () => {
    expect(assignableRelations('nope')).toEqual([]);
    expect(declaredRelations('nope')).toEqual([]);
  });
});
