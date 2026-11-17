import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import AnsiConverter from 'ansi-to-html';
import { renderDisplayMath, renderInlineMath } from '../lib/render/mathRenderer';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button, IconButton } from './ui/Button';
import { Badge } from './ui/Badge';
import { Code, Terminal, ChevronDown, ChevronUp, Expand } from 'lucide-react';

const ansi = new AnsiConverter({
  fg: '#e2e8f0',
  bg: 'transparent',
  newline: true,
  escapeXML: true,
});

export interface JupyterCell {
  cell_type: 'code' | 'markdown' | 'raw';
  execution_count?: number | null;
  source: string | string[];
  outputs?: Array<{
    output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
    name?: string;
    text?: string | string[];
    data?: {
      'text/plain'?: string | string[];
      'text/html'?: string | string[];
      'image/png'?: string;
      'image/jpeg'?: string;
      'image/svg+xml'?: string | string[];
      [key: string]: any;
    };
    ename?: string;
    evalue?: string;
    traceback?: string[];
  }>;
}

export interface JupyterNotebookSpec {
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: {
    kernelspec?: {
      name: string;
      display_name: string;
      language?: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
    [key: string]: any;
  };
  cells: JupyterCell[];
}

interface Props {
  spec?: JupyterNotebookSpec;
  assetId?: string;
  notebookId?: string;
  title?: string;
  rawContent?: string;
  rawJson?: string;
  currentUser?: string;
  isEmbedded?: boolean;
  height?: string | number;
}

const DEFAULT_NOTEBOOK: JupyterNotebookSpec = {
  metadata: {
    kernelspec: {
      name: 'python3',
      display_name: 'Python 3 (ipykernel)',
      language: 'python',
    },
  },
  cells: [
    {
      cell_type: 'markdown',
      source: [
        '# 🪐 Agentic Memory & ReBAC Policy Simulation\n',
        'This notebook computes graph centrality across fine-grained OpenFGA relation tuples.\n',
        '$$\\mathcal{P}(u, r, o) = \\mathbb{I}[\\exists \\text{ path } u \\rightsquigarrow o]$$',
      ],
    },
    {
      cell_type: 'code',
      execution_count: 1,
      source: [
        'import networkx as nx\n',
        'import matplotlib.pyplot as plt\n',
        '\n',
        'G = nx.DiGraph()\n',
        'G.add_edges_from([\n',
        '    ("user:alice", "circle:engineering"),\n',
        '    ("circle:engineering", "folder:research"),\n',
        '    ("folder:research", "document:master-walkthrough")\n',
        '])\n',
        'print(f"Total nodes: {G.number_of_nodes()}, edges: {G.number_of_edges()}")',
      ],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: ['Total nodes: 4, edges: 3\n'],
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 2,
      source: [
        'centrality = nx.betweenness_centrality(G)\n',
        'for node, score in centrality.items():\n',
        '    print(f"{node:35}: {score:.4f}")',
      ],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: [
            'user:alice                         : 0.0000\n',
            'circle:engineering                 : 0.3333\n',
            'folder:research                    : 0.3333\n',
            'document:master-walkthrough        : 0.0000\n',
          ],
        },
      ],
    },
  ],
};

function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source || '';
}

function renderMarkdownText(md: string): string {
  let processed = renderDisplayMath(md);
  processed = renderInlineMath(processed);
  return marked.parse(processed) as string;
}

