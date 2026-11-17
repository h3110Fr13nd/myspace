/**
 * Canvas core — node connection ports.
 *
 * The four cardinal dots on every node. Presentation rules follow the major
 * board platforms so the affordance is instantly recognisable:
 *
 *  - **Hidden at rest.** Dots only fade in when the node is hovered or
 *    selected, or when a connection drag is in flight. Showing them
 *    permanently on every node turned the board into visual noise and made
 *    edges look like they were "not connecting where the mouse is".
 *  - **Enlarged while connecting.** During a drag every port grows and the
 *    valid ones light up, so it is obvious where a connection can land.
 *  - **Snapped target is unmistakable.** The port the edge will attach to gets
 *    a halo and grows further.
 *  - **Dots are scale-invariant.** Sized in inverse-zoom units so they stay
 *    tappable at any zoom level.
 */

import React, { memo } from 'react';
import { PORTS, anchorFor, type PortSide } from './geometry';
import type { CanvasNode } from '../types';

export interface NodePortLayerProps {
  /**
   * Only the node's id and size are needed, and that is deliberate.
   *
   * This layer renders inside the node's own positioned wrapper, so its
   * coordinates are **node-local**. Accepting the full node made it easy to
   * pass one carrying absolute `x`/`y` and have `anchorFor` return world
   * coordinates that were then added to the wrapper's offset a second time —
   * which pushed the dots off the node entirely for anything not near the
   * origin, and looked correct for the first node on the board. Ignoring `x`
   * and `y` outright makes that mistake impossible.
   */
  node: Pick<CanvasNode, 'id' | 'width' | 'height'>;
  /** 1 / zoom. */
  inv: number;
  isSelected: boolean;
  isHovered: boolean;
  /** A connection drag is in progress. */
  isConnecting: boolean;
  /** The port currently under the pointer during a drag. */
  snappedPort?: PortSide | null;
  onPortPointerDown: (nodeId: string, side: PortSide, e: React.PointerEvent) => void;
  onPortPointerEnter?: (nodeId: string, side: PortSide) => void;
}

const BASE = 10;

export const NodePortLayer = memo(function NodePortLayer({
  node,
  inv,
  isSelected,
  isHovered,
  isConnecting,
  snappedPort = null,
  onPortPointerDown,
  onPortPointerEnter,
}: NodePortLayerProps) {
  // Dots stay invisible until the node is relevant, or everything is relevant
  // because the user is mid-connection.
  const visible = isConnecting || isSelected || isHovered;
  if (!visible) return null;

  const base = BASE * inv;
  const grow = isConnecting ? 1.45 : 1;

  /**
   * Node-local geometry. The wrapper already sits at the node's world position,
   * so anchoring against the origin here is what keeps each dot on the node's
   * own edge rather than at its world coordinate plus that offset again.
   */
  const localNode = { x: 0, y: 0, width: node.width, height: node.height };

  return (
    <>
      {PORTS.map((side) => {
        const a = anchorFor(localNode, side);
        const isSnapped = snappedPort === side;
        const size = base * grow * (isSnapped ? 1.5 : 1);
        const ring = isConnecting ? 2.5 * inv : 2 * inv;

        return (
          <div
            key={side}
            className="canvas-port-handle"
            data-node-id={node.id}
            data-side={side}
            style={{
              position: 'absolute',
              left: a.x,
              top: a.y,
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: '50%',
              background: isSnapped
                ? 'var(--accent-cyan-bright, #00f2fe)'
                : isConnecting
                  ? 'var(--accent-cyan, #06b6d4)'
                  : 'var(--accent-cyan-bright, #00f2fe)',
              border: `${ring}px solid var(--surface-1, #0b0f19)`,
              opacity: isConnecting || isSelected || isHovered ? 1 : 0.55,
              boxShadow: isSnapped
                ? `0 0 ${12 * inv}px rgba(0, 242, 254, 0.95)`
                : `0 0 ${6 * inv}px rgba(0, 242, 254, 0.55)`,
              cursor: 'crosshair',
              touchAction: 'none',
              zIndex: 24,
              // The visible dot is small; an invisible pad keeps it grabbable
              // with a finger or a slightly imprecise click.
              pointerEvents: 'auto',
            }}
            title={`Connect from the ${side} of this node`}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onPortPointerDown(node.id, side, e);
            }}
            onPointerEnter={() => onPortPointerEnter?.(node.id, side)}
          >
            {/* Invisible 28px touch target, independent of zoom. */}
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 28,
                height: 28,
                marginLeft: -14,
                marginTop: -14,
                borderRadius: '50%',
                pointerEvents: 'auto',
              }}
            />
          </div>
        );
      })}
    </>
  );
});
