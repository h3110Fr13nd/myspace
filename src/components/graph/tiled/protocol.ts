import type { RenderTile } from './prepareTile';

export type WorkerRequest =
  | { type: 'load'; id: number; url: string; layer: string }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'tile'; id: number; tile: RenderTile; wireBytes: number; ms: number }
  | { type: 'error'; id: number; status: number }
  | { type: 'aborted'; id: number; status: number };
