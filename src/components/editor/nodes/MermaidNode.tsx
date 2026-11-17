import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect, useRef } from 'react';
import { BlockChrome } from './BlockChrome';
import { loadMermaid } from '../../../lib/mermaid';

export interface MermaidOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaidBlock: {
      insertMermaidBlock: (options?: { code?: string }) => ReturnType;
    };
  }
}

const MermaidComponentView: React.FC<any> = (props) => {
  const code = props.node.attrs.code || `graph LR\n  A[Client Request] --> B(Edge Worker)\n  B --> C{ReBAC Auth}\n  C -->|Allowed| D[(Durable Object)]\n  C -->|Denied| E[403 Forbidden]`;
  const [isEditing, setIsEditing] = useState(false);
  const [localCode, setLocalCode] = useState(code);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Dynamic mermaid loader
  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      setRenderError(null);
      try {
        const id = `mermaid-svg-${Math.random().toString(36).substring(2, 9)}`;
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, localCode);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          setRenderError(err.message || 'Syntax error in Mermaid diagram');
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [localCode]);

  const handleSaveCode = () => {
    props.updateAttributes({ code: localCode });
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className="mermaid-diagram-node">
      <BlockChrome
        icon="📐"
        title="Mermaid Diagram"
        accentColor="#6366f1"
        onDelete={() => props.deleteNode()}
        actions={
          <button
            onClick={() => {
              if (isEditing) handleSaveCode();
              else setIsEditing(true);
            }}
            style={{
              background: isEditing ? '#6366f1' : 'rgba(255, 255, 255, 0.06)',
              color: '#fff',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: '6px',
              padding: '3px 9px',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isEditing ? '✓ Apply' : '✏️ Edit'}
          </button>
        }
      >

        {/* CODE EDITOR VIEW */}
        {isEditing && (
          <div style={{ padding: '12px' }}>
            <textarea
              value={localCode}
              onChange={(e) => setLocalCode(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                padding: '10px',
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#38bdf8',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                outline: 'none',
                resize: 'vertical',
              }}
            />
            {renderError && (
              <div style={{ color: 'var(--accent-rose)', fontSize: '0.75rem', marginTop: '6px' }}>
                ⚠️ {renderError}
              </div>
            )}
          </div>
        )}

        {/* LIVE RENDERED SVG VIEW */}
        <div
          ref={containerRef}
          style={{
            padding: '20px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflowX: 'auto',
            minHeight: '120px',
          }}
        >
          {svgContent && !renderError ? (
            <div
              dangerouslySetInnerHTML={{ __html: svgContent }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            />
          ) : renderError ? (
            <div style={{ color: 'var(--accent-rose)', fontSize: '0.82rem', textAlign: 'center' }}>
              Error rendering diagram: {renderError}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
              Rendering diagram...
            </div>
          )}
        </div>
      </BlockChrome>
    </NodeViewWrapper>
  );
};

export const MermaidExtension = Node.create<MermaidOptions>({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: `graph LR\n  A[Client Request] --> B(Edge Worker)\n  B --> C{ReBAC Auth}\n  C -->|Allowed| D[(Durable Object)]\n  C -->|Denied| E[403 Forbidden]`,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid-block]',
        getAttrs: (element) => ({
          code: (element as HTMLElement).getAttribute('data-code') || '',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-mermaid-block': true })];
  },

  addCommands() {
    return {
      insertMermaidBlock:
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
    return ReactNodeViewRenderer(MermaidComponentView);
  },
});
