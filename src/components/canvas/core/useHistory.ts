/**
 * Canvas core — undo/redo history.
 *
 * Snapshots are plain structural references to the node/edge arrays, so pushing
 * a snapshot is O(1) and the history costs no extra memory beyond the array
 * headers. Two refinements over a naive stack:
 *
 *  - **Coalescing**: a burst of same-kind edits (dragging a node, resizing,
 *    typing in the inspector) collapses into one entry, so undo steps back to
 *    the state *before* the gesture instead of replaying 60 intermediate frames.
 *  - **Bounded**: a hard cap keeps memory flat on long sessions.
 *
 * Stack and cursor live in a single state object so every transition is one
 * atomic update — no nested setters, no torn reads.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { HISTORY_LIMIT } from './constants';
import type { CanvasEdge, CanvasNode } from '../types';

export interface Snapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export type HistoryTag = 'move' | 'resize' | 'connect' | 'edit' | 'structural' | 'raw';

export interface HistoryApi {
  canUndo: boolean;
  canRedo: boolean;
  /** Cursor into the stack. */
  index: number;
  length: number;
  /** Record a new state. `tag` coalesces consecutive same-tag pushes. */
  push: (snapshot: Snapshot, tag?: HistoryTag) => void;
  /** Replace the entire history and start over from `snapshot`. */
  reset: (snapshot: Snapshot) => void;
  /**
   * Step the cursor back and return the snapshot it landed on.
   *
   * Returning the destination matters: the cursor move is a state update, so a
   * host that then read `current` synchronously would still see the snapshot it
   * is leaving. Returning it removes that entire class of stale-closure bug.
   */
  undo: () => Snapshot;
  /** Step the cursor forward and return the snapshot it landed on. */
  redo: () => Snapshot;
  /** The snapshot the cursor currently points at. */
  current: Snapshot;
}

interface HistoryState {
  stack: Snapshot[];
  index: number;
}

const COALESCE_WINDOW_MS = 400;

export function useHistory(initial: Snapshot, limit = HISTORY_LIMIT): HistoryApi {
  const [state, setState] = useState<HistoryState>({ stack: [initial], index: 0 });

  /**
   * Authoritative mirror of the stack.
   *
   * The cursor moves are state updates, so a host that wants to act on the
   * snapshot it lands on cannot wait for a re-render. This ref is updated
   * synchronously inside every transition, which is what lets `undo`/`redo`
   * hand back the correct destination.
   */
  const stateRef = useRef<HistoryState>(state);
  const commit = useCallback((next: HistoryState | ((prev: HistoryState) => HistoryState)) => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = resolved;
    setState(resolved);
    return resolved;
  }, []);

  // Last push metadata for coalescing decisions.
  const lastTagRef = useRef<HistoryTag>('raw');
  const lastAtRef = useRef(0);

  const push = useCallback(
    (snapshot: Snapshot, tag: HistoryTag = 'raw') => {
      const now = Date.now();
      const coalesce =
        tag !== 'structural' &&
        tag === lastTagRef.current &&
        now - lastAtRef.current < COALESCE_WINDOW_MS;

      lastTagRef.current = tag;
      lastAtRef.current = now;

      commit((prev) => {
        const current = prev.stack[prev.index];
        if (current === snapshot) return prev;
        if (current && current.nodes === snapshot.nodes && current.edges === snapshot.edges) {
          return prev;
        }

        // Collapse a rapid burst of the same kind of edit into one entry.
        if (coalesce && prev.index === prev.stack.length - 1) {
          const next = prev.stack.slice();
          next[prev.index] = snapshot;
          return { stack: next, index: prev.index };
        }

        // Drop any redo tail, then append.
        const trimmed = prev.stack.slice(0, prev.index + 1);
        trimmed.push(snapshot);
        while (trimmed.length > limit) trimmed.shift();
        return { stack: trimmed, index: trimmed.length - 1 };
      });
    },
    [commit, limit]
  );

  const reset = useCallback(
    (snapshot: Snapshot) => {
      lastTagRef.current = 'raw';
      lastAtRef.current = 0;
      commit({ stack: [snapshot], index: 0 });
    },
    [commit]
  );

  const undo = useCallback((): Snapshot => {
    lastTagRef.current = 'raw';
    const next = commit((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
    return next.stack[next.index] ?? next.stack[next.stack.length - 1];
  }, [commit]);

  const redo = useCallback((): Snapshot => {
    lastTagRef.current = 'raw';
    const next = commit((prev) =>
      prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev
    );
    return next.stack[next.index] ?? next.stack[next.stack.length - 1];
  }, [commit]);

  return useMemo<HistoryApi>(
    () => ({
      canUndo: state.index > 0,
      canRedo: state.index < state.stack.length - 1,
      index: state.index,
      length: state.stack.length,
      push,
      reset,
      undo,
      redo,
      current: state.stack[state.index] ?? state.stack[state.stack.length - 1],
    }),
    [push, redo, reset, state, undo]
  );
}
