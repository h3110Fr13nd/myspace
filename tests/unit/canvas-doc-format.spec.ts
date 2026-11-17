import { expect, test } from '@playwright/test';

import {
  CANVAS_ENCODINGS,
  GROUPING_MARKER,
  GROUPING_VERSION,
  detectStyle,
  isSettled,
  migrateCanvasDoc,
  serialise,
  type CanvasDoc,
} from '../../src/lib/canvas/canvasDocFormat';
import { GroupIndex, worldPosition } from '../../src/components/canvas/core/grouping';
import type { CanvasNode } from '../../src/components/canvas/types';

const n = (o: Partial<CanvasNode> & { id: string }): CanvasNode =>
  ({ type: 'text', x: 0, y: 0, width: 100, height: 100, ...o }) as CanvasNode;
const g = (o: Partial<CanvasNode> & { id: string }): CanvasNode =>
  n({ type: 'group', ...o });

const doc = (nodes: CanvasNode[], extra: Partial<CanvasDoc> = {}): CanvasDoc => ({
  title: 't',
  nodes,
  edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }],
  ...extra,
});

test.describe('serialise', () => {
  test('emits 2-space JSON', () => {
    expect(serialise({ a: 1 }, false, '')).toBe('{\n  "a": 1\n}');
  });

  test('ascii mode escapes non-ascii as utf-16 code units', () => {
    // A single emoji is a surrogate pair, so it must become two escapes. This
    // is how the files written by the escaping serialiser are stored on disk,
    // and reproducing them is the only way to migrate those files in place
    // without reflowing them.
    expect(serialise({ t: '🌟' }, true, '')).toBe('{\n  "t": "\\ud83c\\udf1f"\n}');
  });

  test('unicode mode leaves non-ascii literal', () => {
    expect(serialise({ t: '🌟' }, false, '')).toBe('{\n  "t": "\u{1F31F}"\n}');
  });

  test('appends the requested line ending', () => {
    expect(serialise({ a: 1 }, false, '\n').endsWith('}\n')).toBe(true);
  });
});

test.describe('detectStyle', () => {
  test('recognises a file it can reproduce byte-for-byte', () => {
    const original = serialise({ a: 1, t: 'x' }, false, '');
    const style = detectStyle(original, { a: 1, t: 'x' });
    expect(style?.ascii).toBe(false);
    expect(style?.eol).toBe('');
  });

  test('carries over the original trailing whitespace verbatim', () => {
    // One file in the corpus ends in a blank line, so this cannot be a fixed
    // list of newline variants: whatever was there has to survive.
    for (const trailing of ['', '\n', '\n\n', '  \n\n']) {
      const original = serialise({ a: 1 }, false, trailing);
      expect(detectStyle(original, { a: 1 })?.eol).toBe(trailing);
    }
  });

  test('distinguishes the ascii-escaped encoding', () => {
    const escaped = serialise({ t: '🌟' }, true, '');
    expect(detectStyle(escaped, { t: '\u{1F31F}' })?.ascii).toBe(true);
  });

  test('returns null for a body it cannot reproduce', () => {
    // Trailing whitespace is forgiven, but a blank line *inside* the document
    // is not something any candidate can write.
    expect(detectStyle('{\n\n  "a": 1\n}', { a: 1 })).toBeNull();
  });

  test('every encoding candidate is reachable', () => {
    expect(CANVAS_ENCODINGS.map((e) => e.ascii)).toEqual([false, true]);
  });
});

