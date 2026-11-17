import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect } from 'react';

export interface GoogleResourceOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    googleResourceBlock: {
      insertGoogleResourceBlock: (options?: {
        fileId?: string;
        resourceType?: 'spreadsheet' | 'document' | 'form';
        title?: string;
      }) => ReturnType;
    };
  }
}

const GoogleResourceComponentView: React.FC<any> = (props) => {
  const { fileId = '', resourceType = 'spreadsheet', title = 'Google Workspace Resource' } = props.node.attrs;
  const [isEditing, setIsEditing] = useState(!fileId);
  const [inputUrl, setInputUrl] = useState(fileId);
  const [activeTab, setActiveTab] = useState<'embed' | 'table'>('embed');

  // Drive browser state
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [isBrowsingDrive, setIsBrowsingDrive] = useState(false);
  const [loadingDrive, setLoadingDrive] = useState(false);

  // Ingested table data state
  const [sheetRecords, setSheetRecords] = useState<any[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [loadingTable, setLoadingTable] = useState(false);

  // Extract ID from full URL if user pasted a link
  const parseGoogleUrl = (url: string) => {
    let extractedId = url.trim();
    let detectedType = resourceType;

    const sheetMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (sheetMatch) {
      extractedId = sheetMatch[1];
      detectedType = 'spreadsheet';
    }

    const docMatch = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (docMatch) {
      extractedId = docMatch[1];
      detectedType = 'document';
    }

    const formMatch = url.match(/\/forms\/d\/e\/([a-zA-Z0-9-_]+)/);
    if (formMatch) {
      extractedId = formMatch[1];
      detectedType = 'form';
    }

    return { id: extractedId, type: detectedType };
  };

  const handleApply = (idToUse?: string, typeToUse?: any, titleToUse?: string) => {
    const raw = idToUse || inputUrl;
    const { id, type } = parseGoogleUrl(raw);
    const finalType = typeToUse || type;
    const finalTitle =
      titleToUse || (finalType === 'spreadsheet' ? 'Google Sheet' : finalType === 'document' ? 'Google Doc' : 'Google Form');

    props.updateAttributes({
      fileId: id,
      resourceType: finalType,
      title: finalTitle,
    });
    setIsEditing(false);
    setIsBrowsingDrive(false);
  };

  const fetchDriveFiles = async () => {
    setIsBrowsingDrive(true);
    setLoadingDrive(true);
    try {
      const res = await fetch('/api/v1/vault/google-drive/files');
      if (res.ok) {
        const data = await res.json();
        setDriveFiles(data.files || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDrive(false);
    }
  };

  // If viewing tabular mode for spreadsheets, fetch parsed values
  useEffect(() => {
    if (activeTab === 'table' && fileId && resourceType === 'spreadsheet') {
      setLoadingTable(true);
      fetch(`/api/v1/google/sheets/values?id=${encodeURIComponent(fileId)}&range=A1:Z30`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          setSheetHeaders(data.headers || []);
          setSheetRecords(data.records || []);
        })
        .catch(() => {})
        .finally(() => setLoadingTable(false));
    }
  }, [activeTab, fileId, resourceType]);

  let embedUrl = '';
  let directUrl = '';
  let icon = '📊';

  if (resourceType === 'spreadsheet') {
    embedUrl = `https://docs.google.com/spreadsheets/d/${fileId}/htmlembed?widget=true&headers=false`;
    directUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    icon = '📗';
  } else if (resourceType === 'document') {
    embedUrl = `https://docs.google.com/document/d/${fileId}/preview`;
    directUrl = `https://docs.google.com/document/d/${fileId}/edit`;
    icon = '📘';
  } else {
    embedUrl = `https://docs.google.com/forms/d/e/${fileId}/viewform?embedded=true`;
    directUrl = `https://docs.google.com/forms/d/e/${fileId}/viewform`;
    icon = '📝';
  }

  return (
    <NodeViewWrapper className="google-resource-node" style={{ margin: '1.5rem 0' }}>
      <div
        contentEditable={false}
        style={{
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: '12px',
          background: 'rgba(8, 16, 26, 0.85)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px rgba(16, 185, 129, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* HEADER BAR */}
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(16, 185, 129, 0.1)',
            borderBottom: '1px solid rgba(16, 185, 129, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem' }}>{icon}</span>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>
                {title}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Google Workspace Integration {fileId ? `· ID: ${fileId.substring(0, 12)}...` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {resourceType === 'spreadsheet' && fileId && (
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                  onClick={() => setActiveTab('embed')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: activeTab === 'embed' ? 'var(--accent-emerald)' : 'transparent',
                    color: activeTab === 'embed' ? '#050810' : '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Iframe
                </button>
                <button
                  onClick={() => setActiveTab('table')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: activeTab === 'table' ? 'var(--accent-emerald)' : 'transparent',
                    color: activeTab === 'table' ? '#050810' : '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Data Table
                </button>
              </div>
            )}

            {fileId && (
              <a
                href={directUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: 'var(--accent-emerald)',
                  textDecoration: 'none',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                ↗ Open in Google
              </a>
            )}
            <button
              onClick={() => setIsEditing(!isEditing)}
              style={{
                background: isEditing ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.06)',
                color: isEditing ? '#050810' : '#fff',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isEditing ? 'Close' : '⚙️ Select File'}
            </button>
            <button
              onClick={() => props.deleteNode()}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* URL & DRIVE BROWSER ROW */}
        {isEditing && (
          <div style={{ padding: '12px 14px', background: 'rgba(0, 0, 0, 0.4)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                PASTE GOOGLE DOCS / SHEETS LINK OR BROWSE YOUR DRIVE:
              </label>
              <button
                onClick={fetchDriveFiles}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: 'var(--accent-emerald)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                📁 Browse My Google Drive
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  background: 'rgba(0, 0, 0, 0.6)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.85rem',
                }}
              />
              <button
                onClick={() => handleApply()}
                style={{
                  background: 'var(--accent-emerald)',
                  color: '#050810',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 16px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Embed
              </button>
            </div>

            {/* DRIVE FILES LIST */}
            {isBrowsingDrive && (
              <div
                style={{
                  marginTop: '10px',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  background: 'rgba(5, 10, 20, 0.95)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '8px',
                  padding: '6px',
                }}
              >
                {loadingDrive && <div style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading Drive files...</div>}
                {!loadingDrive && driveFiles.length === 0 && (
                  <div style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    No files found or Google Drive not connected. <a href="/api/v1/auth/google?drive=true" style={{ color: 'var(--accent-emerald)' }}>Connect Google Drive</a>
                  </div>
                )}
                {!loadingDrive &&
                  driveFiles.map((file) => {
                    const isSheet = file.mimeType?.includes('spreadsheet');
                    const isDoc = file.mimeType?.includes('document');
                    const type = isSheet ? 'spreadsheet' : isDoc ? 'document' : 'form';
                    return (
                      <div
                        key={file.id}
                        onClick={() => handleApply(file.id, type, file.name)}
                        style={{
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          color: '#fff',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{isSheet ? '📗' : '📘'}</span>
                          <span>{file.name}</span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isSheet ? 'Sheet' : 'Doc'}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* EMBEDDED VIEWPORT OR DATA TABLE */}
        {fileId ? (
          activeTab === 'embed' ? (
            <div style={{ position: 'relative', width: '100%', height: '440px', background: '#fff' }}>
              <iframe
                src={embedUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title={title}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            </div>
          ) : (
            <div style={{ padding: '14px', maxHeight: '440px', overflow: 'auto' }}>
              {loadingTable && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Loading sheet values...</div>}
              {!loadingTable && sheetHeaders.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--accent-emerald)', textAlign: 'left' }}>
                      {sheetHeaders.map((h) => (
                        <th key={h} style={{ padding: '6px 10px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetRecords.map((rec, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        {sheetHeaders.map((h) => (
                          <td key={h} style={{ padding: '6px 10px', color: '#fff' }}>{String(rec[h] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        ) : (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Paste a Google Docs or Sheets link above to embed interactive view.
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const GoogleResourceExtension = Node.create<GoogleResourceOptions>({
  name: 'googleResourceBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      fileId: { default: '' },
      resourceType: { default: 'spreadsheet' },
      title: { default: 'Google Workspace Resource' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-google-resource-block]',
        getAttrs: (element) => ({
          fileId: (element as HTMLElement).getAttribute('data-file-id') || '',
          resourceType: (element as HTMLElement).getAttribute('data-resource-type') || 'spreadsheet',
          title: (element as HTMLElement).getAttribute('data-title') || 'Google Workspace Resource',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-google-resource-block': true })];
  },

  addCommands() {
    return {
      insertGoogleResourceBlock:
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
    return ReactNodeViewRenderer(GoogleResourceComponentView);
  },
});
