import React from 'react';
import { marked } from 'marked';
import { renderDisplayMath, renderInlineMath } from '../../../lib/render/mathRenderer';
import type { CanvasNode } from '../types';
import { resolveColor } from '../types';

function renderRichContent(content?: string): string {
  if (!content) return '';
  let processed = renderDisplayMath(content);
  processed = renderInlineMath(processed);
  return marked.parse(processed) as string;
}

interface Props {
  node: CanvasNode;
  isSelected?: boolean;
  onDoubleClick?: () => void;
}

export const TextNodeCard: React.FC<Props> = ({ node, isSelected, onDoubleClick }) => {
  const nodeColor = resolveColor(node.color, 'var(--border-glass)');
  const isUltraCompact = node.height < 95;
  const isCompact = node.height < 140;

  const hasHeading = Boolean(node.text?.trim().startsWith('#'));
  const title = hasHeading ? node.text?.split('\n')[0].replace(/^#+\s*/, '') : '';
  const bodyText = hasHeading ? node.text?.split('\n').slice(1).join('\n') : (node.text || '');

  return (
    <div
      className="canvas-interactive-node canvas-text-node"
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
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Header: Only show if not ultra-compact */}
      {!isUltraCompact && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: isCompact ? '4px' : '8px',
            flexShrink: 0,
          }}
        >
          <span
            className="ui-badge ui-badge--info"
            style={{ fontSize: isCompact ? '0.6rem' : '0.65rem', textTransform: 'uppercase', padding: isCompact ? '1px 5px' : undefined }}
          >
            📝 Note
          </span>
          {isSelected && (
            <span style={{ fontSize: '0.62rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>● Selected</span>
          )}
        </div>
      )}

      {/* Scrollable Content Container: Resilient & Zero-Clipping */}
      <div
        className="canvas-node-scrollable"
        onWheel={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          paddingRight: '4px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: isUltraCompact ? 'center' : 'flex-start',
        }}
      >
        {title && (
          <h4
            style={{
              fontSize: isCompact ? '0.85rem' : '0.95rem',
              fontWeight: 700,
              color: '#fff',
              margin: isCompact ? '0 0 4px 0' : '0 0 6px 0',
              lineHeight: 1.3,
            }}
          >
            {title}
          </h4>
        )}
        {bodyText && (
          <div
            style={{
              fontSize: isUltraCompact ? '0.78rem' : isCompact ? '0.8rem' : '0.82rem',
              color: isUltraCompact ? '#fff' : 'var(--text-secondary)',
              lineHeight: isUltraCompact ? 1.3 : 1.45,
            }}
            dangerouslySetInnerHTML={{ __html: renderRichContent(bodyText) }}
          />
        )}
      </div>
    </div>
  );
};
