import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import React, { useState } from 'react';

export interface CalloutOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (type?: 'info' | 'warning' | 'success' | 'error' | 'important') => ReturnType;
    };
  }
}

const CalloutComponent = (props: any) => {
  const type = props.node.attrs.type || 'info';
  const isCollapsed = Boolean(props.node.attrs.collapsed);
  const [collapsed, setCollapsed] = useState(isCollapsed);

  const configs: Record<string, { icon: string; color: string; label: string }> = {
    info: { icon: '💡', color: 'var(--accent-cyan)', label: 'Note' },
    success: { icon: '✨', color: 'var(--accent-emerald)', label: 'Tip' },
    warning: { icon: '⚠️', color: 'var(--accent-amber)', label: 'Warning' },
    error: { icon: '🚨', color: 'var(--accent-rose)', label: 'Danger' },
    important: { icon: '📌', color: '#818cf8', label: 'Important' },
  };

  const current = configs[type] || configs.info;

  const cycleType = () => {
    const types = ['info', 'success', 'warning', 'error', 'important'];
    const nextIndex = (types.indexOf(type) + 1) % types.length;
    props.updateAttributes({ type: types[nextIndex] });
  };

  const toggleCollapse = () => {
    const nextState = !collapsed;
    setCollapsed(nextState);
    props.updateAttributes({ collapsed: nextState });
  };

  return (
    <NodeViewWrapper
      className={`callout-node type-${type}`}
      style={{
        borderLeft: `4px solid ${current.color}`,
        background: 'rgba(10, 16, 32, 0.65)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        borderRadius: '0 10px 10px 0',
        margin: '1.25rem 0',
        overflow: 'hidden',
      }}
    >
      {/* CALLOUT TOP BAR */}
      <div
        contentEditable={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={cycleType}
            title="Click to switch callout type"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {current.icon}
          </button>
          <button
            onClick={cycleType}
            title="Click to switch callout type"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: current.color,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {current.label}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={toggleCollapse}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            {collapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
          <button
            onClick={() => props.deleteNode()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* CALLOUT CONTENT */}
      {!collapsed && (
        <div style={{ padding: '12px 16px' }}>
          <NodeViewContent className="content" />
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const CalloutExtension = Node.create<CalloutOptions>({
  name: 'callout',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (element) => element.getAttribute('data-type') || 'info',
        renderHTML: (attributes) => ({
          'data-type': attributes.type,
        }),
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => ({
          'data-collapsed': attributes.collapsed,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
      },
      {
        tag: 'blockquote',
        getAttrs: (element) => {
          const text = (element as HTMLElement).innerText;
          if (text.startsWith('[!info]') || text.startsWith('[!note]')) return { type: 'info' };
          if (text.startsWith('[!warning]')) return { type: 'warning' };
          if (text.startsWith('[!success]') || text.startsWith('[!tip]')) return { type: 'success' };
          if (text.startsWith('[!error]') || text.startsWith('[!danger]')) return { type: 'error' };
          if (text.startsWith('[!important]')) return { type: 'important' };
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (type = 'info') =>
        ({ commands }) => {
          return commands.setNode(this.name, { type });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent);
  },
});
