import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions {
  /** Serialized snapshot of everything being persisted. A change schedules a save. */
  snapshot: string;
  /** Performs the actual persistence. Throw/reject to signal failure. */
  save: () => Promise<void>;
  /** Idle time (ms) after the last change before saving. */
  delay?: number;
  /** Autosave only runs while true (e.g. while the document is dirty). */
  enabled?: boolean;
  /** Fired once a save completes and no newer changes are outstanding. */
  onSaved?: () => void;
  /** Fired when a save fails. */
  onError?: (error: unknown) => void;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  /** True while a change is queued or a save is in flight. */
  isPending: boolean;
  /** Save immediately, bypassing the debounce. Awaitable (used on exit). */
  flush: () => Promise<void>;
}

/**
 * Debounced, state-machine driven autosave.
 *
 * Reacts to changes in `snapshot`, coalesces rapid edits, serializes concurrent
 * saves, retries when edits land mid-save, and recovers on `online`.
 */
export function useAutosave({
  snapshot,
  save,
  delay = 2500,
  enabled = true,
  onSaved,
  onError,
}: UseAutosaveOptions): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const saveRef = useRef(save);
  const snapshotRef = useRef(snapshot);
  const baselineRef = useRef(snapshot);
  const delayRef = useRef(delay);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastErrorRef = useRef<unknown>(null);
  const runRef = useRef<(() => Promise<void>) | null>(null);
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);

  saveRef.current = save;
  snapshotRef.current = snapshot;
  delayRef.current = delay;
  onSavedRef.current = onSaved;
  onErrorRef.current = onError;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    setStatus('pending');
    timerRef.current = setTimeout(() => {
      void runRef.current?.();
    }, delayRef.current);
  }, [clearTimer]);

  const run = useCallback((): Promise<void> => {
    clearTimer();
    const target = snapshotRef.current;
    if (inFlightRef.current) return inFlightRef.current;
    if (target === baselineRef.current) return Promise.resolve();

    lastErrorRef.current = null;
    setStatus('saving');
    const request = Promise.resolve().then(async () => {
    try {
      await saveRef.current();
      baselineRef.current = target;
      setLastSavedAt(new Date());
      if (snapshotRef.current === baselineRef.current) {
        setStatus('saved');
        onSavedRef.current?.();
      } else {
        // Edits landed while saving — queue the next pass.
        schedule();
      }
    } catch (error) {
      lastErrorRef.current = error;
      setStatus('error');
      onErrorRef.current?.(error);
    } finally {
      inFlightRef.current = null;
    }
    });
    inFlightRef.current = request;
    return request;
  }, [clearTimer, schedule]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!enabled || snapshot === baselineRef.current) return;
    schedule();
    return clearTimer;
  }, [snapshot, enabled, schedule, clearTimer]);

  useEffect(() => {
    const onOnline = () => {
      if (snapshotRef.current !== baselineRef.current) void runRef.current?.();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      clearTimer();
    };
  }, [clearTimer]);

  const flush = useCallback(async () => {
    clearTimer();
    do {
      await run();
      if (lastErrorRef.current) throw lastErrorRef.current;
      clearTimer();
    } while (snapshotRef.current !== baselineRef.current);
  }, [clearTimer, run]);

  return {
    status,
    lastSavedAt,
    isPending: status === 'pending' || status === 'saving',
    flush,
  };
}
