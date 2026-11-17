import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import {
  AdaptiveCollabManager,
  type CollabPresenceState,
  type CollabUser,
} from './collaboration';

export interface UseCollaborationResult {
  manager: AdaptiveCollabManager | null;
  ydoc: Y.Doc | null;
  state: CollabPresenceState | null;
  /** Force the live WebSocket session on/off (no-op when disabled). */
  toggleLive: () => void;
}

export function useCollaboration(
  documentId: string,
  user: CollabUser
): UseCollaborationResult & {
  manager: AdaptiveCollabManager;
  ydoc: Y.Doc;
  state: CollabPresenceState;
};
export function useCollaboration(
  documentId: string,
  user: CollabUser,
  enabled: boolean
): UseCollaborationResult;
/**
 * Owns the lifecycle of an {@link AdaptiveCollabManager} for a single document.
 *
 * The manager is constructed lazily (once per component instance) and torn down
 * on unmount, so the presence heartbeat and Hocuspocus provider can never leak.
 * Side effects live in `start()`, never in the constructor, which keeps this
 * hook safe to run during SSR/hydration.
 */
export function useCollaboration(
  documentId: string,
  user: CollabUser,
  enabled: boolean = true
): UseCollaborationResult {
  const [manager] = useState<AdaptiveCollabManager | null>(() =>
    enabled ? new AdaptiveCollabManager(documentId, user) : null
  );
  const [state, setState] = useState<CollabPresenceState | null>(
    () => manager?.getState() ?? null
  );

  useEffect(() => {
    if (!manager) return;
    manager.user = user;
    manager.start();
    const unsubscribe = manager.subscribe(setState);
    return () => {
      unsubscribe();
      manager.destroy();
    };
    // `manager` is stable for this component instance; `user` is refreshed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager]);

  return {
    manager,
    ydoc: manager?.ydoc ?? null,
    state,
    toggleLive: () => manager?.toggleLiveSession(),
  };
}
