import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Source guard: every tuple write must invalidate the ACL cache.
 *
 * The cache in `src/lib/aclCache.ts` is only safe because a tuple write makes
 * every prior answer unreachable. That guarantee has exactly one enforcement
 * point for application code (`openfga.ts` bumps the epoch itself) and a second
 * one for the one-off scripts that construct their own `OpenFgaClient`
 * (`withAclCacheInvalidation`). Both are easy to bypass by accident: a script
 * reaches for `fgaClient.write` because that is the shape of the OpenFGA docs,
 * the write succeeds, and nothing announces that authorization answers are now
 * stale.
 *
 * So this is asserted structurally rather than left to review. A new script that
 * writes tuples without wrapping is a failing test, not a latent
 * serve-a-revoked-grant bug.
 *
 * The one legitimate exception is `src/lib/openfga.ts`, which *is* the
 * implementation of the rule.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** `X.write({ writes: ... })` / `X.write({ deletes: ... })` — the tuple-write shape. */
const TUPLE_WRITE = /await\s+(\w+)\.write\(\s*\{\s*(writes|deletes)\b/;

const IMPLEMENTATION = join('src', 'lib', 'openfga.ts');

/**
 * Scripts allowed to write tuples without invalidating, each with the reason it
 * cannot affect live authorization.
 *
 * An exception list is only defensible while it is explicit. If one of these
 * stops being true, the guard should stop passing — so each entry names why it is
 * safe rather than being a blanket skip.
 */
const EXEMPT: Record<string, string> = {
  'scripts/verify-acl-model.ts':
    'writes to a throwaway store it creates and deletes, to prove model semantics before deploy; never touches the live store',
};

function scriptFiles(): string[] {
  return readdirSync(join(repoRoot, 'scripts'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join('scripts', f));
}

test.describe('ACL cache invalidation is structural, not conventional', () => {
  test('every script that writes tuples wraps the write in an invalidation', () => {
    const offenders: string[] = [];

    for (const rel of scriptFiles()) {
      const src = readFileSync(join(repoRoot, rel), 'utf8');

      if (!TUPLE_WRITE.test(src)) continue;
      if (rel in EXEMPT) continue;

      // A script may write tuples provided every such write sits inside the
      // wrapper. Counting is deliberately loose: the check is that the wrapper
      // is present at all in a file that writes tuples, which is the realistic
      // failure mode, rather than a per-call-site parse.
      if (!src.includes('withAclCacheInvalidation')) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These scripts write OpenFGA tuples without invalidating the ACL cache.\n` +
        `Wrap each write in withAclCacheInvalidation() from src/lib/aclCache, or ` +
        `route it through writeTuple/writeTuples/deleteTuple in src/lib/openfga.ts:\n` +
        offenders.map((f) => `  - ${f}`).join('\n')
    ).toEqual([]);
  });

  test('every exemption still exists and is still justified', () => {
    for (const [rel, reason] of Object.entries(EXEMPT)) {
      expect(() => readFileSync(join(repoRoot, rel), 'utf8'), `${rel} is exempted but no longer exists`).not.toThrow();
      expect(reason.length, `${rel} exemption has no stated reason`).toBeGreaterThan(20);
    }
  });

  test('openfga.ts — the implementation itself — bumps the epoch on every write path', () => {
    const src = readFileSync(join(repoRoot, IMPLEMENTATION), 'utf8');

    // writeTuple, writeTuples, deleteTuple must each invalidate. writeTuples
    // delegates to writeTuple, so requiring the bump in all three would only
    // assert that the word appears three times.
    const bumpCalls = src.match(/await bumpAclCacheEpoch\(\)/g) ?? [];
    expect(bumpCalls.length).toBeGreaterThanOrEqual(2);

    // And it must actually be imported, so the guard above cannot pass on a
    // stale copy.
    expect(src).toMatch(/import \{[^}]*bumpAclCacheEpoch[^}]*\} from '\.\/aclCache'/);
  });

  test('aclCache fails closed when it cannot verify the current epoch', () => {
    // Guards against a future "optimisation" that resolves the epoch from a
    // remembered value on failure. The unreachable-store case must return a miss,
    // not epoch 0 — treating it as 0 would serve entries written before an
    // outage that spanned a revocation.
    const src = readFileSync(join(repoRoot, 'src', 'lib', 'aclCache.ts'), 'utf8');

    expect(src).toMatch(/if \(!read\.reachable\)/);
    expect(src).not.toMatch(/reachable\) \? 0 : 0/);
  });
});