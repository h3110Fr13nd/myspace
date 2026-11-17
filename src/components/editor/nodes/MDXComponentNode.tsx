import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';

export interface MDXComponentOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mdxComponent: {
      insertMDXComponent: (options: { componentName: string; props?: Record<string, any> }) => ReturnType;
    };
  }
}

const MDXComponentView = (props: any) => {
  const [isEditing, setIsEditing] = useState(false);
  const { componentName, componentProps } = props.node.attrs;

  const handlePropChange = (key: string, value: string) => {
    props.updateAttributes({
      componentProps: { ...componentProps, [key]: value },
    });
  };

  return (
    <NodeViewWrapper
      className="mdx-component-node"
      style={{
        border: '1px solid var(--accent-cyan)',
        borderRadius: '8px',
        margin: '1rem 0',
        background: 'rgba(8, 12, 24, 0.6)',
        overflow: 'hidden',
      }}
    >
      <div
        contentEditable={false}
        style={{
          background: 'rgba(0, 242, 254, 0.1)',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setIsEditing(!isEditing)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace', fontWeight: 600 }}>
            &lt;{componentName} /&gt;
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MDX Component</span>
        </div>
        <button
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            props.deleteNode();
          }}
        >
          🗑️
        </button>
      </div>

      {isEditing && (
        <div contentEditable={false} style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Props Inspector:</div>
          {Object.entries(componentProps || {}).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ fontSize: '0.8rem', width: '80px', color: '#fff' }}>{key}</label>
              <input
                type="text"
                value={String(value)}
                onChange={(e) => handlePropChange(key, e.target.value)}
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--border-glass)',
                  padding: '4px 8px',
                  color: '#fff',
                  borderRadius: '4px',
                }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
            <input
              type="text"
              placeholder="New prop key..."
              id={`new-prop-${props.getPos()}`}
              style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-glass)', padding: '4px 8px', color: '#fff', borderRadius: '4px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePropChange(e.currentTarget.value, '');
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Preview placeholder */}
      {!isEditing && (
        <div contentEditable={false} style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Visual preview of {componentName} would render here.
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const MDXComponentExtension = Node.create<MDXComponentOptions>({
  name: 'mdxComponent',

  group: 'block',
  atom: true,

  addAttributes() {
    return {
      componentName: {
        default: 'div',
      },
      componentProps: {
        default: {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mdx-component]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-mdx-component': true })];
  },

  addCommands() {
    return {
      insertMDXComponent:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MDXComponentView);
  },
});
