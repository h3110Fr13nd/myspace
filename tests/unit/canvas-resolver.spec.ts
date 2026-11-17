import { expect, test } from '@playwright/test';
import {
  resolveCanvasSource,
  describeMissingCanvas,
} from '../../src/lib/canvas/canvasResolver';

/**
 * These lock down the rule that decides which copy of a canvas is edited.
 *
 * The failure this guards against is silent: the board mounts, pans and zooms
 * perfectly, and simply has nothing on it. Nothing in the UI distinguishes "your
 * canvas loaded" from "we picked the empty copy", so a user reports that their
 * canvas has disappeared when in fact a row with no `canvasData` shadowed the
 * file that still had their work in it.
 */

const node = (id: string) => ({ id, x: 0, y: 0, width: 100, height: 100 });

test.describe('resolveCanvasSource', () => {
  test('the DB row wins when it actually carries a canvas', () => {
    const r = resolveCanvasSource({
      dbRow: { title: 'From DB', metadata: { canvasData: { nodes: [node('db')], edges: [] } } },
      disk: { nodes: [node('disk')], edges: [], title: 'From disk' },
    });
    expect(r.origin).toBe('db');
    expect(r.data!.nodes[0]).toMatchObject({ id: 'db' });
    expect(r.title).toBe('From DB');
  });

  test('a DB row with no canvasData does not shadow the file on disk', () => {
    // This is the regression. The old code built initialData from
    // `metadata?.canvasData?.nodes || []`, so "a row exists" counted as "the row
    // has the canvas", and the disk fallback was skipped behind an empty board.
    const r = resolveCanvasSource({
      dbRow: { title: 'my canvas', metadata: {} },
      disk: { nodes: [node('disk')], edges: [], title: 'my canvas' },
    });
    expect(r.origin).toBe('disk');
    expect(r.data!.nodes[0]).toMatchObject({ id: 'disk' });
    // Flagged, because the two copies have now diverged.
    expect(r.dbRowWasEmpty).toBe(true);
  });

  test('a DB row whose canvasData is an empty array also falls through', () => {
    const r = resolveCanvasSource({
      dbRow: { title: 'x', metadata: { canvasData: { nodes: [], edges: [] } } },
      disk: { nodes: [node('disk')], edges: [] },
    });
    expect(r.origin).toBe('disk');
    expect(r.dbRowWasEmpty).toBe(true);
  });

  test('disk is used when the database could not be reached at all', () => {
    const r = resolveCanvasSource({
      dbRow: null,
      disk: { nodes: [node('disk')], edges: [], title: 'my canvas' },
    });
    expect(r.origin).toBe('disk');
    // No row was read, so there is nothing to have diverged from.
    expect(r.dbRowWasEmpty).toBe(false);
  });

  test('an unreadable row that the viewer may not see still uses disk', () => {
    // Permission failures leave dbRow null rather than partial, so the durable
    // copy has to remain reachable.
    const r = resolveCanvasSource({ dbRow: null, disk: { nodes: [node('d')], edges: [] } });
    expect(r.data!.nodes).toHaveLength(1);
  });

  test('nothing anywhere resolves to null with a usable title', () => {
    const r = resolveCanvasSource({
      dbRow: { title: 'Ghost', metadata: {} },
      disk: null,
      fallbackTitle: 'ghost',
    });
    expect(r.data).toBeNull();
    expect(r.origin).toBe('none');
    expect(r.title).toBe('Ghost');
  });

  test('a disk file with no nodes is not treated as a canvas', () => {
    // An empty file is indistinguishable from a truncated one; better to report
    // it as missing than to open a board the user cannot tell is broken.
    const r = resolveCanvasSource({ dbRow: null, disk: { nodes: [], edges: [] } });
    expect(r.data).toBeNull();
  });

  test('a malformed canvasData that is not an array is rejected, not rendered', () => {
    const r = resolveCanvasSource({
      dbRow: { metadata: { canvasData: { nodes: 'nope' as unknown as unknown[] } } },
      disk: { nodes: [node('disk')], edges: [] },
    });
    expect(r.origin).toBe('disk');
  });

  test('edges default to an empty list rather than undefined', () => {
    const r = resolveCanvasSource({
      dbRow: { metadata: { canvasData: { nodes: [node('a')] } } },
    });
    expect(r.data!.edges).toEqual([]);
  });

  test('the missing-canvas message names the slug that was asked for', () => {
    expect(describeMissingCanvas('my-canvas')).toContain('my-canvas');
  });
});
