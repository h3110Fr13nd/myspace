import React from 'react';
import type { CanvasNode } from '../types';
import { TextNodeCard } from './TextNodeCard';
import { GroupNodeCard } from './GroupNodeCard';
import { LinkNodeCard } from './LinkNodeCard';
import { ResourceNodeCard } from './ResourceNodeCard';
import { LockedNodeCard } from './LockedNodeCard';

import { resolveColor } from '../types';

interface Props {
  node: CanvasNode;
  currentUser?: string;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  isEditMode?: boolean;
  containedCount?: number;
  outsideCount?: number;
  onGroupPointerDown?: (e: React.PointerEvent) => void;
  onGroupClick?: (e: React.MouseEvent) => void;
  depth?: number;
  lod?: 'full' | 'medium' | 'minimal';
}

/**
 * Spatial Canvas Node Dispatcher with Level of Detail (LOD)
 *
 * Routes JSON Canvas node primitives to their specialized renderers.
 * When zoomed out (lod === 'minimal'), renders a lightweight geometric proxy
 * to prevent DOM layout and KaTeX parsing thrashing.
 */
export const NodeRenderer: React.FC<Props> = ({
  node,
  currentUser = 'user:anonymous',
  isSelected = false,
  onDoubleClick,
  isEditMode = false,
  containedCount,
  outsideCount = 0,
  onGroupPointerDown,
  onGroupClick,
  depth = 0,
  lod = 'full',
}) => {
  // 1. ReBAC Restricted / Redacted Node
  if (node.isAllowed === false) {
    return <LockedNodeCard node={node} currentUser={currentUser} isSelected={isSelected} />;
  }

  // 2. Minimal Level of Detail (Geometric Proxy when zoomed far out)
  if (lod === 'minimal' && node.type !== 'group') {
    const title = node.resolvedTitle || node.label || node.file || node.text?.split('\n')[0].replace(/^#+\s*/, '') || node.id;
    const accentColor = resolveColor(node.color, 'var(--accent-cyan)');
    return (
      <div
        className="canvas-interactive-node"
        onDoubleClick={onDoubleClick}
        style={{
          position: 'absolute',
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${node.width}px`,
          height: `${node.height}px`,
          background: 'rgba(15, 23, 42, 0.96)',
          border: `2px solid ${isSelected ? 'var(--accent-cyan)' : accentColor}`,
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 12px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          zIndex: 3,
        }}
      >
        <span
          style={{
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </div>
    );
  }

  // 2. Spatial Group Node (Bounding Container)
  if (node.type === 'group') {
    return (
      <GroupNodeCard
        node={node}
        isSelected={isSelected}
        onDoubleClick={onDoubleClick}
        containedCount={containedCount}
        outsideCount={outsideCount}
        onPointerDown={onGroupPointerDown}
        onClick={onGroupClick}
      />
    );
  }

  // 3. Web / External Link Node
  if (node.type === 'link' || (node.url && !node.resourceId && !node.file)) {
    return <LinkNodeCard node={node} isSelected={isSelected} onDoubleClick={onDoubleClick} />;
  }

  // 4. Standalone Markdown / Text Node
  if (node.type === 'text' && !node.resourceId && !node.file) {
    return <TextNodeCard node={node} isSelected={isSelected} onDoubleClick={onDoubleClick} />;
  }

  // 5. Polymorphic Workspace Resource Node (Sub-Canvas, Paper, PDF, Sheet, Form, Image, Doc)
  return (
    <ResourceNodeCard
      node={node}
      currentUser={currentUser}
      isSelected={isSelected}
      onDoubleClick={onDoubleClick}
      isEditMode={isEditMode}
      depth={depth}
      lod={lod}
    />
  );
};
