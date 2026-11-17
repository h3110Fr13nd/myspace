import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterViewableResources, type FilterViewableOptions } from '../../src/lib/permissions';

/**
 * Contract for the container names in a filtered listing.
 *
 * `allowFoldersForTree` used to short-circuit every `folder` and `space` into the
 * allowed set, so the anonymous homepage payload listed a user's private
 * hierarchy by name — `Academic Research Vault`, `77 Research Papers` — while
 * correctly denying the children. The data stayed private and the directory of
 * it did not.
 *
 * Containers now have to earn their place in the tree: through the graph like
 * anything else, or by being an ancestor of something already allowed. That
 * second rule is what keeps the fix from breaking the sidebar, because imported
 * content carries its hierarchy in `path` while rows created in-app only have
 * `parent_id`, and a shared document must still nest under a folder the viewer
 * cannot open themselves.
 *
 * The engine is injected through `FilterViewableOptions.check` rather than by
 * standing up a stub HTTP server and setting `OPENFGA_API_URL`. That was tried
 * first and it is a trap: Playwright reuses worker processes, so once any other
 * spec in the same worker has imported `src/lib/openfga.ts` — which captures its
 * endpoint at module scope — the env var is ignored, and the filter silently
 * consults the real engine. The public cases then read production data and fail
 * in a way that looks like a permissions bug. Reassigning the module export does
 * not help either; ES module namespaces are read-only.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Stands in for OpenFGA, mirroring the one behaviour that matters here.
 *
 * OpenFGA >= 1.4 treats `user:*` written as a tuple subject as a *wildcard*
 * matching every subject of type `user`, not as a literal user id — verified
 * against the local engine, where `user:anonymous` resolves a `user:*` grant
 * exactly as `user:*` does. A stub that only answered for the literal string
 * `user:*` would fail every public case here.
 */
function engineAllowing(publicObjects: string[]) {
  const grants = new Set(publicObjects);
  return async ({ user, object }: { user: string; object: string }) =>
    user.startsWith('user:') && grants.has(object);
}

const folder = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'folder', owner_id: 'user:owner', ...extra }) as any;

const doc = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'document', owner_id: 'user:owner', ...extra }) as any;

const ANON = 'user:anonymous';
const OWNER = 'user:owner';

const tree = { allowFoldersForTree: true } satisfies FilterViewableOptions;
const ids = (resources: any[]) => resources.map((r) => r.id);

