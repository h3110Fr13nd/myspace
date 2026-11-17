import React from 'react';
import type { GraphNode } from './constants';
import { ENTITY_META, normalizeEntityType } from './constants';

export interface HoveredInfo {
  node: GraphNode;
  screenX: number;
  screenY: number;
  degree: number;
}

interface GraphTooltipProps {
  hoveredInfo: HoveredInfo | null;
  readIds: Set<string>;
}

export const GraphTooltip: React.FC<GraphTooltipProps> = ({ hoveredInfo, readIds }) => {
  if (!hoveredInfo) return null;

  const typeKey = normalizeEntityType(hoveredInfo.node);
  const meta = ENTITY_META[typeKey] || { label: hoveredInfo.node.type || 'Document', icon: '📄' };

  const safeLeft = typeof window !== 'undefined'
    ? Math.min(hoveredInfo.screenX + 14, window.innerWidth - 240)
    : hoveredInfo.screenX + 14;
  const safeTop = typeof window !== 'undefined'
    ? Math.min(hoveredInfo.screenY + 14, window.innerHeight - 110)
    : hoveredInfo.screenY + 14;

  return (
    <div
      style={{
        position: 'fixed',
        left: `${safeLeft}px`,
        top: `${safeTop}px`,
        background: 'var(--surface-overlay)',
        border: '1px solid var(--accent-cyan-bright)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 12px',
        pointerEvents: 'none',
        boxShadow: '0 8px 24px rgba(0, 242, 254, 0.25)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999999,
        maxWidth: '240px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem' }}>{meta.icon}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--accent-cyan-bright)', textTransform: 'uppercase', fontWeight: 700 }}>
          {meta.label}
        </span>
        {readIds.has(hoveredInfo.node.id) && (
          <span style={{ fontSize: '0.65rem', color: 'var(--status-success)', fontWeight: 700, marginLeft: 'auto' }}>✓ Read</span>
        )}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700, wordBreak: 'break-word', lineHeight: 1.3 }}>
        {hoveredInfo.node.title}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
        {hoveredInfo.degree} connected reference{hoveredInfo.degree === 1 ? '' : 's'}
      </div>
    </div>
  );
};