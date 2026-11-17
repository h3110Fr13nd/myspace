import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import { renderDisplayMath, renderInlineMath } from '../../../lib/render/mathRenderer';
import { ReadToggle } from '../../ReadToggle';
import { CanvasViewer } from '../CanvasViewer';
import type { CanvasNode } from '../types';
import { resolveColor } from '../types';
import { resolveResourceType } from '../../../lib/registry/resourceRegistry';
import { renderResourceContent } from '../../../lib/viewer/renderResourceContent';
import { stripHtml } from '../../../lib/render/codeHighlighter';

function renderRichContent(content?: string): string {
  if (!content) return '';
  let processed = renderDisplayMath(content);
  processed = renderInlineMath(processed);
  return marked.parse(processed) as string;
}

interface Props {
  node: CanvasNode;
  currentUser?: string;
  isSelected?: boolean;
  onDoubleClick?: () => void;
  isEditMode?: boolean;
  depth?: number;
  lod?: 'full' | 'medium' | 'minimal';
}

/**
 * Universal Polymorphic Resource Node Card
 *
 * Hosts the authentic workspace components dynamically based on resource type,
 * mirroring ResourceContentRenderer.astro without ad-hoc stubs or duplicated code.
 */
export const ResourceNodeCard: React.FC<Props> = ({
  node,
  currentUser = 'user:anonymous',
  isSelected = false,
  onDoubleClick,
  isEditMode = false,
  depth = 0,
  lod = 'full',
}) => {
  const typeDef = resolveResourceType({
    type: node.resourceType,
    id: node.resourceId,
    file: node.file,
  });

  const nodeColor = resolveColor(node.color, typeDef.accentColor);

  const nodeTitle = stripHtml(
    node.resolvedTitle ||
    node.label ||
    node.file ||
    node.text?.split('\n')[0].replace(/^#+\s*/, '') ||
    node.id
  );

  const nodeSummary =
    node.resolvedSummary ||
    (node.text ? node.text.split('\n').slice(1).join('\n') : '');

  const isUltraCompact = node.height < 120;
  const isCompact = node.height < 210;

  // Determine if this is a viewer type that uses zero padding
  const isViewerType = ['canvas', 'pdf', 'image', 'google_doc', 'google_sheet', 'excalidraw', 'jupyter', 'mermaid'].includes(typeDef.type);

  // Background styling according to resource type
  const cardBackground = typeDef.type === 'canvas'
    ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(5, 8, 16, 0.98) 100%)'
    : typeDef.type === 'paper'
      ? 'linear-gradient(180deg, rgba(20, 24, 38, 0.98) 0%, rgba(13, 17, 27, 0.98) 100%)'
      : 'rgba(15, 23, 42, 0.95)';

  // Self-hydration: fetch enriched metadata when the canvas was loaded raw from disk
  // (resolvedMetadata is undefined/empty — no SSR enrichment happened)
  const hasDriveMeta = Boolean(
    node.resolvedMetadata?.googleSpreadsheetId ||
      node.resolvedMetadata?.googleDocId ||
      node.resolvedMetadata?.googleFileId ||
      node.resolvedMetadata?.googleUrl
  );
  const needsHydration =
    (typeDef.type === 'paper' && !node.resolvedMetadata?.paperDetails) ||
    (typeDef.category === 'cloud' && !hasDriveMeta);
  const [fetchedData, setFetchedData] = useState<any>(null);
  useEffect(() => {
    const targetId = node.resourceId || node.file;
    if (!needsHydration || !targetId) return;
    let isMounted = true;
    fetch(`/api/v1/resources/${encodeURIComponent(targetId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (isMounted) setFetchedData(data);
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [needsHydration, node.resourceId, node.file]);

  // Merge live-fetched data with node's static metadata
  const effectiveMeta = fetchedData
    ? {
        ...node.resolvedMetadata,
        ...(fetchedData.metadata || {}),
        ...(fetchedData.paperDetails ? { paperDetails: fetchedData.paperDetails } : {}),
        ...(fetchedData.renderedHtml ? { renderedHtml: fetchedData.renderedHtml } : {}),
      }
    : node.resolvedMetadata;

  // Prepare viewer props
  const viewerProps = {
    assetId: node.resourceId || node.file,
    resourceId: node.resourceId,
    diagramId: node.resourceId || node.file,
    notebookId: node.resourceId || node.file,
    sheetId: node.resourceId || node.file,
    formId: node.resourceId,
    canvasId: (node.resourceId || node.file || '').replace(/^canvas[:\/]/, '').replace(/^public_vault\/canvas\//, '').replace(/\.canvas$/, ''),
    type: node.resourceType,
    title: nodeTitle,
    initialCode: effectiveMeta?.chart || node.text,
    code: effectiveMeta?.chart || node.text,
    rawContent: effectiveMeta?.elements ? JSON.stringify(effectiveMeta) : (node.text || '{}'),
    rawJson: effectiveMeta?.cells ? JSON.stringify(effectiveMeta) : (node.text || '{}'),
    metadata: effectiveMeta,
    currentUser,
    isEmbedded: true,
    height: "100%",
    depth,
    lod,
  } as const;

  return (
    <div
      className="canvas-interactive-node canvas-resource-node"
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        padding: isViewerType ? '0' : isUltraCompact ? '6px 10px' : isCompact ? '10px 12px' : '14px 16px',
        borderRadius: isUltraCompact ? '8px' : '12px',
        background: cardBackground,
        border: `1.5px solid ${isSelected ? 'var(--accent-cyan)' : nodeColor}`,
        boxShadow: isSelected
          ? '0 0 24px rgba(0, 242, 254, 0.45)'
          : typeDef.type === 'canvas'
            ? '0 8px 32px rgba(0, 242, 254, 0.2)'
            : '0 4px 20px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(12px)',
        zIndex: 3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* MEDIUM LOD FAST-PATH: Bypasses KaTeX, iframes, and sub-canvas recursion */}
      {lod === 'medium' ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ fontSize: '1.1rem' }}>{typeDef.icon}</span>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: nodeColor, fontWeight: 700 }}>
                {typeDef.label}
              </span>
            </div>
            <h5 style={{ margin: '0 0 6px 0', color: '#fff', fontSize: '0.85rem', lineHeight: 1.3, fontWeight: 700 }}>
              {nodeTitle}
            </h5>
            {nodeSummary && (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {nodeSummary}
              </p>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Zoom in to interact ↗
          </div>
        </div>
      ) : typeDef.type === 'canvas' && (depth || 0) === 0 ? (
        <CanvasViewer
          canvasId={viewerProps.canvasId}
          initialData={effectiveMeta?.canvasData}
          currentUser={currentUser}
          isEmbedded={true}
          depth={(depth || 0) + 1}
        />
      ) : typeDef.type === 'canvas' ? (
        /* Sub-canvas at depth >= 1: render a clean preview card to prevent deep nested recursion */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.2rem' }}>🎨</span>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: nodeColor, fontWeight: 700 }}>
                Sub-Canvas
              </span>
            </div>
            <h5 style={{ margin: '0 0 6px 0', color: '#fff', fontSize: '0.9rem', lineHeight: 1.3, fontWeight: 700 }}>
              {nodeTitle}
            </h5>
            {nodeSummary && (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {nodeSummary}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {effectiveMeta?.canvasData?.nodes ? `${effectiveMeta.canvasData.nodes.length} nodes` : 'Nested Graph'}
            </span>
            <a
              href={`/studio/canvas/${encodeURIComponent(viewerProps.canvasId)}`}
              className="glass-button"
              style={{ padding: '3px 8px', fontSize: '0.72rem', color: 'var(--accent-cyan)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              Open Canvas ↗
            </a>
          </div>
        </div>
      ) : !isUltraCompact && ['pdf', 'image', 'sheet', 'form', 'google_doc', 'google_sheet', 'excalidraw', 'jupyter', 'mermaid'].includes(typeDef.type) ? (
        /* Embedded viewer components via shared renderResourceContent helper */
        (
          renderResourceContent(typeDef.type, viewerProps)
        )
      ) : (
        /* 7. RESEARCH PAPER, DOCUMENT, OR MARKDOWN NOTE COMPONENT */
        <>
          {/* Card Header: Type Badge + Integrated ReadToggle */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: isUltraCompact ? '2px' : isCompact ? '4px' : '8px',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                className={`ui-badge ${typeDef.type === 'paper' ? 'ui-badge--owner' : typeDef.type === 'pdf' ? 'ui-badge--danger' : 'ui-badge--info'}`}
                style={{
                  fontSize: isUltraCompact ? '0.58rem' : isCompact ? '0.62rem' : '0.66rem',
                  textTransform: 'uppercase',
                  padding: isUltraCompact ? '1px 5px' : undefined,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {typeDef.type === 'paper' ? '📜 Research Paper' : typeDef.type === 'pdf' ? '📕 PDF Asset' : `📄 ${node.resourceType || 'Document'}`}
              </span>

              {effectiveMeta?.paperDetails?.readingStage && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    background: 'rgba(99, 102, 241, 0.18)',
                    color: 'var(--accent-primary)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    textTransform: 'capitalize',
                  }}
                >
                  {effectiveMeta.paperDetails.readingStage}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {node.resourceId && (
                <ReadToggle
                  resourceId={node.resourceId}
                  currentUser={currentUser}
                  title={nodeTitle}
                  size="sm"
                />
              )}
            </div>
          </div>

          {/* SCROLLABLE INNER CONTENT AREA: Prevents Cropping, Guarantees Full Visibility */}
          <div
            className="canvas-node-scrollable"
            onWheel={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minHeight: isUltraCompact ? '24px' : '40px',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              paddingRight: '6px',
              marginRight: '-2px',
              marginBottom: isUltraCompact ? '2px' : '6px',
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)',
            }}
          >
            <h4
              style={{
                fontSize: isUltraCompact ? '0.8rem' : isCompact ? '0.88rem' : '0.98rem',
                fontWeight: 700,
                color: '#fff',
                margin: isUltraCompact ? '0' : '0 0 6px 0',
                lineHeight: 1.35,
                overflow: isUltraCompact ? 'hidden' : undefined,
                textOverflow: isUltraCompact ? 'ellipsis' : undefined,
                whiteSpace: isUltraCompact ? 'nowrap' : 'normal',
              }}
            >
              {nodeTitle}
            </h4>

            {/* Paper Metadata Chips */}
            {!isUltraCompact && typeDef.type === 'paper' && effectiveMeta?.paperDetails && (
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
                {effectiveMeta.paperDetails.year && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#f59e0b',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    📅 {effectiveMeta.paperDetails.year}
                  </span>
                )}
                {effectiveMeta.paperDetails.venue && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                    title={effectiveMeta.paperDetails.venue}
                  >
                    🏛️ {effectiveMeta.paperDetails.venue.length > 25 ? `${effectiveMeta.paperDetails.venue.slice(0, 25)}…` : effectiveMeta.paperDetails.venue}
                  </span>
                )}
                {effectiveMeta.paperDetails.citations !== undefined && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    ⭐ {effectiveMeta.paperDetails.citations} citations
                  </span>
                )}
                {effectiveMeta.paperDetails.openAccess && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: '#c084fc',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    🔓 Open Access
                  </span>
                )}
                {effectiveMeta.paperDetails.authors && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-secondary)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                    title={effectiveMeta.paperDetails.authors}
                  >
                    ✍️ {effectiveMeta.paperDetails.authors.length > 32 ? `${effectiveMeta.paperDetails.authors.slice(0, 32)}…` : effectiveMeta.paperDetails.authors}
                  </span>
                )}
              </div>
            )}

            {/* Subpath or Tag Chip */}
            {!isUltraCompact && node.subpath && (
              <div style={{ marginBottom: '6px' }}>
                <span
                  style={{
                    fontSize: '0.62rem',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10b981',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                  }}
                >
                  🏷️ {node.subpath}
                </span>
              </div>
            )}

            {/* Full Prose Markdown Content (Rendered with KaTeX, Shiki, and Transcluded Embeds) */}
            {!isUltraCompact && (
              <div
                className="prose-content"
                style={{
                  fontSize: isCompact ? '0.78rem' : '0.84rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                  wordBreak: 'break-word',
                }}
                dangerouslySetInnerHTML={{
                  __html:
                    effectiveMeta?.renderedHtml ||
                    renderRichContent(nodeSummary || node.text || ''),
                }}
              />
            )}
          </div>

          {/* Bottom Action Footer (1-Click Drill-Down Links) */}
          {(node.resourceId || node.url || node.file) && (
            <div
              style={{
                borderTop: isUltraCompact ? 'none' : '1px solid var(--border-glass)',
                paddingTop: isUltraCompact ? '2px' : '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              {node.resourceId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <a
                    href={`/?doc=${encodeURIComponent(node.resourceId)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: 'var(--accent-primary)',
                      fontSize: isUltraCompact ? '0.68rem' : '0.74rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    {typeDef.type === 'paper' ? 'Read Paper Notes →' : 'Open Full View →'}
                  </a>
                  {effectiveMeta?.paperDetails?.pdfAssetId && (
                    <a
                      href={`/?doc=${encodeURIComponent(effectiveMeta.paperDetails.pdfAssetId)}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: 'var(--accent-cyan)',
                        fontSize: '0.7rem',
                        textDecoration: 'none',
                        fontWeight: 600,
                      }}
                    >
                      📕 PDF
                    </a>
                  )}
                </div>
              ) : node.file ? (
                <a
                  href={`/?doc=${encodeURIComponent(node.file)}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    color: 'var(--accent-primary)',
                    fontSize: isUltraCompact ? '0.68rem' : '0.74rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  View File →
                </a>
              ) : node.url ? (
                <a
                  href={node.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-cyan)', fontSize: isUltraCompact ? '0.68rem' : '0.74rem', textDecoration: 'none' }}
                >
                  Visit Link ↗
                </a>
              ) : null}

              {node.resourceId && !isUltraCompact && (
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                  <code>{node.resourceId.slice(0, 22)}</code>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
