import { expect, test } from '@playwright/test';
import {
  filterViewableResources,
  WORKSPACE_LIST_METADATA_FIELDS,
  type FilterViewableOptions,
} from '../../src/lib/permissions';

/**
 * Contract for the batched authorization path in `filterViewableResources`.
 *
 * A listing needs one decision per resource, and the homepage selects the whole
 * `resources` table, so issuing them one at a time makes a page render into
 * hundreds of round trips to the same engine. The batched seam collapses that.
 *
 * What matters here is not that batching is faster — it is that the semantics
 * survive. Every one of these cases has a same-shaped single-item counterpart in
 * `permissions-tree-visibility.spec.ts`, and a batch that quietly widened access
 * would be a much worse bug than a slow page. The rule the whole file turns on:
 * a resource is shown only on an explicit `true`. Absence, an error, or an
 * exception all deny.
 */

const ANON = 'user:anonymous';

const doc = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'document', owner_id: 'user:owner', ...extra }) as any;

const ids = (resources: any[]) => resources.map((r) => r.id);

test('workspace-list projection excludes tags that only the active resource reads', () => {
  expect(WORKSPACE_LIST_METADATA_FIELDS).toContain('wikilinks');
  expect(WORKSPACE_LIST_METADATA_FIELDS).toContain('aliases');
  expect(WORKSPACE_LIST_METADATA_FIELDS).not.toContain('tags');
});

