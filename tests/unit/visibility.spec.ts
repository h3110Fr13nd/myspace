import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { asBooleanFlag, isDraftResource, isUnlistedResource } from '../../src/lib/visibility';

/**
 * Contract for the draft/unlisted visibility flags.
 *
 * These two flags decide whether a resource is visible to someone who is not its
 * owner, and they were computed in five places from the same metadata. The copies
 * had drifted: the vault importer accepted a *string* `"true"`, the four readers
 * accepted only the boolean. So `unlisted: "true"` in frontmatter hid a note from
 * search (indexed via the importer) while leaving it fully readable and present
 * in the folder tree.
 *
 * The assertions below are mostly about coercion, because coercion is where the
 * copies disagreed. The last describe block is a source guard: `migrations/0003`
 * creates a real `resources.unlisted` column that nothing writes or reads, and a
 * `WHERE unlisted = false` filter on it matches every row while looking correct.
 */

// Playwright loads specs as ESM, where the CommonJS `__dirname` does not exist —
// the same trap that silently disabled the e2e migrations (see the note in
// tests/setup/global-setup.ts).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

test.describe('asBooleanFlag', () => {
  test('accepts the boolean and its string spellings', () => {
    expect(asBooleanFlag(true)).toBe(true);
    expect(asBooleanFlag('true')).toBe(true);
    expect(asBooleanFlag('  True  ')).toBe(true);
    expect(asBooleanFlag('TRUE')).toBe(true);
  });

  test('rejects everything else, including plausible-looking truthiness', () => {
    // Deliberately strict. If `"no"` or `0` counted as true, a typo in
    // frontmatter would silently hide a note — the worse direction of error.
    for (const value of ['false', 'no', 'yes', '1', 1, 0, '', ' ', null, undefined, {}, []]) {
      expect(asBooleanFlag(value)).toBe(false);
    }
  });
});

test.describe('isUnlistedResource', () => {
  test('reads both metadata spellings', () => {
    expect(isUnlistedResource({ metadata: { unlisted: true } })).toBe(true);
    expect(isUnlistedResource({ metadata: { isUnlisted: true } })).toBe(true);
  });

  test('treats a quoted "true" as unlisted — the case the copies disagreed on', () => {
    // This is the regression. Before the shared helper, the importer said true
    // and the reader said false, so the note was searchable but readable.
    expect(isUnlistedResource({ metadata: { unlisted: 'true' } })).toBe(true);
  });

  test('does not read the dead `unlisted` column', () => {
    // Nothing populates it (see the source guard below), so honouring it would
    // mean a resource silently became unlisted if some future write path set it
    // for an unrelated reason.
    expect(isUnlistedResource({ unlisted: true } as any)).toBe(false);
  });

  test('tolerates missing, null and non-object metadata', () => {
    expect(isUnlistedResource({})).toBe(false);
    expect(isUnlistedResource({ metadata: null })).toBe(false);
    expect(isUnlistedResource(null)).toBe(false);
    expect(isUnlistedResource(undefined)).toBe(false);
  });
});

test.describe('isDraftResource', () => {
  test('honours the is_draft column, which is real and written', () => {
    expect(isDraftResource({ is_draft: true })).toBe(true);
    expect(isDraftResource({ is_draft: false, metadata: {} })).toBe(false);
  });

  test('falls back to metadata, with the same coercion as unlisted', () => {
    expect(isDraftResource({ metadata: { draft: true } })).toBe(true);
    expect(isDraftResource({ metadata: { isDraft: 'true' } })).toBe(true);
    expect(isDraftResource({ metadata: { draft: 'false' } })).toBe(false);
  });
});

test.describe('every visibility call site uses the shared helper', () => {
  const callSites = [
    'src/lib/permissions.ts',
    'src/lib/workspace/treeBuilder.ts',
    'src/lib/vaultSync.ts',
    'src/lib/meilisearch.ts',
    'src/pages/api/v1/search.ts',
    'scripts/sync_meilisearch.ts',
  ];

  test('no file re-implements the flag inline', () => {
    // A sixth hand-rolled copy is how the original drift happened. Any file that
    // names the metadata keys directly is re-deriving the rule.
    const offenders: string[] = [];
    for (const rel of callSites) {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      if (/metadata\??\.(unlisted|isUnlisted|draft|isDraft)\s*===/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no Postgres query reads the dead `unlisted` column', () => {
    // `WHERE unlisted = false` on an always-false column matches every row, so a
    // filter that looks like a visibility guard would silently be a no-op. Public
    // feeds now use the same OpenFGA-backed filter as the workspace listings.
    //
    // Scoped to the SQL handed to `query()`, because the same word legitimately
    // appears elsewhere: as a Meilisearch filter on the *indexed document* field
    // (search.ts) and as a TypeScript property (meilisearch.ts). Neither touches
    // the column, and flagging them would train people to ignore this guard.
    const offenders: string[] = [];
    for (const rel of [...callSites, 'src/pages/sitemap.xml.ts', 'src/pages/feed.xml.ts']) {
      const src = stripComments(readFileSync(join(repoRoot, rel), 'utf-8'));
      for (const sql of extractQueryArgs(src)) {
        // A bare column reference: not preceded by `.` / `->>` / `:` / a quote.
        if (/(?<![.\w>'":])\bunlisted\b(?![\w:])/.test(sql)) offenders.push(rel);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

/** Remove `//` and `/* *\/` comments so prose cannot trip the source guards. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The SQL strings actually passed to `query(...)`.
 *
 * Deliberately approximate — it finds each call and takes the balanced text up
 * to the closing paren, which is enough because none of these queries contain a
 * nested call with its own parens in the middle of the SQL.
 */
function extractQueryArgs(src: string): string[] {
  const out: string[] = [];
  const re = /query\(\s*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    const end = src.indexOf('`', start);
    if (end > start) out.push(src.slice(start, end));
  }
  return out;
}
