/**
 * Tiled graph — camera math: the tile-pyramid parts (levels, visible tiles).
 * The camera itself is the shared one (`lib/viewer/camera.ts`), the same
 * algebra the canvas uses; the wrappers below keep this module's call shapes.
 */
import {
  centerAt,
  fitRect as fitRectShared,
  flyTo,
  screenToWorld as toWorldShared,
  viewCenter,
  zoomAt,
  type Camera,
} from '../../../lib/viewer/camera';

export type { Camera };

export interface World {
  x: number;
  y: number;
  size: number;
  maxZ: number;
}

/**
 * On-screen size a tile is drawn at, at most. A tile is shown between
 * TILE_PX and 2 * TILE_PX css pixels, so a 1600x1000 view needs at most ~12
 * tiles per layer (typically 6-9) and an aggregate cell (1/32 of a tile) is
 * 16-32 px — a dot-density map, not a smear.
 */
export const TILE_PX = 512;

/** View level for a camera: the deepest level whose tiles are >= TILE_PX on screen. */
export function levelFor(k: number, world: World): number {
  const z = Math.floor(Math.log2((world.size * k) / TILE_PX));
  if (!Number.isFinite(z) || z < 0) return 0;
  return z > world.maxZ ? world.maxZ : z;
}

export interface TileRange {
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tiles at level `z` intersecting the viewport, expanded by `margin` tiles. */
export function visibleTiles(cam: Camera, view: { width: number; height: number }, world: World, z: number, margin = 0): TileRange {
  const size = world.size / 2 ** z;
  const side = 2 ** z;
  const wx0 = -cam.x / cam.k;
  const wy0 = -cam.y / cam.k;
  const wx1 = (view.width - cam.x) / cam.k;
  const wy1 = (view.height - cam.y) / cam.k;
  const clamp = (v: number) => (v < 0 ? 0 : v > side - 1 ? side - 1 : v);
  return {
    z,
    x0: clamp(Math.floor((wx0 - world.x) / size) - margin),
    y0: clamp(Math.floor((wy0 - world.y) / size) - margin),
    x1: clamp(Math.floor((wx1 - world.x) / size) + margin),
    y1: clamp(Math.floor((wy1 - world.y) / size) + margin),
  };
}

/** Camera that frames the whole world square with some padding. */
export function fitWorld(world: World, view: { width: number; height: number }, padding = 24): Camera {
  return fitRect({ x: world.x, y: world.y, width: world.size, height: world.size }, view, padding);
}

/** Camera that frames a world rectangle (e.g. the populated part of the world). */
export function fitRect(
  rect: { x: number; y: number; width: number; height: number },
  view: { width: number; height: number },
  padding = 24
): Camera {
  return fitRectShared(rect, view, { padding });
}

export function centerOn(p: { x: number; y: number }, k: number, view: { width: number; height: number }): Camera {
  return centerAt(p, k, view);
}

/** Zoom by `factor` keeping the world point under `anchor` (screen px) fixed. */
export function zoomAbout(cam: Camera, factor: number, anchor: { x: number; y: number }, minK: number, maxK: number): Camera {
  return zoomAt(cam, anchor, cam.k * factor, minK, maxK);
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return toWorldShared(cam, { x: sx, y: sy });
}

export { flyTo, viewCenter };

/** Tile-key helpers. */
export function tileKeyOf(layer: string, z: number, x: number, y: number): string {
  return `${layer}/${z}/${x}/${y}`;
}
