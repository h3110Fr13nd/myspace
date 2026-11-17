import React from 'react';
import type { CanvasNode } from '../types';

interface Props {
  node: CanvasNode;
  currentUser?: string;
  isSelected?: boolean;
}

export const LockedNodeCard: React.FC<Props> = ({ node, currentUser, isSelected }) => {
  const isUltraCompact = node.height < 110;
  const isCompact = node.height < 160;

  return (
    <div
      className="canvas-interactive-node canvas-locked-node"
      style={{
        position: 'absolute',
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        padding: isUltraCompact ? '6px 10px' : isCompact ? '8px 12px' : '14px 16px',
        borderRadius: isUltraCompact ? '8px' : '12px',
        background: 'rgba(244, 63, 94, 0.08)',
        border: `1.5px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--accent-rose)'}`,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(12px)',
        zIndex: 3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isUltraCompact ? '2px' : '4px',
          flexShrink: 0,
        }}
      >
        <span
          className="ui-badge ui-badge--danger"
          style={{
            fontSize: isUltraCompact ? '0.58rem' : '0.65rem',
            textTransform: 'uppercase',
            background: 'rgba(244, 63, 94, 0.2)',
            color: 'var(--accent-rose)',
            padding: isUltraCompact ? '1px 5px' : undefined,
          }}
        >
          🔒 Restricted
        </span>
        <span style={{ fontSize: isUltraCompact ? '0.62rem' : '0.7rem', color: 'var(--accent-rose)', fontWeight: 600 }}>
          {node.resourceType || 'Resource'}
        </span>
      </div>

      <div
        className="canvas-node-scrollable"
        onWheel={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: '20px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          paddingRight: '4px',
          color: 'var(--accent-rose)',
          fontSize: isUltraCompact ? '0.74rem' : '0.8rem',
          lineHeight: 1.35,
        }}
      >
        <h4 style={{ fontSize: isUltraCompact ? '0.8rem' : '0.9rem', fontWeight: 700, margin: '0 0 2px 0', color: '#fff' }}>
          {node.label || 'Access Restricted'}
        </h4>
        <p style={{ margin: 0 }}>
          {node.text || `Sensitive data redacted for ${currentUser || 'anonymous'}.`}
        </p>
      </div>

      {node.resourceId && !isUltraCompact && (
        <div style={{ borderTop: '1px solid rgba(244, 63, 94, 0.2)', paddingTop: '4px', fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
          <code>{node.resourceId}</code>
        </div>
      )}
    </div>
  );
};
