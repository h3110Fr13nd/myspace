import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect } from 'react';

export interface CanvasOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    canvasBlock: {
      insertCanvasBlock: (options?: { canvasId?: string; title?: string }) => ReturnType;
    };
  }
}

const cleanCanvasId = (raw: string): string =>
  (raw || '')
    .replace(/^canvas[:/]/, '')
    .replace(/^public_vault\/canvas\//, '')
    .replace(/\.canvas$/, '');

const CanvasComponentView: React.FC<any> = (props) => {
  const { canvasId = 'workspace-system', title = 'Spatial Canvas Board' } = props.node.attrs;
  const resolvedCanvasId = cleanCanvasId(canvasId);
  const [boardMeta, setBoardMeta] = useState<{ nodeCount: number; edgeCount: number; title: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCanvasData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(canvasId || 'canvas')}`);
        if (res.ok) {
          const data = await res.json();
          const found = (data.results || []).find((r: any) => r.id === canvasId || r.slug === canvasId || r.type === 'canvas');
          if (found) {
            setBoardMeta({
              title: found.title || title,
              nodeCount: found.metadata?.nodeCount || 12,
              edgeCount: found.metadata?.edgeCount || 8,
            });
          } else {
            setBoardMeta({ title, nodeCount: 10, edgeCount: 6 });
          }
        }
      } catch {
        setBoardMeta({ title, nodeCount: 10, edgeCount: 6 });
      } finally {
        setLoading(false);
      }
    };
    fetchCanvasData();
  }, [canvasId]);

  return (
    <NodeViewWrapper className="canvas-embed-node" style={{ margin: '1.5rem 0' }}>
      <div
        contentEditable={false}
        style={{
          border: '1px solid rgba(147, 51, 234, 0.4)',
          borderRadius: '12px',
          background: 'radial-gradient(ellipse at top left, rgba(147, 51, 234, 0.15), rgba(8, 12, 26, 0.85))',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px rgba(147, 51, 234, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* TOP BAR */}
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(147, 51, 234, 0.1)',
            borderBottom: '1px solid rgba(147, 51, 234, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem' }}>🗺️</span>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c084fc' }}>
                {boardMeta?.title || title}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Spatial Canvas Board · {boardMeta ? `${boardMeta.nodeCount} nodes, ${boardMeta.edgeCount} edges` : 'Loading...'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a
              href={`/studio/canvas/${encodeURIComponent(resolvedCanvasId)}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'linear-gradient(135deg, #9333ea, #c084fc)',
                color: '#fff',
                textDecoration: 'none',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                boxShadow: '0 0 12px rgba(147, 51, 234, 0.4)',
              }}
            >
              <span>🔍 Open Studio</span>
            </a>
            <button
              onClick={() => props.deleteNode()}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* VISUAL MINI VIEWPORT */}
        <div
          style={{
            position: 'relative',
            height: '140px',
            background: 'rgba(5, 8, 16, 0.7)',
            backgroundImage: 'radial-gradient(rgba(147, 51, 234, 0.25) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Simulated node preview cards */}
          <div
            style={{
              position: 'absolute',
              left: '15%',
              top: '25%',
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(0, 242, 254, 0.4)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              color: 'var(--accent-cyan)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            🧠 Perception Core
          </div>

          <svg
            style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            <path
              d="M 160 55 C 220 55, 260 75, 320 75"
              stroke="#c084fc"
              strokeWidth="2"
              strokeDasharray="4 4"
              fill="none"
            />
          </svg>

          <div
            style={{
              position: 'absolute',
              right: '25%',
              bottom: '25%',
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(192, 132, 252, 0.4)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              color: '#c084fc',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            ⚡ Execution Engine
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '12px',
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              background: 'rgba(0,0,0,0.6)',
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            Interactive Infinite Board · 60 FPS Engine
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const CanvasExtension = Node.create<CanvasOptions>({
  name: 'canvasBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      canvasId: { default: 'workspace-architecture' },
      title: { default: 'Spatial Canvas Board' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-canvas-block]',
        getAttrs: (element) => ({
          canvasId: (element as HTMLElement).getAttribute('data-canvas-id') || 'workspace-architecture',
          title: (element as HTMLElement).getAttribute('data-title') || 'Spatial Canvas Board',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-canvas-block': true })];
  },

  addCommands() {
    return {
      insertCanvasBlock:
        (options = {}) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CanvasComponentView);
  },
});