test.describe('filterViewableResources container names', () => {
  test('does not disclose a private container name to an anonymous viewer', async () => {
    const resources = [
      folder('folder:private_root', { path: 'folder:private_root' }),
      folder('folder:private_child', {
        parent_id: 'folder:private_root',
        path: 'folder:private_root/folder:private_child',
      }),
      doc('doc:private_note', {
        parent_id: 'folder:private_child',
        path: 'folder:private_root/folder:private_child/doc:private_note',
      }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing([]),
    });
    expect(visible).toEqual([]);
  });

  test('keeps a public document and the containers it nests under', async () => {
    const resources = [
      folder('folder:vault', { path: 'space:public_vault/folder:vault' }),
      folder('folder:vault_pricing', {
        parent_id: 'folder:vault',
        path: 'space:public_vault/folder:vault/folder:vault_pricing',
      }),
      doc('doc:public_note', {
        parent_id: 'folder:vault_pricing',
        path: 'space:public_vault/folder:vault/folder:vault_pricing/doc:public_note',
      }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toEqual(['folder:vault', 'folder:vault_pricing', 'doc:public_note']);
  });

  test('resolves ancestors from `path` when `parent_id` is absent', async () => {
    // Imported content never gets `parent_id`. Relying on it alone would leave a
    // public document with no tree to sit in — and, worse, would look correct in
    // tests built from `parent_id` while the real importer produced orphans.
    const resources = [
      folder('folder:vault', { parent_id: null, path: 'space:public_vault/folder:vault' }),
      doc('doc:public_note', {
        parent_id: null,
        path: 'space:public_vault/folder:vault/doc:public_note',
      }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toContain('folder:vault');
  });

  test('walks trailing-slash paths and avoids duplicate parent ancestors', async () => {
    const resources = [
      { id: 'space:public_vault', type: 'space', owner_id: 'user:owner', path: 'space:public_vault' },
      folder('folder:vault', { path: 'space:public_vault/folder:vault' }),
      doc('doc:public_note', {
        parent_id: 'folder:vault',
        path: 'space:public_vault/folder:vault/doc:public_note/',
      }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toEqual(['space:public_vault', 'folder:vault', 'doc:public_note']);
  });

  test('does not re-admit an empty private container', async () => {
    // A private folder with no access and no visible child must not appear. The
    // previous behaviour listed every one of them.
    const resources = [
      folder('folder:private_empty', { path: 'folder:private_root/folder:private_empty' }),
      doc('doc:public_note', { path: 'space:public_vault/doc:public_note' }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toEqual(['doc:public_note']);
  });

  test('survives a cyclic path without looping', async () => {
    // Importers are untrusted input. A self-referential container must not hang
    // the request that renders the tree.
    const resources = [
      folder('folder:a', { path: 'folder:b/folder:a' }),
      folder('folder:b', { path: 'folder:a/folder:b' }),
      doc('doc:public_note', { path: 'folder:a/doc:public_note' }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toContain('doc:public_note');
  });

  test('the owner still sees their own private hierarchy', async () => {
    const resources = [
      folder('folder:mine', { path: 'folder:mine' }),
      doc('doc:mine', { parent_id: 'folder:mine', path: 'folder:mine/doc:mine' }),
    ];

    // `check` throws on every call: an owner must never reach the engine here.
    const visible = await filterViewableResources(resources, OWNER, {
      ...tree,
      check: async () => {
        throw new Error('owner path must not consult the engine');
      },
    });
    expect(ids(visible)).toEqual(['folder:mine', 'doc:mine']);
  });

  test('without allowFoldersForTree a container is not pulled in by a child', async () => {
    // Listings (search, tags) must not resurrect a private folder name just
    // because a visible document happens to live inside it.
    const resources = [
      folder('folder:vault', { path: 'space:public_vault/folder:vault' }),
      doc('doc:public_note', {
        parent_id: 'folder:vault',
        path: 'space:public_vault/folder:vault/doc:public_note',
      }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      check: engineAllowing(['doc:public_note']),
    });
    expect(ids(visible)).toEqual(['doc:public_note']);
  });

  test('a container that is itself public stays visible with no visible children', async () => {
    // The ancestor rule is additive, not a replacement for the graph: a
    // deliberately public container must still be listed even when empty.
    const resources = [folder('folder:public_empty', { path: 'space:public_vault/folder:public_empty' })];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: engineAllowing(['folder:public_empty']),
    });
    expect(ids(visible)).toEqual(['folder:public_empty']);
  });

  test('a rejected engine call denies rather than leaking', async () => {
    // `checkPermission` fails closed on an unreachable engine. A container must
    // not slip through the ancestor path in that case either, since the closure
    // only walks from resources the graph already approved.
    const resources = [
      folder('folder:vault', { path: 'space:public_vault/folder:vault' }),
      doc('doc:note', { parent_id: 'folder:vault', path: 'space:public_vault/folder:vault/doc:note' }),
    ];

    const visible = await filterViewableResources(resources, ANON, {
      ...tree,
      check: async () => {
        throw new Error('engine unreachable');
      },
    });
    expect(visible).toEqual([]);
  });

  test('source guard: no caller may reintroduce the blanket container grant', async () => {
    // A regression here reads as an innocuous optimisation in review, so the
    // shape of the filter is asserted rather than trusted.
    const source = readFileSync(join(repoRoot, 'src/lib/permissions.ts'), 'utf8');

    expect(source).not.toMatch(/allowFolders\s*&&\s*\(\s*r\.type/);
    expect(source).not.toMatch(/r\.type\s*===\s*'folder'[^;]*allowedImmediate\.push/);
  });
});
