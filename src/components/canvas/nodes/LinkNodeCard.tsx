import React from 'react';
import type { CanvasNode } from '../types';
import { resolveColor } from '../types';

interface Props {
  node: CanvasNode;
  isSelected?: boolean;
  onDoubleClick?: () => void;
}

export const LinkNodeCard: React.FC<Props> = ({ node, isSelected, onDoubleClick }) => {
  const nodeColor = resolveColor(node.color, 'var(--border-glass)');
  const isUltraCompact = node.height < 95;
  const isCompact = node.height < 140;

  let domain = '';
  try {
    if (node.url) domain = new URL(node.url).hostname;
  } catch {}

  const titleText = node.label || domain || node.url || 'Web Link';

  return (
    <div
      className="canvas-interactive-node canvas-link-node"
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        padding: isUltraCompact ? '6px 10px' : isCompact ? '8px 12px' : '14px 16px',
        borderRadius: isUltraCompact ? '8px' : '12px',
        background: 'rgba(17, 24, 39, 0.95)',
        border: `1.5px solid ${isSelected ? 'var(--accent-cyan)' : nodeColor}`,
        boxShadow: isSelected ? '0 0 20px rgba(0, 242, 254, 0.35)' : '0 4px 20px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(12px)',
        zIndex: 3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Header: Badge & Domain */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isUltraCompact ? '2px' : '6px',
          flexShrink: 0,
        }}
      >
        <span
          className="ui-badge ui-badge--info"
          style={{ fontSize: isUltraCompact ? '0.58rem' : '0.65rem', padding: isUltraCompact ? '1px 5px' : undefined }}
        >
          🔗 {isUltraCompact ? 'Link' : 'Web Link'}
        </span>
        {domain && (
          <span style={{ fontSize: isUltraCompact ? '0.6rem' : '0.65rem', color: 'var(--text-muted)' }}>
            {domain}
          </span>
        )}
      </div>

      {/* Content Area */}
      <div
        className="canvas-node-scrollable"
        onWheel={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <h4
          style={{
            fontSize: isUltraCompact ? '0.8rem' : '0.9rem',
            fontWeight: 700,
            color: '#fff',
            margin: 0,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: isUltraCompact ? 'nowrap' : 'normal',
          }}
        >
          {titleText}
        </h4>
        {!isUltraCompact && node.url && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', wordBreak: 'break-all', margin: '2px 0 0 0' }}>
            {node.url}
          </p>
        )}
      </div>

      {/* Footer Link: Shown on non-ultra-compact, or inline in ultra-compact */}
      {node.url && (
        <div
          style={{
            borderTop: isUltraCompact ? 'none' : '1px solid var(--border-glass)',
            paddingTop: isUltraCompact ? '0' : '6px',
            marginTop: isUltraCompact ? '2px' : '6px',
            flexShrink: 0,
          }}
        >
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: 'var(--accent-cyan)',
              fontSize: isUltraCompact ? '0.68rem' : '0.78rem',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            Visit Website ↗
          </a>
        </div>
      )}
    </div>
  );
};