test.describe('filterViewableResources batched engine', () => {
  test('keeps exactly the resources the engine allowed', async () => {
    const allowed = new Set(['doc:allowed', 'doc:also-allowed']);
    const checkBatch = async ({ objects }: { user: string; relation: string; objects: string[] }) =>
      new Map(objects.filter((o) => allowed.has(o)).map((o) => [o, true]));

    const out = await filterViewableResources(
      [doc('doc:allowed'), doc('doc:shut'), doc('doc:also-allowed')],
      ANON,
      { checkBatch } satisfies FilterViewableOptions
    );

    expect(ids(out).sort()).toEqual(['doc:allowed', 'doc:also-allowed']);
  });

  test('an object missing from the result is denied, not defaulted to allowed', async () => {
    // The engine omitting an item is "no decision", and the only safe reading of
    // a missing decision is deny.
    const checkBatch = async ({ objects }: { user: string; relation: string; objects: string[] }) =>
      new Map(objects.filter((o) => o === 'doc:known').map((o) => [o, true]));

    const out = await filterViewableResources(
      [doc('doc:known'), doc('doc:omitted')],
      ANON,
      { checkBatch }
    );

    expect(ids(out)).toEqual(['doc:known']);
  });

  test('a rejected batch denies everything rather than leaking the page', async () => {
    const checkBatch = async () => {
      throw new Error('engine unreachable');
    };

    const out = await filterViewableResources([doc('doc:a'), doc('doc:b')], ANON, { checkBatch });

    expect(out).toEqual([]);
  });

  test('the whole listing is settled in a single engine call', async () => {
    let calls = 0;
    let seen: string[] = [];
    const checkBatch = async ({ objects }: { user: string; relation: string; objects: string[] }) => {
      calls++;
      seen = objects;
      return new Map(objects.map((o) => [o, true]));
    };

    const many = Array.from({ length: 200 }, (_, i) => doc(`doc:${i}`));
    await filterViewableResources(many, ANON, { checkBatch });

    expect(calls).toBe(1);
    expect(seen).toHaveLength(200);
  });

  test('owners and drafts still short-circuit before the engine', async () => {
    // Triage must not be deferred into the batch, or an owner would be sent to
    // the engine for their own resources and drafts would become queryable.
    let seen: string[] = [];
    const checkBatch = async ({ objects }: { user: string; relation: string; objects: string[] }) => {
      seen = objects;
      return new Map();
    };

    const owned = { id: 'doc:mine', type: 'document', owner_id: ANON } as any;
    const draft = doc('doc:draft', { is_draft: true });

    const out = await filterViewableResources([owned, draft, doc('doc:other')], ANON, { checkBatch });

    expect(ids(out)).toEqual(['doc:mine']);
    expect(seen).toEqual(['doc:other']);
  });

  test('an injected single-item engine takes precedence and batching is skipped', async () => {
    // The existing specs inject only `check`. Re-interpreting that stub as a bulk
    // query would test the adapter rather than the filter, so `check` must win.
    let singleCalls = 0;
    let batchCalls = 0;

    const check = async ({ object }: { user: string; relation: string; object: string }) => {
      singleCalls++;
      return object === 'doc:ok';
    };
    const checkBatch = async () => {
      batchCalls++;
      return new Map<string, boolean>();
    };

    const out = await filterViewableResources([doc('doc:ok'), doc('doc:no')], ANON, { check, checkBatch });

    expect(singleCalls).toBe(2);
    expect(batchCalls).toBe(0);
    expect(ids(out)).toEqual(['doc:ok']);
  });

  test('anonymous callers are evaluated as the anonymous subject, not skipped', async () => {
    // A public link is a `user:*` grant; it only resolves if anonymous is sent
    // through the engine rather than assumed either way.
    let seenUser = '';
    const checkBatch = async ({ user }: { user: string; relation: string; objects: string[] }) => {
      seenUser = user;
      return new Map([['doc:p', true]]);
    };

    await filterViewableResources([doc('doc:p')], '', { checkBatch });

    expect(seenUser).toBe(ANON);
  });

  test('fresh wildcard hints share public checks while private resources use the real user', async () => {
    const calls: Array<{ user: string; objects: string[] }> = [];
    const checkBatch = async ({ user, objects }: { user: string; relation: string; objects: string[] }) => {
      calls.push({ user, objects });
      if (user === 'user:*') return new Map([['doc:public', true]]);
      return new Map(objects.filter((id) => id === 'doc:private-share').map((id) => [id, true]));
    };

    const out = await filterViewableResources(
      [doc('doc:public'), doc('doc:private-share')],
      'user:reader',
      { checkBatch, wildcardViewerIds: ['doc:public'] }
    );

    expect(ids(out).sort()).toEqual(['doc:private-share', 'doc:public']);
    expect(calls).toEqual([
      { user: 'user:*', objects: ['doc:public'] },
      { user: 'user:reader', objects: ['doc:private-share'] },
    ]);
  });

  test('a denied wildcard check falls back to the actual user', async () => {
    const users: string[] = [];
    const checkBatch = async ({ user }: { user: string; relation: string; objects: string[] }) => {
      users.push(user);
      return user === 'user:*' ? new Map<string, boolean>() : new Map([['doc:shared-directly', true]]);
    };

    const out = await filterViewableResources(
      [doc('doc:shared-directly')],
      'user:reader',
      { checkBatch, wildcardViewerIds: ['doc:shared-directly'] }
    );

    expect(ids(out)).toEqual(['doc:shared-directly']);
    expect(users).toEqual(['user:*', 'user:reader']);
  });

  test('anonymous callers keep the anonymous check even with wildcard hints', async () => {
    let seenUser = '';
    const checkBatch = async ({ user }: { user: string; relation: string; objects: string[] }) => {
      seenUser = user;
      return new Map([['doc:public', true]]);
    };

    await filterViewableResources([doc('doc:public')], ANON, {
      checkBatch,
      wildcardViewerIds: ['doc:public'],
    });

    expect(seenUser).toBe(ANON);
  });

  test('container re-admission still works on the batched path', async () => {
    // `allowFoldersForTree` is what keeps a shared document nesting under a
    // folder the viewer cannot open. If the batch path dropped it, the sidebar
    // would lose the shared document entirely.
    const folder = (id: string, extra: Record<string, unknown> = {}) =>
      ({ id, type: 'folder', owner_id: 'user:owner', ...extra }) as any;

    const resources = [
      folder('folder:private', { path: 'folder:private' }),
      doc('doc:shared', { parent_id: 'folder:private', path: 'folder:private/doc:shared' }),
    ];

    const checkBatch = async ({ objects }: { user: string; relation: string; objects: string[] }) =>
      new Map(objects.filter((o) => o === 'doc:shared').map((o) => [o, true]));

    const out = await filterViewableResources(resources, ANON, {
      allowFoldersForTree: true,
      checkBatch,
    });

    expect(ids(out).sort()).toEqual(['doc:shared', 'folder:private']);
  });
});
