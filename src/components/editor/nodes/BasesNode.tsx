import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect } from 'react';

export interface BasesOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    basesBlock: {
      insertBasesBlock: (options?: { category?: string; tag?: string; layout?: string; limit?: number }) => ReturnType;
    };
  }
}

const BasesComponentView: React.FC<any> = (props) => {
  const { category = '', tag = '', layout = 'table', limit = 5 } = props.node.attrs;
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (tag) params.set('tag', tag);
      params.set('limit', String(limit || 5));

      const res = await fetch(`/api/v1/resources/query?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      } else {
        setError('Failed to fetch dynamic query data');
      }
    } catch (err: any) {
      setError(err.message || 'Network error querying bases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, [category, tag, layout, limit]);

  const updateAttr = (key: string, value: any) => {
    props.updateAttributes({ [key]: value });
  };

  return (
    <NodeViewWrapper className="bases-query-node" style={{ margin: '1.5rem 0' }}>
      <div
        contentEditable={false}
        style={{
          border: '1px solid rgba(0, 242, 254, 0.4)',
          borderRadius: '12px',
          background: 'rgba(8, 14, 30, 0.75)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 0 15px rgba(0, 242, 254, 0.05)',
          overflow: 'hidden',
        }}
      >
        {/* HEADER BAR */}
        <div
          style={{
            background: 'rgba(0, 242, 254, 0.08)',
            borderBottom: '1px solid rgba(0, 242, 254, 0.2)',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.1rem' }}>📊</span>
            <div>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
                Bases Dynamic Query
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                {category ? `cat:${category}` : ''} {tag ? `#${tag}` : ''} ({items.length} items)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsConfiguring(!isConfiguring)}
              style={{
                background: isConfiguring ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.06)',
                color: isConfiguring ? '#050810' : '#fff',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isConfiguring ? '✓ Done' : '⚙️ Configure'}
            </button>
            <button
              onClick={() => fetchResults()}
              title="Refresh query"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              ⟳
            </button>
            <button
              onClick={() => props.deleteNode()}
              title="Delete block"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* CONFIGURATION PANEL */}
        {isConfiguring && (
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(0, 0, 0, 0.35)',
              borderBottom: '1px solid rgba(0, 242, 254, 0.15)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                Filter Category
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => updateAttr('category', e.target.value)}
                placeholder="e.g. agentic_ai, general"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                Filter Tag
              </label>
              <input
                type="text"
                value={tag}
                onChange={(e) => updateAttr('tag', e.target.value)}
                placeholder="e.g. ai, canvas, guide"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                Display Layout
              </label>
              <select
                value={layout}
                onChange={(e) => updateAttr('layout', e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'rgba(10, 15, 30, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              >
                <option value="table">Interactive Table</option>
                <option value="grid">Visual Cards Grid</option>
                <option value="list">Bullet List</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                Item Limit
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={limit}
                onChange={(e) => updateAttr('limit', parseInt(e.target.value) || 5)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              />
            </div>
          </div>
        )}

        {/* DATA PREVIEW BODY */}
        <div style={{ padding: '14px', minHeight: '80px' }}>
          {loading && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Loading dynamic bases data...</div>}
          {error && <div style={{ fontSize: '0.82rem', color: 'var(--accent-rose)' }}>{error}</div>}

          {!loading && !error && items.length === 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '1rem' }}>
              No matching resources found for this query filter.
            </div>
          )}

          {!loading && !error && items.length > 0 && layout === 'table' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px' }}>Resource Title</th>
                    <th style={{ padding: '6px 10px' }}>Type</th>
                    <th style={{ padding: '6px 10px' }}>Category</th>
                    <th style={{ padding: '6px 10px' }}>Tags</th>
                    <th style={{ padding: '6px 10px' }}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600, color: '#fff' }}>
                        <a href={`/${it.slug || it.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>
                          {it.title}
                        </a>
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{it.type}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{it.category || '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {(it.tags || []).slice(0, 3).map((t: string) => (
                          <span key={t} style={{ fontSize: '0.7rem', background: 'rgba(0, 242, 254, 0.1)', color: 'var(--accent-cyan)', padding: '1px 6px', borderRadius: '8px', marginRight: '4px' }}>
                            #{t}
                          </span>
                        ))}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {it.updated_at ? new Date(it.updated_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && items.length > 0 && layout === 'grid' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {items.map((it: any) => (
                <div key={it.id} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
                    <a href={`/${it.slug || it.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>
                      {it.title}
                    </a>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px' }}>{it.type} · {it.category || 'general'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {(it.tags || []).slice(0, 2).map((t: string) => (
                      <span key={t} style={{ fontSize: '0.65rem', background: 'rgba(0, 242, 254, 0.1)', color: 'var(--accent-cyan)', padding: '1px 5px', borderRadius: '4px' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && items.length > 0 && layout === 'list' && (
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
              {items.map((it: any) => (
                <li key={it.id} style={{ marginBottom: '4px' }}>
                  <a href={`/${it.slug || it.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 600 }}>
                    {it.title}
                  </a>{' '}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({it.category})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const BasesExtension = Node.create<BasesOptions>({
  name: 'basesBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      category: { default: '' },
      tag: { default: '' },
      layout: { default: 'table' },
      limit: { default: 5 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-bases-block]',
        getAttrs: (element) => ({
          category: (element as HTMLElement).getAttribute('data-category') || '',
          tag: (element as HTMLElement).getAttribute('data-tag') || '',
          layout: (element as HTMLElement).getAttribute('data-layout') || 'table',
          limit: parseInt((element as HTMLElement).getAttribute('data-limit') || '5', 10),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-bases-block': true })];
  },

  addCommands() {
    return {
      insertBasesBlock:
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
    return ReactNodeViewRenderer(BasesComponentView);
  },
});
