import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';
import '@excalidraw/excalidraw/index.css';
import { BlockChrome } from './BlockChrome';
import { RoughElement } from '../../excalidraw/RoughFallback';
import { showToast } from '../../ui/Toast';

if (typeof window !== 'undefined') {
  (window as any).EXCALIDRAW_ASSET_PATH = '/';
}

export interface ExcalidrawOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    excalidrawBlock: {
      insertExcalidrawBlock: (options?: { elements?: any[]; title?: string }) => ReturnType;
    };
  }
}

const DEFAULT_ELEMENTS = [
  {
    id: 'el-1',
    type: 'rectangle',
    x: 40,
    y: 40,
    width: 170,
    height: 80,
    strokeColor: '#00f2fe',
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    strokeWidth: 2,
  },
  {
    id: 'el-2',
    type: 'text',
    x: 60,
    y: 72,
    text: 'Client Agent',
    fontSize: 15,
    strokeColor: '#ffffff',
  },
  {
    id: 'el-3',
    type: 'arrow',
    x: 210,
    y: 80,
    width: 120,
    height: 0,
    strokeColor: '#6366f1',
    strokeWidth: 2,
    points: [[0, 0], [120, 0]],
  },
  {
    id: 'el-4',
    type: 'ellipse',
    x: 330,
    y: 35,
    width: 180,
    height: 90,
    strokeColor: '#ec4899',
    backgroundColor: 'rgba(236, 72, 153, 0.12)',
    strokeWidth: 2,
  },
  {
    id: 'el-5',
    type: 'text',
    x: 360,
    y: 72,
    text: 'ReBAC Proxy',
    fontSize: 15,
    strokeColor: '#ffffff',
  },
];

const ExcalidrawComponentView: React.FC<any> = (props) => {
  const initialElements = props.node.attrs.elements || DEFAULT_ELEMENTS;
  const [elements, setElements] = useState<any[]>(() => {
    if (typeof initialElements === 'string') {
      try {
        return JSON.parse(initialElements);
      } catch {
        return DEFAULT_ELEMENTS;
      }
    }
    return Array.isArray(initialElements) ? initialElements : DEFAULT_ELEMENTS;
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isLiveEditor, setIsLiveEditor] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(elements, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [ExcalidrawComp, setExcalidrawComp] = useState<any>(null);

  // Client dynamic loader for full @excalidraw/excalidraw
  React.useEffect(() => {
    let mounted = true;
    import('@excalidraw/excalidraw')
      .then((mod) => {
        if (mounted) setExcalidrawComp(() => mod.Excalidraw);
      })
      .catch((err) => {
        console.info('RoughJS fallback for Excalidraw block:', err);
        showToast('Excalidraw failed to load — using the lightweight sketch fallback.', { tone: 'warn' });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleApply = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed) ? parsed : (parsed.elements || []);
      setElements(arr);
      props.updateAttributes({ elements: arr });
      setIsEditing(false);
      setParseError(null);
    } catch (err: any) {
      setParseError(err.message || 'Invalid JSON format');
    }
  };


  return (
    <NodeViewWrapper className="excalidraw-editor-node">
      <BlockChrome
        icon="🎨"
        title={props.node.attrs.title || "Excalidraw Sketch"}
        accentColor="#ec4899"
        onDelete={() => props.deleteNode()}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {ExcalidrawComp && (
              <button
                type="button"
                onClick={() => {
                  setIsLiveEditor(!isLiveEditor);
                  setIsEditing(false);
                }}
                style={{
                  background: isLiveEditor ? '#ec4899' : 'rgba(236, 72, 153, 0.15)',
                  color: isLiveEditor ? '#fff' : '#f472b6',
                  border: '1px solid rgba(236, 72, 153, 0.4)',
                  borderRadius: '6px',
                  padding: '3px 9px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isLiveEditor ? '👁️ Preview' : '🎨 Draw Live'}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isEditing) handleApply();
                else {
                  setIsEditing(true);
                  setIsLiveEditor(false);
                }
              }}
              style={{
                background: isEditing ? '#ec4899' : 'rgba(255, 255, 255, 0.06)',
                color: '#fff',
                border: '1px solid rgba(236, 72, 153, 0.4)',
                borderRadius: '6px',
                padding: '3px 9px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isEditing ? '✓ Apply' : '✏️ JSON'}
            </button>

            <button
              type="button"
              onClick={(e) => {
                const shell = (e.currentTarget.closest('.block-chrome-shell') || e.currentTarget.closest('.excalidraw-editor-node')) as HTMLElement;
                if (document.fullscreenElement) {
                  document.exitFullscreen();
                } else if (shell) {
                  shell.requestFullscreen?.();
                }
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#f472b6',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Toggle Fullscreen"
            >
              ⛶
            </button>
          </div>
        }
      >
        {isEditing && (
          <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                background: '#090d16',
                color: '#f472b6',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                borderRadius: '6px',
                padding: '8px',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            {parseError && (
              <div style={{ color: 'var(--accent-rose)', fontSize: '0.75rem', marginTop: '4px' }}>
                {parseError}
              </div>
            )}
          </div>
        )}

        {isLiveEditor && ExcalidrawComp ? (
          <div style={{ height: '420px', width: '100%', position: 'relative' }}>
            <ExcalidrawComp
              theme="dark"
              initialData={{
                elements,
                appState: { theme: 'dark', viewBackgroundColor: '#080c18' },
              }}
              onChange={(els: any[]) => {
                setElements(els);
                props.updateAttributes({ elements: els });
              }}
            />
          </div>
        ) : (
          <div
            style={{
              minHeight: '180px',
              background: 'radial-gradient(ellipse at center, rgba(236, 72, 153, 0.04) 0%, rgba(8, 12, 24, 0.95) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px',
              overflow: 'auto',
            }}
          >
            <svg
              width="100%"
              height="180"
              viewBox="0 0 560 160"
              style={{ maxWidth: '560px', display: 'block' }}
            >
              {elements.map((el: any, i: number) => (
                <RoughElement key={el?.id ?? i} el={el} defaultStroke="#ec4899" />
              ))}
            </svg>
          </div>
        )}
      </BlockChrome>
    </NodeViewWrapper>
  );
};

export const ExcalidrawExtension = Node.create<ExcalidrawOptions>({
  name: 'excalidrawBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      elements: {
        default: DEFAULT_ELEMENTS,
      },
      title: {
        default: 'Excalidraw Sketch',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-excalidraw-block]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const raw = el.getAttribute('data-elements');
          let elements = DEFAULT_ELEMENTS;
          if (raw) {
            try {
              elements = JSON.parse(raw);
            } catch {
              elements = DEFAULT_ELEMENTS;
            }
          }
          return {
            elements,
            title: el.getAttribute('data-title') || 'Excalidraw Sketch',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-excalidraw-block': true,
        'data-elements': JSON.stringify(HTMLAttributes.elements || DEFAULT_ELEMENTS),
        'data-title': HTMLAttributes.title || 'Excalidraw Sketch',
      }),
    ];
  },

  addCommands() {
    return {
      insertExcalidrawBlock:
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
    return ReactNodeViewRenderer(ExcalidrawComponentView);
  },
});
