import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';
import { BlockChrome } from './BlockChrome';

export interface JupyterOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    jupyterBlock: {
      insertJupyterBlock: (options?: {
        code?: string;
        output?: string;
        executionCount?: number;
      }) => ReturnType;
    };
  }
}

const DEFAULT_CODE = `import numpy as np\n\n# Compute contrastive loss and cosine similarity\nquery_vector = np.array([0.15, 0.82, -0.34, 0.51])\nkey_vector = np.array([0.12, 0.79, -0.31, 0.49])\ncos_sim = np.dot(query_vector, key_vector) / (np.linalg.norm(query_vector) * np.linalg.norm(key_vector))\nprint(f"Cosine similarity score: {cos_sim:.4f}")`;

const DEFAULT_OUTPUT = `Cosine similarity score: 0.9987`;

const JupyterComponentView: React.FC<any> = (props) => {
  const [code, setCode] = useState(props.node.attrs.code || DEFAULT_CODE);
  const [output, setOutput] = useState(props.node.attrs.output || DEFAULT_OUTPUT);
  const [executionCount, setExecutionCount] = useState<number>(props.node.attrs.executionCount || 1);
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = () => {
    setIsRunning(true);
    setTimeout(() => {
      const nextCount = executionCount + 1;
      setExecutionCount(nextCount);
      props.updateAttributes({
        code,
        output,
        executionCount: nextCount,
      });
      setIsRunning(false);
      setIsEditing(false);
    }, 400);
  };

  return (
    <NodeViewWrapper className="jupyter-cell-editor-node">
      <BlockChrome
        icon="🪐"
        title={`Jupyter Cell [${executionCount}]`}
        accentColor="#f37626"
        onDelete={() => props.deleteNode()}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setIsEditing(!isEditing)}
              style={{
                background: isEditing ? 'rgba(243, 118, 38, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                color: isEditing ? '#f37626' : '#fff',
                border: '1px solid rgba(243, 118, 38, 0.4)',
                borderRadius: '6px',
                padding: '3px 9px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isEditing ? '✓ Done' : '✏️ Edit'}
            </button>
            <button
              onClick={handleRun}
              disabled={isRunning}
              style={{
                background: '#f37626',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '3px 9px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {isRunning ? '⏳ Running...' : '▶ Run'}
            </button>
          </div>
        }
      >
        <div style={{ padding: '12px 14px', background: 'rgba(8, 12, 24, 0.95)' }}>
          {/* INPUT CELL */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: '#f37626',
                fontWeight: 700,
                paddingTop: '6px',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              In [{executionCount}]:
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {isEditing ? (
                <textarea
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    props.updateAttributes({ code: e.target.value });
                  }}
                  rows={5}
                  style={{
                    width: '100%',
                    background: '#090d16',
                    color: '#e2e8f0',
                    border: '1px solid rgba(243, 118, 38, 0.4)',
                    borderRadius: '6px',
                    padding: '8px',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    overflowX: 'auto',
                  }}
                >
                  <code>{code}</code>
                </pre>
              )}
            </div>
          </div>

          {/* OUTPUT CELL */}
          {output && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '10px' }}>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: 'var(--accent-rose, #f43f5e)',
                  fontWeight: 700,
                  paddingTop: '2px',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                Out [{executionCount}]:
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input
                    type="text"
                    value={output}
                    onChange={(e) => {
                      setOutput(e.target.value);
                      props.updateAttributes({ output: e.target.value });
                    }}
                    style={{
                      width: '100%',
                      background: '#090d16',
                      color: '#10b981',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      fontFamily: 'monospace',
                      fontSize: '0.78rem',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      color: '#10b981',
                      background: 'rgba(16, 185, 129, 0.08)',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {output}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </BlockChrome>
    </NodeViewWrapper>
  );
};

export const JupyterExtension = Node.create<JupyterOptions>({
  name: 'jupyterBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: DEFAULT_CODE,
      },
      output: {
        default: DEFAULT_OUTPUT,
      },
      executionCount: {
        default: 1,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-jupyter-block]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return {
            code: el.getAttribute('data-code') || DEFAULT_CODE,
            output: el.getAttribute('data-output') || DEFAULT_OUTPUT,
            executionCount: parseInt(el.getAttribute('data-execution-count') || '1', 10),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-jupyter-block': true,
        'data-code': HTMLAttributes.code || DEFAULT_CODE,
        'data-output': HTMLAttributes.output || DEFAULT_OUTPUT,
        'data-execution-count': String(HTMLAttributes.executionCount || 1),
      }),
    ];
  },

  addCommands() {
    return {
      insertJupyterBlock:
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
    return ReactNodeViewRenderer(JupyterComponentView);
  },
});
