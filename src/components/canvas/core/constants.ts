/**
 * Canvas core — tuning constants.
 *
 * Every magic number that shapes feel lives here so the interaction layer stays
 * declarative and the values can be re-tuned without hunting through logic.
 */

/** Zoom clamps. Wide enough to genuinely zoom out, tight enough to stay legible. */
export const ZOOM = {
  min: 0.1,
  max: 4,
  /** Exponential zoom sensitivity for pinch/wheel: factor = exp(-deltaY * ZOOM.sensitivity). */
  sensitivity: 0.0022,
  /** Multiplicative step for toolbar / keyboard zoom buttons. */
  step: 1.2,
  /** Discrete step for the mouse-wheel (non-trackpad) path. */
  wheelStep: 1.1,
  default: 1,
} as const;

/** Grid + snapping. */
export const GRID = {
  /** Minor dot pitch in world units. */
  minor: 24,
  /** Major dot pitch in world units. */
  major: 120,
  /** Snap increment for node creation / drag / resize. */
  snap: 20,
  /** Drag distance (px) before a press is treated as a drag rather than a click. */
  dragThreshold: 3,
  minNodeWidth: 160,
  minNodeHeight: 100,
} as const;

/** Viewport padding used by "fit to content", in screen px. */
export const FIT_PADDING = 48;

/** Distance (world units) within which a port snaps to the pointer. */
export const PORT_SNAP_RADIUS = 56;

/** Radius (world units) of the interactive port dot. */
export const PORT_RADIUS = 6;

/** How close to a node's bounding box a connection drop still counts as a hit. */
export const DROP_TOLERANCE = 24;

/** Screen-space width of the invisible edge hit stroke, in CSS px. */
export const EDGE_HIT_WIDTH = 18;

/** Level-of-detail thresholds — below these the node renders a cheap proxy. */
export const LOD = {
  full: 0.65,
  medium: 0.3,
} as const;

export type LodLevel = 'full' | 'medium' | 'minimal';

export function lodFor(zoom: number): LodLevel {
  if (zoom >= LOD.full) return 'full';
  if (zoom >= LOD.medium) return 'medium';
  return 'minimal';
}

/** Default bezier handle length in world units, scaled by gap. */
export const EDGE_CURVATURE = 0.45;
export const EDGE_MIN_HANDLE = 24;
export const EDGE_MAX_HANDLE = 160;

/** Number of history entries retained. */
export const HISTORY_LIMIT = 60;

/** Label given to an edge created by dragging from a port. */
export const DEFAULT_EDGE_LABEL = 'relates to';