test.describe('migrateCanvasDoc', () => {
  test('adopts contained nodes and marks the document', () => {
    const { doc: out, report } = migrateCanvasDoc(
      doc([g({ id: 'grp', x: 0, y: 0, width: 500, height: 500 }), n({ id: 'a', x: 100, y: 100 }), n({ id: 'b', x: 200, y: 200 })])
    );
    expect(report.adopted).toBe(2);
    expect(out.nodes!.find((x) => x.id === 'a')!.parentId).toBe('grp');
    expect(out[GROUPING_MARKER]).toBe(GROUPING_VERSION);
  });

  test('preserves unrelated document fields and unknown node fields', () => {
    const source = doc(
      [
        g({ id: 'grp', x: 0, y: 0, width: 500, height: 500 }),
        { ...n({ id: 'a', x: 10, y: 10 }), color: '6', label: 'A', nested: { deep: true } } as CanvasNode,
        n({ id: 'b', x: 20, y: 20 }),
      ],
      { title: 'keep me', customField: [1, 2, 3] }
    );
    const { doc: out } = migrateCanvasDoc(source);
    expect(out.title).toBe('keep me');
    expect(out.customField).toEqual([1, 2, 3]);
    expect(out.edges).toEqual(source.edges);
    const a = out.nodes!.find((x) => x.id === 'a') as CanvasNode & { color: string; label: string };
    expect(a.color).toBe('6');
    expect(a.label).toBe('A');
  });

  test('does not move content: leaf world positions survive', () => {
    const nodes = [
      g({ id: 'grp', x: 0, y: 0, width: 900, height: 900 }),
      n({ id: 'a', x: 120, y: 140 }),
      n({ id: 'b', x: 400, y: 380 }),
    ];
    const before = new Map(nodes.map((x) => [x.id, worldPosition(nodes, x.id)]));
    const { doc: out } = migrateCanvasDoc(doc(nodes));
    for (const node of out.nodes!) {
      if (node.type === 'group') continue;
      expect(worldPosition(out.nodes!, node.id)).toEqual(before.get(node.id));
    }
  });

  test('reports dissolved groups so deletions are auditable', () => {
    // One child: dissolves, per the tldraw threshold this design adopted.
    const { dissolvedGroupIds } = migrateCanvasDoc(
      doc([g({ id: 'lonely', x: 0, y: 0, width: 500, height: 500 }), n({ id: 'a', x: 10, y: 10 })])
    );
    expect(dissolvedGroupIds).toEqual(['lonely']);
  });

  test('is idempotent: a second pass is a no-op', () => {
    const first = migrateCanvasDoc(
      doc([g({ id: 'grp', x: 0, y: 0, width: 900, height: 900 }), n({ id: 'a', x: 120, y: 140 }), n({ id: 'b', x: 400, y: 380 })])
    );
    const second = migrateCanvasDoc(first.doc);
    expect(second.wasStamped).toBe(true);
    expect(second.report.alreadyCurrent).toBe(true);
    expect(serialise(second.doc, false, '')).toBe(serialise(first.doc, false, ''));
  });

  test('a stamped document does not re-derive membership from geometry', () => {
    /**
     * Both groups sit at the same world origin, and `other` is strictly smaller,
     * so re-deriving membership from `x`/`y` would pull `a`/`b` out of `grp` and
     * into `other`: their *local* coordinates (10,10) and (20,20) fall inside
     * `other`'s 200x200 local rect. Each group has two real children, so neither
     * dissolves and the theft is visible rather than masked.
     */
    const geometry = () => [
      g({ id: 'grp', x: 0, y: 0, width: 500, height: 500 }),
      g({ id: 'other', x: 0, y: 0, width: 200, height: 200 }),
      n({ id: 'a', x: 10, y: 10, parentId: 'grp' }),
      n({ id: 'b', x: 20, y: 20, parentId: 'grp' }),
      n({ id: 'c', x: 5, y: 5, parentId: 'other' }),
      n({ id: 'd', x: 100, y: 100, parentId: 'other' }),
    ];

    // Unstamped: membership is inferred, and the smaller group wins.
    const inferred = migrateCanvasDoc(doc(geometry()));
    expect(inferred.report.adopted).toBeGreaterThan(0);
    expect(inferred.doc.nodes!.find((x) => x.id === 'a')!.parentId).toBe('other');

    // Stamped: membership is stated, and is left alone.
    const stamped = doc(geometry());
    stamped[GROUPING_MARKER] = GROUPING_VERSION;
    const trusted = migrateCanvasDoc(stamped);
    expect(trusted.report.adopted).toBe(0);
    expect(trusted.doc.nodes!.find((x) => x.id === 'a')!.parentId).toBe('grp');
    expect(trusted.doc.nodes!.find((x) => x.id === 'b')!.parentId).toBe('grp');
  });

  test('tolerates a document with no nodes array', () => {
    const { doc: out } = migrateCanvasDoc({ title: 'empty' });
    expect(out.nodes).toEqual([]);
    expect(out[GROUPING_MARKER]).toBe(GROUPING_VERSION);
  });
});

test.describe('isSettled', () => {
  const style = { label: 'test', ascii: false, eol: '' };

  test('is true when re-serialising changes nothing', () => {
    const value = { a: 1 };
    expect(isSettled(serialise(value, style.ascii, style.eol), value, style)).toBe(true);
  });

  test('is false when a field was added', () => {
    expect(isSettled(serialise({ a: 1 }, style.ascii, style.eol), { a: 1, b: 2 }, style)).toBe(false);
  });
});

test.describe('end to end over a document', () => {
  test('a migrated document projects the same world geometry as the original', () => {
    const nodes = [
      g({ id: 'grp', x: 100, y: 100, width: 800, height: 800 }),
      n({ id: 'a', x: 150, y: 150, width: 120, height: 90 }),
      n({ id: 'b', x: 600, y: 500, width: 120, height: 90 }),
    ];
    const { doc: out } = migrateCanvasDoc(doc(nodes));

    const before = new GroupIndex(nodes);
    const after = new GroupIndex(out.nodes!);
    for (const node of nodes) {
      if (node.type === 'group') continue;
      expect(after.worldOffsetOf(node.id)).toEqual(before.worldOffsetOf(node.id));
    }
  });
});
