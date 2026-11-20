import { expect, test } from '@playwright/test';
import {
  PUBLIC_SCOPE,
  WORKSPACE_SCOPE,
  edgeScope,
  edgeScopeCode,
  ownerScope,
  resolveScopeParam,
  scopeOf,
  scopesForUser,
} from '../../src/lib/graph-tiles/scopes';
import { GRAPH_KINDS, kindCode, kindName } from '../../src/lib/graph-tiles/kinds';

const ALICE = 'user:aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'user:bbbbbbbb-0000-4000-8000-000000000002';

test.describe('graph tile scopes', () => {
  test('a resource lands in exactly one layer', () => {
    expect(scopeOf({ ownerId: ALICE, hidden: false, publicVerified: true })).toBe(PUBLIC_SCOPE);
    // Public wins over workspace; workspace wins over the owner's private layer.
    expect(scopeOf({ ownerId: ALICE, hidden: false, publicVerified: true, workspaceVerified: true })).toBe(PUBLIC_SCOPE);
    expect(scopeOf({ ownerId: ALICE, hidden: false, publicVerified: false, workspaceVerified: true })).toBe(WORKSPACE_SCOPE);
    expect(scopeOf({ ownerId: ALICE, hidden: true, publicVerified: false, workspaceVerified: true })).toBe(ownerScope(ALICE));
    // Drafts and unlisted never go public, even with a user:* grant.
    expect(scopeOf({ ownerId: ALICE, hidden: true, publicVerified: true })).toBe(ownerScope(ALICE));
    expect(scopeOf({ ownerId: ALICE, hidden: false, publicVerified: false })).toBe(ownerScope(ALICE));
    expect(scopeOf({ ownerId: '', hidden: false, publicVerified: false })).toBeNull();
  });

  test('edges never join two private layers', () => {
    const a = ownerScope(ALICE);
    const b = ownerScope(BOB);
    expect(edgeScope(PUBLIC_SCOPE, PUBLIC_SCOPE)).toBe(PUBLIC_SCOPE);
    expect(edgeScope(a, PUBLIC_SCOPE)).toBe(a);
    expect(edgeScope(PUBLIC_SCOPE, a)).toBe(a);
    expect(edgeScope(a, a)).toBe(a);
    expect(edgeScope(a, b)).toBeNull();
    // The narrower layer stores a mixed edge.
    expect(edgeScope(PUBLIC_SCOPE, WORKSPACE_SCOPE)).toBe(WORKSPACE_SCOPE);
    expect(edgeScope(WORKSPACE_SCOPE, a)).toBe(a);
    expect(edgeScope(a, WORKSPACE_SCOPE)).toBe(a);
  });

  test('the integer form used by the builder agrees with the string form', () => {
    const names = [PUBLIC_SCOPE, WORKSPACE_SCOPE, ownerScope(ALICE), ownerScope(BOB)];
    const code = (s: string) => names.indexOf(s);
    for (const x of names) {
      for (const y of names) {
        const expected = edgeScope(x, y);
        const got = edgeScopeCode(code(x), code(y));
        expect(got < 0 ? null : names[got]).toBe(expected);
      }
    }
    expect(edgeScopeCode(-1, 0)).toBe(-1);
  });

  test('URL layers: `public`, `workspace` (signed in) and the caller\'s own `me`', () => {
    expect(resolveScopeParam('public', 'user:anonymous')).toBe(PUBLIC_SCOPE);
    expect(resolveScopeParam('me', ALICE)).toBe(ownerScope(ALICE));
    expect(resolveScopeParam('workspace', ALICE)).toBe(WORKSPACE_SCOPE);
    // Anonymous has no private or workspace layer, and nobody can name another user's.
    expect(resolveScopeParam('workspace', 'user:anonymous')).toBeNull();
    expect(resolveScopeParam('me', 'user:anonymous')).toBeNull();
    expect(resolveScopeParam(ownerScope(BOB), ALICE)).toBeNull();
    expect(resolveScopeParam('owner', ALICE)).toBeNull();
    expect(resolveScopeParam(undefined, ALICE)).toBeNull();
    expect(scopesForUser('user:anonymous')).toEqual([PUBLIC_SCOPE]);
    expect(scopesForUser(ALICE)).toEqual([PUBLIC_SCOPE, WORKSPACE_SCOPE, ownerScope(ALICE)]);
  });

  test('kind codes follow the classic graph normalisation and are stable', () => {
    expect(kindCode({ id: 'folder:x', type: 'document' })).toBe(GRAPH_KINDS.indexOf('folder'));
    expect(kindCode({ id: 'doc:x', type: 'document', entityType: 'paper' })).toBe(GRAPH_KINDS.indexOf('paper'));
    expect(kindCode({ id: 'doc:x', type: 'unknown-type' })).toBe(0);
    expect(kindName(kindCode({ id: 'canvas:x', type: 'canvas' }))).toBe('canvas');
    // Wire-format stability: the first codes must never move.
    expect(GRAPH_KINDS.slice(0, 4)).toEqual(['document', 'folder', 'space', 'canvas']);
  });
});
