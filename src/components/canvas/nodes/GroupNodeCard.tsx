import React from 'react';
import type { CanvasNode } from '../types';
import { resolveColor } from '../types';

interface Props {
  node: CanvasNode;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  containedCount?: number;
  /** Children that have escaped the frame, so a structural group can say so. */
  outsideCount?: number;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

export const GroupNodeCard: React.FC<Props> = ({
  node,
  isSelected,
  onDoubleClick,
  containedCount,
  outsideCount = 0,
  onPointerDown,
  onClick,
}) => {
  const groupColor = resolveColor(node.color, 'var(--accent-primary)');

  // Background style handling as per JSON Canvas v1.0 spec
  let bgStyle: React.CSSProperties = {
    background: `${groupColor}0c`,
  };

  if (node.background) {
    const bgRepeat = node.backgroundStyle === 'repeat' ? 'repeat' : 'no-repeat';
    const bgSize =
      node.backgroundStyle === 'cover'
        ? 'cover'
        : node.backgroundStyle === 'fill'
          ? '100% 100%'
          : node.backgroundStyle === 'ratio'
            ? 'contain'
            : 'cover';

    bgStyle = {
      backgroundImage: `url(${node.background})`,
      backgroundRepeat: bgRepeat,
      backgroundSize: bgSize,
      backgroundPosition: 'center',
    };
  }

  return (
    <div
      className="canvas-interactive-node canvas-group-node"
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        borderRadius: '16px',
        border: `2px dashed ${isSelected ? 'var(--accent-cyan)' : groupColor}`,
        boxShadow: isSelected ? '0 0 24px rgba(0, 242, 254, 0.25)' : undefined,
        ...bgStyle,
        /**
         * Deliberately no `backdrop-filter` here.
         *
         * A group is a container, not an occluder: its whole job is to show
         * what it contains. A backdrop-filter does not merely tint what is
         * behind it, it *replaces* it with a blurred copy — and edges paint in a
         * lower layer than the node layer, so every connection inside a group
         * was being blurred along with the backdrop.
         *
         * Measured on a stroke crossing a group's open interior: peak luminance
         * 220 without the filter, 77 with `blur(3px)` — the same pixels, the
         * same zoom, roughly a third of the brightness. That is what made edges
         * look like they vanished behind the group.
         *
         * It also forced every group into its own composited layer, which is
         * expensive for what is often a very large element. The dashed border
         * and the header pill already read as a container without it.
         *
         * Note that `bgStyle` (a group with an explicit background image) will
         * still cover edges, which is correct: that is the user asking for an
         * opaque backdrop.
         */
        zIndex: 1,
        /**
         * The body is hit-testable, because "groups cannot be selected by
         * clicking" was defect D4. `pointerEvents: none` meant the only way to
         * reach a group was its header pill, so a group was effectively
         * unselectable by clicking anywhere on its actual body.
         *
         * Children still win where they overlap because they render in a later
         * layer (z-index 3) and so sit above this frame in hit-testing order, so
         * a click on a child still reaches the child.
         */
        cursor: isSelected ? 'grabbing' : 'grab',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Floating Header Label Pill (Interactive & Draggable in Studio) */}
      <div
        className="canvas-group-header-pill"
        style={{
          position: 'absolute',
          top: '-14px',
          left: '20px',
          background: 'rgba(15, 23, 42, 0.95)',
          border: `1.5px solid ${isSelected ? 'var(--accent-cyan)' : groupColor}`,
          color: '#fff',
          fontSize: '0.78rem',
          fontWeight: 700,
          padding: '3px 14px',
          borderRadius: '999px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'auto', // Header pill can be clicked & dragged!
          cursor: 'grab',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          userSelect: 'none',
        }}
      >
        <span title={node.membership === 'structural'
          ? 'Structural: children stay in this group even when outside the frame'
          : 'Contained: a visual frame that releases children it does not surround'}>
          {node.membership === 'structural' ? '🧱' : '🖼️'}
        </span>
        <span>{node.label || 'Group Container'}</span>
        {outsideCount > 0 && (
          <span
            title={`${outsideCount} member${outsideCount === 1 ? '' : 's'} outside this frame`}
            style={{
              fontSize: '0.65rem',
              background: 'rgba(245, 158, 11, 0.22)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              padding: '1px 6px',
              borderRadius: '8px',
              color: '#fbbf24',
              fontWeight: 700,
            }}
          >
            {outsideCount} ↗
          </span>
        )}
        {containedCount !== undefined && containedCount > 0 && (
          <span
            style={{
              fontSize: '0.65rem',
              background: 'rgba(255, 255, 255, 0.12)',
              padding: '1px 6px',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
            }}
          >
            {containedCount}
          </span>
        )}
      </div>
    </div>
  );
};
