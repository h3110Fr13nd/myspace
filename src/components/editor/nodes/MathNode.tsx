import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: () => ReturnType;
    };
  }
}

const MathComponentView = (props: any) => {
  const [isEditing, setIsEditing] = useState(false);
  const { tex } = props.node.attrs;
  const katexRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (katexRef.current) {
      try {
        katex.render(tex || '\\int_0^\\infty x^2 dx', katexRef.current, {
          displayMode: true,
          throwOnError: false,
        });
      } catch (err) {
        katexRef.current.innerText = String(err);
      }
    }
  }, [tex, isEditing]);

  return (
    <NodeViewWrapper className="math-node" style={{ margin: '1rem 0' }}>
      {!isEditing ? (
        <div
          contentEditable={false}
          onClick={() => setIsEditing(true)}
          style={{
            cursor: 'pointer',
            padding: '1rem',
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: '8px',
            border: '1px solid transparent',
            transition: 'border 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.border = '1px solid var(--accent-cyan)')}
          onMouseLeave={(e) => (e.currentTarget.style.border = '1px solid transparent')}
        >
          {tex ? (
            <div ref={katexRef} />
          ) : (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
              Click to add Math Equation
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(15, 23, 42, 0.8)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--accent-cyan)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 700, textTransform: 'uppercase' }}>LaTeX Equation Editor</span>
            <button
              onClick={() => setIsEditing(false)}
              style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              Done
            </button>
          </div>
          <textarea
            autoFocus
            value={tex}
            onChange={(e) => props.updateAttributes({ tex: e.target.value })}
            style={{
              width: '100%',
              minHeight: '80px',
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid var(--border-glass)',
              color: '#fff',
              fontFamily: 'monospace',
              padding: '8px',
              borderRadius: '4px',
              resize: 'vertical',
            }}
            placeholder="\sum_{i=1}^{n} i^2"
          />
          <div style={{ padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
            <div ref={katexRef} />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const MathExtension = Node.create<MathOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      tex: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-math-block]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-math-block': true })];
  },

  addCommands() {
    return {
      insertMathBlock:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { tex: '' },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathComponentView);
  },
});
