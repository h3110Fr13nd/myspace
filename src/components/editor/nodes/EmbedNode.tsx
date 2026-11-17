import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useEffect, useState } from 'react';

export interface EmbedOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedBlock: {
      insertEmbedBlock: (target: string) => ReturnType;
    };
  }
}

const EmbedComponentView = (props: any) => {
  const { target = '' } = props.node.attrs;
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [noteSlug, subTarget] = target.split('#');
  const isBlockTransclusion = subTarget?.startsWith('^');
  const isHeadingTransclusion = Boolean(subTarget && !isBlockTransclusion);

  useEffect(() => {
    if (!noteSlug) return;

    const fetchPreview = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(noteSlug)}`);
        if (res.ok) {
          const data = await res.json();
          const found = (data.results || []).find((r: any) => r.slug === noteSlug || r.id === noteSlug || r.title?.toLowerCase() === noteSlug.toLowerCase());
          if (found) {
            setPreview(found.summary || 'Transcluded note content loaded.');
          } else {
            setPreview(`Linked resource "${noteSlug}" found in vault.`);
          }
        }
      } catch (err) {
        setPreview('Error loading transcluded content.');
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [noteSlug, subTarget]);

  return (
    <NodeViewWrapper className="embed-node" style={{ margin: '1.25rem 0' }}>
      <div
        contentEditable={false}
        style={{
          border: '1px solid rgba(0, 242, 254, 0.3)',
          borderRadius: '10px',
          background: 'rgba(10, 16, 30, 0.7)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'rgba(0, 242, 254, 0.08)',
            padding: '8px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(0, 242, 254, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--accent-cyan)' }}>🔗</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fff' }}>
              ![[{noteSlug}{subTarget ? `#${subTarget}` : ''}]]
            </span>
            {isHeadingTransclusion && (
              <span style={{ fontSize: '0.68rem', background: 'rgba(99, 102, 241, 0.2)', color: 'var(--accent-primary)', padding: '1px 6px', borderRadius: '4px' }}>
                Section: {subTarget}
              </span>
            )}
            {isBlockTransclusion && (
              <span style={{ fontSize: '0.68rem', background: 'rgba(16, 185, 129, 0.2)', color: 'var(--accent-emerald)', padding: '1px 6px', borderRadius: '4px' }}>
                Block: {subTarget}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <a
              href={`/${noteSlug}${subTarget ? `#${subTarget}` : ''}`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.72rem',
                color: 'var(--accent-cyan)',
                textDecoration: 'none',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.05)',
              }}
            >
              ↗ Open Note
            </a>
            <button
              onClick={() => props.deleteNode()}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '12px 16px', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {loading ? (
            <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Loading transclusion...</span>
          ) : (
            <div>{preview}</div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const EmbedExtension = Node.create<EmbedOptions>({
  name: 'embedBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      target: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-embed-target]',
        getAttrs: (element) => ({
          target: (element as HTMLElement).getAttribute('data-embed-target') || '',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-embed-target': HTMLAttributes.target })];
  },

  addCommands() {
    return {
      insertEmbedBlock:
        (target: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { target },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedComponentView);
  },
});