export const JupyterViewer: React.FC<Props> = ({
  spec,
  assetId,
  notebookId,
  title,
  rawContent,
  rawJson,
  currentUser = 'user:anonymous',
  isEmbedded = false,
  height,
}) => {
  const [notebook, setNotebook] = useState<JupyterNotebookSpec>(spec || DEFAULT_NOTEBOOK);
  const effectiveId = notebookId || assetId;
  const effectiveContent = rawJson || rawContent;
  const [loading, setLoading] = useState(Boolean(effectiveId && !spec && !effectiveContent));
  const [collapsedOutputs, setCollapsedOutputs] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (effectiveContent) {
      try {
        const parsed = JSON.parse(effectiveContent);
        if (parsed.cells) setNotebook(parsed);
      } catch {}
      setLoading(false);
    } else if (effectiveId) {
      setLoading(true);
      fetch(`/api/v1/resources/${encodeURIComponent(effectiveId)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          if (data.content) {
            const parsed = typeof data.content === 'string' ? JSON.parse(data.content) : data.content;
            if (parsed.cells) setNotebook(parsed);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [effectiveId, effectiveContent]);

  const toggleOutput = (idx: number) => {
    setCollapsedOutputs((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const expandAll = () => setCollapsedOutputs({});
  const collapseAll = () => setCollapsedOutputs(
    Object.fromEntries(notebook.cells.map((_, i) => [i, true]))
  );

  const kernelName =
    notebook.metadata?.kernelspec?.display_name ||
    notebook.metadata?.kernelspec?.name ||
    'Python 3';

  return (
    <ResourceViewerFrame
      meta={{
        icon: <Terminal size={18} />,
        title: title || 'Jupyter Notebook',
        subtitleValue: (
          <>
            <span>{notebook.cells.length} cells</span>
            <Badge tone="info">{kernelName}</Badge>
          </>
        ),
      }}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={expandAll} title="Expand all outputs">
            <ChevronDown size={14} /> Expand All
          </Button>
          <Button size="sm" variant="ghost" onClick={collapseAll} title="Collapse all outputs">
            <ChevronUp size={14} /> Collapse All
          </Button>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      style={{ height: height || (isEmbedded ? '100%' : undefined) }}
    >
      <div className="ui-viewer__stage ui-viewer__stage--scroll" style={{ flex: 1, minHeight: isEmbedded ? '200px' : '500px', maxHeight: isEmbedded ? 'none' : '700px' }}>
        {loading ? (
          <div className="ui-viewer__stage-loading">
            <span className="ui-viewer__spinner" style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--border-glass)', borderTopColor: 'var(--accent-cyan)' }} />
            Loading notebook…
          </div>
        ) : (
          <div style={{ padding: isEmbedded ? 'var(--space-3)' : 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%' }}>
            {notebook.cells.map((cell, idx) => {
              const rawSrc = normalizeSource(cell.source);

              if (cell.cell_type === 'markdown') {
                return (
                  <div
                    key={idx}
                    className="jupyter-cell jupyter-markdown-cell"
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdownText(rawSrc) }}
                  />
                );
              }

              // Code Cell
              const isOutputCollapsed = collapsedOutputs[idx];
              const hasOutputs = cell.outputs && cell.outputs.length > 0;

              return (
                <div
                  key={idx}
                  className="jupyter-cell jupyter-code-cell"
                  style={{
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--accent-primary)',
                    background: 'var(--surface-1)',
                    overflow: 'hidden',
                  }}
                >
                  {/* CODE INPUT BLOCK */}
                  <div style={{ display: 'flex', borderBottom: hasOutputs && !isOutputCollapsed ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div
                      style={{
                        width: '64px',
                        padding: 'var(--space-2) var(--space-2)',
                        fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-code)',
                        color: 'var(--accent-cyan)',
                        textAlign: 'right',
                        userSelect: 'none',
                        background: 'var(--surface-1)',
                        borderRight: '1px solid var(--border-subtle)',
                        flexShrink: 0,
                      }}
                    >
                      In [{cell.execution_count ?? ' '}]:
                    </div>
                    <div style={{ flex: 1, padding: 'var(--space-2) var(--space-3)', overflowX: 'auto' }}>
                      <pre style={{ margin: 0, fontFamily: 'var(--font-code)', fontSize: 'var(--text-sm)', color: 'var(--accent-cyan-bright)' }}>
                        <code>{rawSrc}</code>
                      </pre>
                    </div>
                  </div>

                  {/* CODE OUTPUT BLOCK */}
                  {hasOutputs && (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-1) var(--space-3)',
                          background: 'var(--surface-subtle)',
                          borderBottom: isOutputCollapsed ? 'none' : '1px solid var(--border-subtle)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          Out [{cell.execution_count ?? ' '}]:
                        </span>
                        <IconButton
                          label={isOutputCollapsed ? 'Show output' : 'Hide output'}
                          ghost
                          onClick={() => toggleOutput(idx)}
                          className="ui-icon-button--ghost"
                        >
                          {isOutputCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </IconButton>
                      </div>

                      {!isOutputCollapsed && (
                        <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-1)', overflowX: 'auto' }}>
                          {cell.outputs!.map((out, oIdx) => {
                            // Stream output (stdout / stderr)
                            if (out.output_type === 'stream') {
                              const text = normalizeSource(out.text || '');
                              const html = ansi.toHtml(text);
                              return (
                                <div
                                  key={oIdx}
                                  dangerouslySetInnerHTML={{ __html: html }}
                                  style={{
                                    margin: 0,
                                    fontFamily: 'var(--font-code)',
                                    fontSize: 'var(--text-sm)',
                                    color: out.name === 'stderr' ? 'var(--status-danger)' : 'var(--text-primary)',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                />
                              );
                            }

                            // Display Data / Execute Result
                            if (out.output_type === 'display_data' || out.output_type === 'execute_result') {
                              const imgB64 = out.data?.['image/png'] || out.data?.['image/jpeg'];
                              const html = out.data?.['text/html'];
                              const plainText = normalizeSource(out.data?.['text/plain'] || '');

                              if (imgB64) {
                                return (
                                  <img
                                    key={oIdx}
                                    src={`data:image/png;base64,${imgB64}`}
                                    alt="Notebook Plot"
                                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 'var(--radius-sm)', margin: 'var(--space-2) 0' }}
                                  />
                                );
                              }

                              if (html) {
                                const rawHtml = normalizeSource(html);
                                return (
                                  <div
                                    key={oIdx}
                                    dangerouslySetInnerHTML={{ __html: rawHtml }}
                                    style={{ overflowX: 'auto', margin: 'var(--space-1) 0' }}
                                  />
                                );
                              }

                              return (
                                <pre
                                  key={oIdx}
                                  style={{ margin: 0, fontFamily: 'var(--font-code)', fontSize: 'var(--text-sm)', color: 'var(--accent-emerald)' }}
                                >
                                  {plainText}
                                </pre>
                              );
                            }

                            // Error Traceback with ANSI Color Rendering
                            if (out.output_type === 'error') {
                              const rawError = (out.traceback && out.traceback.length > 0)
                                ? out.traceback.join('\n')
                                : `${out.ename || 'Error'}: ${out.evalue || 'Cell execution failed'}`;
                              const html = ansi.toHtml(rawError);
                              return (
                                <div
                                  key={oIdx}
                                  dangerouslySetInnerHTML={{ __html: html }}
                                  style={{
                                    margin: 0,
                                    fontFamily: 'var(--font-code)',
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--status-danger)',
                                    background: 'var(--status-danger-soft)',
                                    padding: 'var(--space-2) var(--space-3)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--status-danger-border)',
                                    whiteSpace: 'pre-wrap',
                                    overflowX: 'auto',
                                  }}
                                />
                              );
                            }

                            return null;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ResourceViewerFrame>
  );
};

export default JupyterViewer;