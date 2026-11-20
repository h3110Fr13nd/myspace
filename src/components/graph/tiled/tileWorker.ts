/// <reference lib="webworker" />
/**
 * Tiled graph — fetch + decode + prepare, off the main thread.
 *
 * The main thread sends `{ type: 'load', id, url, layer }` and receives a
 * renderer-ready tile whose typed arrays are *transferred* (zero copy). A
 * `{ type: 'cancel', id }` aborts the network request, so tiles that scrolled
 * out of view before arriving never cost parsing time.
 */
import { decodeTile } from '../../../lib/spatial-tiles/codec';
import { prepareTile, transferables } from './prepareTile';
import type { WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const inflight = new Map<number, AbortController>();

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    inflight.get(msg.id)?.abort();
    inflight.delete(msg.id);
    return;
  }

  const controller = new AbortController();
  inflight.set(msg.id, controller);
  const started = performance.now();
  try {
    const res = await fetch(msg.url, { credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) {
      scope.postMessage({ type: 'error', id: msg.id, status: res.status } satisfies WorkerResponse);
      return;
    }
    const buf = await res.arrayBuffer();
    const tile = prepareTile(decodeTile(buf), msg.layer);
    const reply: WorkerResponse = {
      type: 'tile',
      id: msg.id,
      tile,
      wireBytes: buf.byteLength,
      ms: performance.now() - started,
    };
    scope.postMessage(reply, transferables(tile));
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    scope.postMessage({ type: aborted ? 'aborted' : 'error', id: msg.id, status: 0 } satisfies WorkerResponse);
  } finally {
    inflight.delete(msg.id);
  }
};
