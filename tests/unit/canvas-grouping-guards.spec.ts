import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Source-level guards for the canvas group tree.
 *
 * The failure these prevent is silent and was the original defect. Group
 * membership used to be re-derived from geometry at every read, by two
 * functions that disagreed with each other: the badge counted one set of nodes,
 * the drag carried another, and "Fit Group to Contents" a third. Nothing threw,
 * nothing logged, and the UI looked correct — it was only wrong.
 *
 * Now membership is a stored `parentId` and the whole app reads one
 * `GroupIndex`. A stray `isNodeInGroup` call would reintroduce the split
 * silently, so it is worth a deliberate check rather than a code review.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANVAS_DIR = path.join(ROOT, 'src/components/canvas');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** Strip comments so prose about a call is not mistaken for the call itself. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * `core/grouping.ts` owns the tree; `core/geometry.ts` is where
 * `isNodeInGroup` is defined and `types.ts` re-exports it for back-compat. All
 * three are the definition side, not readers, so they are excluded — the guard
 * is about *call sites* deciding membership.
 */
const DEFINITION_SITES = new Set([
  path.join('core', 'grouping.ts'),
  path.join('core', 'geometry.ts'),
  'types.ts',
]);

const sources = walk(CANVAS_DIR)
  .filter((f) => ![...DEFINITION_SITES].some((d) => f.endsWith(d)))
  .map((f) => ({ file: path.relative(ROOT, f), code: stripComments(fs.readFileSync(f, 'utf-8')) }));

test.describe('membership is never re-derived from geometry', () => {
  test('no runtime call site uses isNodeInGroup', () => {
    /**
     * `isNodeInGroup` still exists — it is the migration input, and
     * `normalise` needs a geometric test to bootstrap from. What must not exist
     * is a *reader* using it to decide membership at runtime.
     */
    const offenders = sources.filter((s) => /isNodeInGroup\s*\(/.test(s.code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  test('the badge count comes from the children index', () => {
    const editor = read('src/components/canvas/CanvasEditor.tsx');
    expect(editor).toMatch(/groupIndex\.containedIds\(/);
    // The old shape: a filter over every node, per group, per frame.
    expect(editor).not.toMatch(/nodes\.filter\(\s*\(child\)\s*=>/);
  });

  test('a group drag takes its subtree from the tree, not from overlap', () => {
    const pointer = read('src/components/canvas/core/usePointerInteraction.ts');
    expect(pointer).toMatch(/descendantIds\(/);
  });

  test('marquee resolves hits to top-level units', () => {
    const pointer = read('src/components/canvas/core/usePointerInteraction.ts');
    expect(pointer).toMatch(/topLevelUnitOf\(/);
  });
});

test.describe('every node write goes through the invariant pass', () => {
  test('the editor has a single commit path', () => {
    const editor = read('src/components/canvas/useCanvasEditor.ts');
    expect(editor).toMatch(/const commit = useCallback\(/);
  });

  test('setNodes is only called where a commit is impossible or unwanted', () => {
    /**
     * The legitimate direct writes are: applying an undo snapshot, the
     * normalised load, and drag/cancel previews (which run per frame and are
     * intentionally raw — the invariants run on commit instead).
     *
     * Anything else means a mutation bypassed the invariant pass, so membership
     * could reach a state nothing else defends against.
     */
    const editor = read('src/components/canvas/useCanvasEditor.ts');
    const writes = editor
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => /^setNodes\(/.test(text));

    const allowed = /setNodes\((snapshot\.nodes|loadedNodes|finalNodes|next|restored)\)/;
    const unexpected = writes.filter((w) => !allowed.test(w.text));
    expect(unexpected).toEqual([]);
  });

  test('membership is never written as a bare field outside the core', () => {
    /**
     * Handlers describe intent — reparent, group, ungroup — and the core
     * applies the invariants. A component setting `parentId` directly could skip
     * the cycle check, so the write is confined to `core/grouping.ts`.
     */
    const offenders = sources.filter((s) => /\.\.\.[a-zA-Z]+,\s*parentId\s*:/.test(s.code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

test.describe('membership is documented as a user decision', () => {
  test('the field is declared with both modes and a default', () => {
    const types = read('src/components/canvas/types.ts');
    expect(types).toMatch(/membership\?:\s*'spatial'\s*\|\s*'structural'/);
  });

  test('an absent value means spatial, in exactly one place', () => {
    const core = read('src/components/canvas/core/grouping.ts');
    expect(core).toMatch(/return node\.membership \?\? 'spatial';/);
  });
});
