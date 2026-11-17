import React, { useMemo, useState } from 'react';
import type { JsonCanvasSpec, CanvasNode, CanvasEdge, CanvasPortSide, CanvasColorCode } from './types';
import { COLOR_MAP } from './types';
import { EdgeRenderer } from './EdgeRenderer';
import { CanvasToolbar } from './CanvasToolbar';
import { NodeRenderer } from './nodes/NodeRenderer';
import { ResourcePickerModal } from './ResourcePickerModal';
import { CanvasJsonEditorModal } from './CanvasJsonEditorModal';
import { CanvasContextMenu } from './CanvasContextMenu';
import { CanvasOutlinePanel } from './CanvasOutlinePanel';
import { subtreeOf } from './core/grouping';
import { buildCanvasContextMenuItems } from './useCanvasContextMenu';
import { CanvasBoardShell } from './CanvasBoardShell';
import { useCanvasEditor, type UseCanvasEditorReturn } from './useCanvasEditor';
import { useViewport } from './core/useViewport';
import { useCanvasGestures, type WheelBehavior } from './core/useCanvasGestures';
import { showToast } from '../ui';
import { EdgeEndpointLayer } from './core/EdgeEndpointLayer';
import { NodePortLayer } from './core/NodePortLayer';

interface CanvasEditorProps {
  canvasId: string;
  initialData?: JsonCanvasSpec;
  currentUser?: string;
  /**
   * Set by the host when the canvas could not be resolved at all.
   *
   * A board with no nodes and no explanation is indistinguishable from a board
   * that failed to load, so the editor says which one it is instead of leaving
   * the user staring at empty space.
   */
  loadError?: string | null;
}

export interface EditorOverlayProps {
  /** Supplied by the shell, which owns the viewport transform. */
  onFitNode?: (node: CanvasNode) => void;
  editor: UseCanvasEditorReturn;
  zoom: number;
  /**
   * What an unmodified wheel does, so the gesture reference can state the
   * current behaviour instead of a hardcoded claim that goes stale the moment
   * the preference is changed.
   */
  wheelBehavior: WheelBehavior;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-glass)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '0.85rem',
  boxSizing: 'border-box',
};

const ColorPalette: React.FC<{ selectedColor?: string; onSelect: (c: CanvasColorCode) => void }> = ({ selectedColor, onSelect }) => (
  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
    {(['1', '2', '3', '4', '5', '6'] as const).map((code) => (
      <div
        key={code}
        onClick={() => onSelect(code)}
        title={`Apply color #${code}`}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: COLOR_MAP[code],
          cursor: 'pointer',
          border: selectedColor === code ? '2px solid #fff' : '2px solid transparent',
          transition: 'transform 0.1s ease',
        }}
      />
    ))}
  </div>
);

export const EditorOverlay: React.FC<EditorOverlayProps> = ({ editor, zoom, wheelBehavior, onFitNode }) => {
  const onFitNodeRef = React.useRef(onFitNode);
  React.useEffect(() => {
    onFitNodeRef.current = onFitNode;
  }, [onFitNode]);
  const {
    nodes, setNodes, edges, setEdges, title,
    selectedNodeIds, singleSelectedNode, singleSelectedEdge,
    handleGroupSelected, handleUngroupSelected, handleFitGroupToContents,
    handleBulkColorChange, deleteSelected, pushHistory,
    editingNode, setEditingNode, editTextValue, setEditTextValue, handleApplyTextEdit,
    isPickerOpen, setIsPickerOpen, handleSelectResource,
    isJsonModalOpen, setIsJsonModalOpen, handleApplyJson,
  } = editor;

  /**
   * Outline vs Inspector, as two tabs in the existing 320px sidebar.
   *
   * Not a new panel and not a new column: the sidebar already existed, and the
   * outline is a view of the same document the inspector describes, so a tab is
   * the honest amount of chrome. The outline is also reachable by keyboard
   * (`O`), so it does not depend on finding a tab.
   */
  /**
   * Defaults to Inspector so the sidebar still shows the board overview on load,
   * which is what it did before the outline existed. The outline is one click
   * (or `O`) away and is a tab rather than a new column, so nothing is lost by
   * not making it the landing view.
   */
  const [sideTab, setSideTab] = useState<'outline' | 'inspector'>('inspector');

  /**
   * `O` toggles the outline from anywhere on the board.
   *
   * Driven by a DOM event rather than lifted state because the tab is purely
   * presentational and the key handler lives in the editor hook, which has no
   * business knowing about sidebar chrome. A custom event keeps that boundary
   * without threading a ref through three layers for one keystroke.
   */
  React.useEffect(() => {
    const onToggle = () => setSideTab((t) => (t === 'outline' ? 'inspector' : 'outline'));
    window.addEventListener('canvas:toggle-outline', onToggle);
    return () => window.removeEventListener('canvas:toggle-outline', onToggle);
  }, []);

  /**
   * Bring one node into view. The outline's "focus" affordance is only honest
   * if it actually moves the board, so this centres the node rather than
   * selecting it and leaving the viewport somewhere else entirely.
   */
  const handleFitNode = (node: CanvasNode) => {
    onFitNodeRef.current?.(node);
  };

  const tabButton = (id: 'outline' | 'inspector', label: string) => (
    <button
      onClick={() => setSideTab(id)}
      aria-pressed={sideTab === id}
      data-side-tab={id}
      style={{
        flex: 1,
        fontSize: '0.74rem',
        fontWeight: sideTab === id ? 700 : 500,
        padding: '5px 6px',
        borderRadius: '7px',
        cursor: 'pointer',
        background: sideTab === id ? 'var(--accent-cyan)' : 'transparent',
        color: sideTab === id ? '#04121a' : 'var(--text-secondary)',
        border: `1px solid ${sideTab === id ? 'var(--accent-cyan)' : 'var(--border-glass)'}`,
      }}
    >
      {label}
    </button>
  );

  /**
   * Board-level facts: counts, zoom, and the shortcut reference.
   *
   * Rendered by whichever tab is showing while nothing is selected, because
   * it describes the board rather than a selection. Hiding it behind the
   * Inspector when the Outline became the default tab would have made the
   * shortcut reference undiscoverable.
   */
  const boardOverview = selectedNodeIds.size === 0 && !singleSelectedEdge ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <div>
            <strong>Board Stats:</strong>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <li>Nodes: {nodes.length}</li>
              <li>Groups: {nodes.filter((n) => n.type === 'group').length}</li>
              <li>Edges: {edges.length}</li>
              <li>Zoom: {Math.round(zoom * 100)}%</li>
            </ul>
          </div>
          <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '10px' }}>
            <strong>Navigation & Gestures:</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Space + Drag</span><span>Hand Pan</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Right-Drag</span><span>Instant Pan anywhere</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Scroll / 2-finger</span><span>{wheelBehavior === 'zoom' ? 'Zoom in / out' : 'Pan canvas view'}</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Shift + Scroll</span><span>Pan horizontally only</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Ctrl + Scroll</span><span>Smooth zoom in/out</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Pinch</span><span>Zoom about the gesture centre</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>V / H</span><span>Select mode / Pan mode</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Shift + Drag</span><span>Marquee drag-select</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Ctrl + G</span><span>Group selected nodes</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Ctrl+Shift+G</span><span>Ungroup selected</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Del / Bksp</span><span>Delete selected</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>Ctrl + Z / Y</span><span>Undo / Redo</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '10px 0 0 0' }}>
              Scroll behaviour is set in the toolbar: {wheelBehavior === 'zoom' ? 'scroll zooms' : 'scroll pans'}. Ctrl+Scroll zooms either way.
            </p>
          </div>
        </div>
  ) : null;
  return (
    <>
      {/**
       * The drop hint. Rendered at the pointer rather than on the group so it
       * reads as an action about *this gesture*, and suppressed entirely when
       * there is no target so the canvas stays quiet (a non-clutter rule from
       * the design doc rather than an oversight).
       */}
      {editor.dropTargetGroupId && (
        <div
          data-canvas-drop-hint="true"
          style={{
            position: 'fixed',
            left: 16,
            bottom: 16,
            zIndex: 999998,
            pointerEvents: 'none',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1.5px solid var(--accent-cyan)',
            borderRadius: '10px',
            padding: '8px 14px',
            color: '#fff',
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
          }}
        >
          <span>📂</span>
          <span>
            Drop into{' '}
            <strong>{editor.groupIndex.get(editor.dropTargetGroupId)?.label ?? 'group'}</strong>
          </span>
        </div>
      )}

      <div
        className="custom-scrollbar"
        style={{
          width: '320px',
          background: 'rgba(15, 23, 42, 0.96)',
          borderLeft: '1px solid var(--border-glass)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
          zIndex: 10,
          /**
           * A definite height, so `flex: 1` on the tab body resolves against
           * something. Without it the card sized to its content, the outline
           * inherited that, and the list collapsed to a couple of rows — which
           * is how most of the tree ended up scrolled out of sight in a panel
           * that looked present but was unusable.
           */
          height: '100%',
          minHeight: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '4px' }}>
          {tabButton('outline', 'Outline')}
          {tabButton('inspector', 'Inspector')}
        </div>

        {sideTab === 'outline' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CanvasOutlinePanel
              nodes={nodes}
              selectedNodeIds={selectedNodeIds}
              onSelect={(ids) => editor.setSelectedNodeIds(new Set(ids))}
              onMove={(ids, parentId) => {
                const result = editor.handleMoveToGroup(ids, parentId);
                if (!result.ok) {
                  showToast(
                    result.reason === 'cycle'
                      ? 'A group cannot be moved inside itself'
                      : 'That group no longer exists',
                    { tone: 'danger' }
                  );
                }
              }}
              onToggleMembership={(groupId, membership) => editor.handleSetMembership(groupId, membership)}
              onFocusNode={(nodeId) => {
                editor.setSelectedNodeIds(new Set([nodeId]));
                // Bring the node into view so "focus" means what it says.
                const node = nodes.find((n) => n.id === nodeId);
                if (node) handleFitNode(node);
              }}
              onCopySubtree={(groupId) => {
                const sub = subtreeOf(nodes, groupId, edges);
                navigator.clipboard
                  ?.writeText(JSON.stringify({ nodes: sub.nodes, edges: sub.edges }, null, 2))
                  .then(() => showToast(`Copied ${sub.nodes.length} item(s) as JSON`))
                  .catch(() => showToast('Clipboard is not available here', { tone: 'warn' }));
              }}
            />
          </div>
        ) : (
        <>
        <div style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '10px' }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#fff', fontWeight: 800 }}>
            {selectedNodeIds.size > 1 ? `Multi-Selection (${selectedNodeIds.size})` : singleSelectedNode ? `${singleSelectedNode.type.toUpperCase()} Node` : singleSelectedEdge ? 'Edge Inspector' : 'Board Overview'}
          </h4>
        </div>

        {selectedNodeIds.size > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(0, 242, 254, 0.08)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
              <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 700 }}>{selectedNodeIds.size} Nodes Selected</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Drag any selected node to move all together (20px snap).</div>
            </div>
            <button onClick={handleGroupSelected} className="btn btn-warning btn-sm" style={{ width: '100%', fontSize: '0.82rem' }}>Group Selected (Ctrl+G)</button>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Change Color (All Selected)</label>
              <ColorPalette onSelect={handleBulkColorChange} />
            </div>
            <button onClick={deleteSelected} className="btn btn-danger btn-sm" style={{ width: '100%', fontSize: '0.8rem', marginTop: '8px' }}>Delete Selected ({selectedNodeIds.size} Nodes)</button>
          </div>
        )}

        {singleSelectedNode && selectedNodeIds.size === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Node ID & Type</label>
              <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600, marginTop: '2px' }}><code>{singleSelectedNode.id}</code> ({singleSelectedNode.type})</div>
            </div>

            {singleSelectedNode.type === 'text' && (
              <button onClick={() => { setEditingNode(singleSelectedNode); setEditTextValue(singleSelectedNode.text || ''); }} className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: '0.8rem' }}>
                Edit Markdown & Math
              </button>
            )}

            {singleSelectedNode.type === 'group' && (
              <>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Group Label</label>
                  <input type="text" value={singleSelectedNode.label || ''} onChange={(e) => { const val = e.target.value; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, label: val } : n))); }} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Background Image URL</label>
                  <input type="text" placeholder="https:... or banner.png" value={singleSelectedNode.background || ''} onChange={(e) => { const val = e.target.value; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, background: val || undefined } : n))); }} style={inputStyle} />
                </div>
                {singleSelectedNode.background && (
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Background Style</label>
                    <select value={singleSelectedNode.backgroundStyle || 'cover'} onChange={(e) => { const val = e.target.value as any; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, backgroundStyle: val } : n))); }} style={{ ...inputStyle, background: 'rgba(15, 23, 42, 0.95)' }}>
                      <option value="cover">Cover (Fill & Crop)</option>
                      <option value="ratio">Ratio (Contain)</option>
                      <option value="repeat">Repeat (Pattern)</option>
                      <option value="fill">Fill (Stretch 100%)</option>
                    </select>
                  </div>
                )}
                {/**
                 * Child membership, stated as a two-way choice with the
                 * consequence spelled out, because the difference is not
                 * guessable: switching to Contained immediately releases any
                 * member sitting outside the frame.
                 */}
                <div
                  style={{
                    background: 'rgba(148, 163, 184, 0.08)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginTop: '4px',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Children
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(['spatial', 'structural'] as const).map((mode) => {
                      const active = (singleSelectedNode.membership ?? 'spatial') === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => editor.handleSetMembership(singleSelectedNode.id, mode)}
                          aria-pressed={active}
                          title={
                            mode === 'spatial'
                              ? 'A visual frame: it resizes to its contents and releases anything dragged outside it'
                              : 'A folder that holds: children stay members even when they sit outside the frame'
                          }
                          style={{
                            flex: 1,
                            fontSize: '0.74rem',
                            padding: '5px 4px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: active ? 700 : 500,
                            background: active ? 'var(--accent-cyan)' : 'transparent',
                            color: active ? '#04121a' : 'var(--text-secondary)',
                            border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-glass)'}`,
                          }}
                        >
                          {mode === 'spatial' ? '🖼️ Contained' : '🧱 Structural'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.4 }}>
                    {singleSelectedNode.membership === 'structural'
                      ? 'Members are kept by an explicit link, so they travel with the group and survive being dragged far away. Marked ↗ when outside.'
                      : 'The frame resizes to hug its members, and a member dragged clear is released. A plain visual container.'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <button onClick={() => handleFitGroupToContents(singleSelectedNode.id)} className="btn btn-secondary btn-sm" style={{ fontSize: '0.78rem' }}>Fit Group to Contents</button>
                  <button onClick={() => editor.handleSelectGroupMembers(singleSelectedNode.id)} className="btn btn-secondary btn-sm" style={{ fontSize: '0.78rem' }}>
                    Select All Members ({editor.groupIndex.childIds(singleSelectedNode.id).length})
                  </button>
                  <button onClick={() => editor.handleDrillInto(singleSelectedNode.id)} className="btn btn-secondary btn-sm" style={{ fontSize: '0.78rem' }}>Enter Group (Enter)</button>
                  <button onClick={handleUngroupSelected} className="btn btn-secondary btn-sm" style={{ fontSize: '0.78rem' }}>Ungroup (Keep Items)</button>
                </div>
              </>
            )}

            {singleSelectedNode.type === 'resource' && (
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Linked Resource</label>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', fontWeight: 600, marginTop: '2px' }}>{singleSelectedNode.resolvedTitle || singleSelectedNode.resourceId}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Type: <span className="ui-badge ui-badge--info">{singleSelectedNode.resourceType}</span></div>
              </div>
            )}

            {singleSelectedNode.type === 'link' && (
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>URL</label>
                <input type="text" value={singleSelectedNode.url || ''} onChange={(e) => { const val = e.target.value; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, url: val } : n))); }} style={inputStyle} />
              </div>
            )}

            {singleSelectedNode.type === 'file' && (
              <>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>File Path</label>
                  <input type="text" value={singleSelectedNode.file || ''} onChange={(e) => { const val = e.target.value; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, file: val } : n))); }} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Subpath (Heading/Block)</label>
                  <input type="text" placeholder="e.g. #Heading or ^blockid" value={singleSelectedNode.subpath || ''} onChange={(e) => { const val = e.target.value; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, subpath: val } : n))); }} style={inputStyle} />
                </div>
              </>
            )}

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Color Accent</label>
              <ColorPalette selectedColor={singleSelectedNode.color} onSelect={(code) => { const updated = nodes.map((n) => (n.id === singleSelectedNode.id ? { ...n, color: code } : n)); setNodes(updated); pushHistory(updated, edges); }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Width (px)</label>
                <input type="number" value={singleSelectedNode.width} step="20" onChange={(e) => { const val = parseInt(e.target.value) || 200; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, width: val } : n))); }} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Height (px)</label>
                <input type="number" value={singleSelectedNode.height} step="20" onChange={(e) => { const val = parseInt(e.target.value) || 120; setNodes((prev) => prev.map((n) => (n.id === singleSelectedNode.id ? { ...n, height: val } : n))); }} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <button onClick={deleteSelected} className="btn btn-danger btn-sm" style={{ width: '100%', fontSize: '0.8rem' }}>Delete Node</button>
            </div>
          </div>
        )}

        {singleSelectedEdge && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Semantic Relation Label</label>
              <input type="text" value={singleSelectedEdge.label || ''} placeholder="e.g. extends, benchmarks with" onChange={(e) => { const val = e.target.value; setEdges((prev) => prev.map((ed) => (ed.id === singleSelectedEdge.id ? { ...ed, label: val } : ed))); }} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Edge Color</label>
              <ColorPalette selectedColor={singleSelectedEdge.color} onSelect={(code) => { const updated = edges.map((ed) => (ed.id === singleSelectedEdge.id ? { ...ed, color: code } : ed)); setEdges(updated); pushHistory(nodes, updated); }} />
            </div>
            <div style={{ marginTop: '12px' }}>
              <button onClick={deleteSelected} className="btn btn-danger btn-sm" style={{ width: '100%', fontSize: '0.8rem' }}>Delete Edge</button>
            </div>
          </div>
        )}

        {boardOverview}
        </>
        )}
      </div>

      {editingNode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999999, background: 'rgba(5, 8, 16, 0.85)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setEditingNode(null)}>
          <div className="ui-card" style={{ width: '100%', maxWidth: '640px', background: 'rgba(15, 23, 42, 0.98)', padding: '20px', borderRadius: '16px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: '1.1rem' }}>Edit Node Content</h3>
            <textarea value={editTextValue} onChange={(e) => setEditTextValue(e.target.value)} rows={8} style={{ width: '100%', padding: '12px', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid var(--border-glass)', borderRadius: '8px', color: '#fff', fontFamily: 'monospace', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button onClick={() => setEditingNode(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleApplyTextEdit} className="btn btn-primary btn-sm">Apply Changes</button>
            </div>
          </div>
        </div>
      )}

      <CanvasJsonEditorModal isOpen={isJsonModalOpen} onClose={() => setIsJsonModalOpen(false)} nodes={nodes} edges={edges} title={title} onApply={handleApplyJson} />
      <ResourcePickerModal isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} onSelect={handleSelectResource} />
    </>
  );
};

export const CanvasEditor: React.FC<CanvasEditorProps> = ({
  canvasId,
  initialData,
  currentUser = 'anonymous',
  loadError = null,
}) => {
  const [activeMode, setActiveMode] = useState<'select' | 'pan'>('select');
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * Pan and zoom live in the shared core. The gesture layer writes CSS custom
   * properties straight to the board element, so a drag never re-renders the
   * node tree; `viewport.transform` is only a frame-synced mirror that this
   * component reads for hit math, the toolbar readout and edge geometry.
   */
  const viewport = useViewport({ initial: { x: 40, y: 40, k: 0.85 } });

  const gestures = useCanvasGestures({
    viewport,
    mode: activeMode,
  });

  const { x: panX, y: panY, k: zoom } = viewport.transform;
  const pan = useMemo(() => ({ x: panX, y: panY }), [panX, panY]);

  /**
   * Hand the board element to the core so that every coordinate conversion
   * (`toWorld`, hit testing, connection targets) and the native wheel/touch
   * listeners are anchored to it. `useCanvasEditor` reads the same ref object,
   * so there is exactly one source of truth for where the board lives.
   */
  const boardRef = viewport.viewportRef;

  const handleZoomIn = () => viewport.zoomIn();
  const handleZoomOut = () => viewport.zoomOut();
  const handleResetZoom = () => viewport.reset();

  const editor = useCanvasEditor({
    canvasId,
    initialData,
    currentUser,
    board: {
      viewportRef: boardRef,
      transform: viewport.transform,
      zoom,
      pan,
      isSpacePressed: gestures.isSpacePressed,
      activeMode,
      setActiveMode,
      isFullscreen,
      onExitFullscreen: () => setIsFullscreen(false),
      // Right/middle/space-drag pans are owned by the gesture controller, which
      // is the same component that handles wheel and touch. Delegating here
      // keeps one pan implementation instead of two that can disagree.
      startPan: (e) => gestures.beginPan(e),
      didPanWithRightClickRef: gestures.didPanRef,
    },
  });

  const handleFitToBounds = () => viewport.fitTo({ x: editor.bounds.minX, y: editor.bounds.minY, width: editor.bounds.width, height: editor.bounds.height });

  const handleFitNode = (node: CanvasNode) => {
    viewport.fitTo({
      x: node.x - 200,
      y: node.y - 200,
      width: node.width + 400,
      height: node.height + 400,
    });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.canvas-interactive-node') || target.closest('.canvas-port-handle') || target.closest('.canvas-edge-endpoint')) return;
    // Stepped zoom anchored on the cursor: past 120% a double-click zooms back
    // out, otherwise it steps in. Matches the behaviour of the major tools.
    const nextK = zoom >= 1.2 ? 0.85 : Math.min(zoom * 1.5, 2.2);
    viewport.zoomTo(nextK, { x: e.clientX, y: e.clientY });
  };

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a href={`/?doc=${encodeURIComponent(canvasId)}`} style={{ textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
          Exit Studio
        </a>
        <div style={{ width: '1px', height: '18px', background: 'var(--border-glass)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="text"
            value={editor.title}
            onChange={(e) => editor.setTitle(e.target.value)}
            style={{ background: 'transparent', border: '1px solid transparent', borderRadius: '6px', color: '#fff', fontWeight: 700, fontSize: '1.1rem', padding: '2px 6px', outline: 'none' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent-cyan)')}
            onBlur={(e) => (e.target.style.borderColor = 'transparent')}
          />
        </div>
        {editor.saveStatus && <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>{editor.saveStatus}</span>}
      </div>

      <CanvasToolbar
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onFitToBounds={handleFitToBounds}
        isStudio={true}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.handleUndo}
        onRedo={editor.handleRedo}
        onSave={editor.handleSave}
        isSaving={editor.isSaving}
        onAddText={editor.handleAddText}
        onOpenResourcePicker={() => editor.setIsPickerOpen(true)}
        onAddGroup={editor.handleAddGroup}
        onGroupSelected={editor.handleGroupSelected}
        selectedCount={editor.selectedNodeIds.size}
        onExportObsidian={editor.handleExportObsidian}
        onAutoLayout={editor.handleAutoLayout}
        onOpenJsonEditor={() => editor.setIsJsonModalOpen(true)}
        activeMode={activeMode}
        onToggleMode={(mode) => setActiveMode(mode)}
        wheelBehavior={gestures.prefs.wheel}
        onWheelBehaviorChange={gestures.setWheelBehavior}
        isModal={isFullscreen}
        onToggleModal={() => setIsFullscreen(!isFullscreen)}
      />
    </div>
  );

  const contextMenu = editor.contextMenu && (
    <CanvasContextMenu
      x={editor.contextMenu.x}
      y={editor.contextMenu.y}
      onClose={() => editor.setContextMenu(null)}
      items={buildCanvasContextMenuItems({
        state: editor.contextMenu,
        selectedNodeIds: editor.selectedNodeIds,
        selectedEdgeIds: editor.selectedEdgeIds,
        nodes: editor.nodes,
        edges: editor.edges,
        isStudio: true,
        onAddTextAt: editor.handleAddTextAt,
        onAddGroupAt: editor.handleAddGroupAt,
        onOpenResourcePicker: () => editor.setIsPickerOpen(true),
        onEditNodeText: (node) => { editor.setEditingNode(node); editor.setEditTextValue(node.text || ''); },
        onFitGroupToContents: editor.handleFitGroupToContents,
        onGroupSelected: editor.handleGroupSelected,
        onUngroupSelected: editor.handleUngroupSelected,
        /**
         * Manual assignment. A refusal is surfaced rather than swallowed:
         * "you cannot put a group inside itself" is feedback, not a bug, and
         * silently doing nothing is how the old geometry path failed.
         */
        onMoveToGroup: (ids, parentId) => {
          const result = editor.handleMoveToGroup(ids, parentId);
          if (result.ok) {
            showToast(
              parentId
                ? `Moved ${ids.length} item${ids.length === 1 ? '' : 's'} into the group`
                : `Removed ${ids.length} item${ids.length === 1 ? '' : 's'} from their group`
            );
            return;
          }
          showToast(
            result.reason === 'cycle'
              ? 'Cannot move a group into itself or one of its own subgroups'
              : 'That group no longer exists',
            { tone: 'danger' }
          );
        },
        onSetMembership: (groupId, membership) => {
          editor.handleSetMembership(groupId, membership);
          showToast(
            membership === 'structural'
              ? 'Group is now structural — children stay put, even outside the frame'
              : 'Group is now a contained frame — it releases children it does not surround'
          );
        },
        onSelectGroupMembers: editor.handleSelectGroupMembers,
        onDrillInto: editor.handleDrillInto,
        assignableGroups: editor.handleAssignableGroups([...(editor.selectedNodeIds)]),
        parentLabelOf: (nodeId) => {
          const parentId = editor.groupIndex.get(nodeId)?.parentId;
          if (!parentId) return null;
          const parent = editor.groupIndex.get(parentId);
          return parent ? (parent.label ?? parent.id) : null;
        },
        onDuplicateSelected: editor.handleDuplicateSelected,
        onDeleteSelected: editor.deleteSelected,
        onChangeColor: editor.handleContextMenuColorChange,
        onSelectAll: () => editor.setSelectedNodeIds(new Set(editor.nodes.map((n) => n.id))),
        onFitToBounds: handleFitToBounds,
        onResetZoom: handleResetZoom,
        onAutoLayout: editor.handleAutoLayout,
        onOpenJsonEditor: () => editor.setIsJsonModalOpen(true),
        onExportObsidian: editor.handleExportObsidian,
      })}
    />
  );

  /**
   * Edges render in screen space, behind the node layer, so the canvas is
   * viewport-sized and strokes stay a constant width at any zoom.
   */
  const edgeLayer = (
    <EdgeRenderer
      edges={editor.edges}
      nodes={editor.nodes}
      transform={viewport.transform}
      size={viewport.size}
      selectedEdgeId={editor.singleSelectedEdge?.id}
      onEdgeClick={editor.handleEdgeClick}
      onEdgeContextMenu={editor.handleEdgeContextMenu}
      draftEdge={editor.draftEdge}
    />
  );

  /**
   * Endpoint handles for the selected edge. They are the affordance that makes
   * "unlink and relink" discoverable: drag one away to detach it, drop it on a
   * node to re-attach. Sized in inverse-zoom units so they stay grabbable at
   * any zoom.
   */
  const endpointLayer = (
    <EdgeEndpointLayer
      edges={editor.edges}
      nodes={editor.nodes}
      selectedEdgeIds={editor.selectedEdgeIds}
      activeEdgeId={editor.activeEdgeEnd?.edgeId ?? null}
      inv={1 / Math.max(zoom, 0.01)}
      onPointerDown={editor.startEdgeEndDrag}
      onContextMenu={(edgeId, end, e) => editor.handleEdgeContextMenu(edgeId, e)}
    />
  );

  const transformLayerContent = (
    <>
      {endpointLayer}

      {editor.nodes.map((node) => {
        const isSelected = editor.selectedNodeIds.has(node.id);
        const isSingleSelected = isSelected && editor.selectedNodeIds.size === 1;
        /**
         * From the `parentId` index, not from a geometric scan. Two reasons: the
         * old expression was O(N) per group on every frame of every drag (D9),
         * and it counted a different set than the group actually moved, which is
         * what made the badge and the drag disagree (D2).
         */
        const containedCount =
          node.type === 'group' ? editor.groupIndex.containedIds(node.id).length : undefined;

        return (
          <div
            key={node.id}
            style={{
              position: 'absolute',
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.width}px`,
              height: `${node.height}px`,
              zIndex: node.type === 'group' ? 1 : 3,
              cursor: editor.isDraggingNodes ? 'grabbing' : 'grab',
              // A drop target is ringed rather than recoloured, so the
              // affordance is legible over any group background image and does
              // not fight the dashed frame for attention.
              boxShadow:
                editor.dropTargetGroupId === node.id
                  ? '0 0 0 3px var(--accent-cyan), 0 0 28px rgba(0, 242, 254, 0.45)'
                  : undefined,
              transition: 'box-shadow 0.12s ease',
            }}
            onPointerDown={(e) => editor.handleNodePointerDown(node.id, e)}
            onClick={(e) => editor.handleNodeClick(node.id, e)}
            onContextMenu={(e) => editor.handleNodeContextMenu(node.id, e)}
            onPointerEnter={() => editor.setHoveredNodeId(node.id)}
            onPointerLeave={() => editor.setHoveredNodeId(null)}
            data-canvas-node-id={node.id}
            data-drop-target={editor.connectionTargetNodeId === node.id ? 'true' : undefined}
            data-group-drop-target={editor.dropTargetGroupId === node.id ? 'true' : undefined}
          >
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <NodeRenderer
                node={{ ...node, x: 0, y: 0 }}
                currentUser={currentUser}
                isSelected={isSelected}
                containedCount={containedCount}
                outsideCount={
                  node.type === 'group'
                    ? editor.groupIndex.childIds(node.id).length -
                      editor.groupIndex.containedIds(node.id).length
                    : 0
                }
                onGroupPointerDown={(e) => editor.handleNodePointerDown(node.id, e)}
                onGroupClick={(e) => editor.handleNodeClick(node.id, e)}
                onDoubleClick={() => {
                  if (node.type === 'text') {
                    editor.setEditingNode(node);
                    editor.setEditTextValue(node.text || '');
                  } else if (node.type === 'group') {
                    // Double-click descends, so the next click reaches the
                    // group's own children rather than the group again.
                    editor.handleDrillInto(node.id);
                  }
                }}
                isEditMode={true}
              />

              {isSingleSelected && (
                <div
                  onPointerDown={(e) => editor.startNodeResize(node.id, e)}
                  title="Drag to resize node"
                  style={{
                    position: 'absolute',
                    right: '-6px',
                    bottom: '-6px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '3px',
                    background: 'var(--accent-cyan)',
                    cursor: 'nwse-resize',
                    zIndex: 10,
                    boxShadow: '0 0 8px rgba(0, 242, 254, 0.6)',
                  }}
                />
              )}

              <NodePortLayer
                node={node}
                inv={1 / Math.max(zoom, 0.01)}
                isSelected={isSelected}
                isHovered={editor.hoveredNodeId === node.id}
                isConnecting={Boolean(editor.draftEdge)}
                snappedPort={
                  editor.connectionTargetNodeId === node.id ? editor.connectionTargetSide : null
                }
                onPortPointerDown={editor.startPortConnect}
              />
            </div>
          </div>
        );
      })}

      {editor.marquee && (
        <div
          className="canvas-marquee"
          style={{
            left: editor.marquee.x,
            top: editor.marquee.y,
            width: editor.marquee.width,
            height: editor.marquee.height,
          }}
        />
      )}
    </>
  );

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
        <CanvasBoardShell
          mode="edit"
          width={editor.bounds.width}
          height={editor.bounds.height}
          transform={viewport.transform}
          onTransform={(t) => viewport.set(t)}
          isPanning={gestures.isPanning || viewport.isInteracting}
          isSpacePressed={gestures.isSpacePressed}
          isFullscreen={isFullscreen}
          onCloseFullscreen={() => setIsFullscreen(false)}
          viewportRef={boardRef}
          onViewportMounted={viewport.setViewportEl}
          edgeLayer={edgeLayer}
          toolbar={toolbar}
          contextMenu={contextMenu}
          selection={{ nodeIds: editor.selectedNodeIds, edgeIds: editor.selectedEdgeIds }}
          onPointerDown={editor.handleBoardPointerDown}
          onDoubleClick={handleDoubleClick}
          onContextMenu={editor.handleBoardContextMenu}
          activeMode={activeMode}
          onModeChange={setActiveMode}
          emptyState={
            editor.nodes.length === 0 ? (
              <div className="canvas-empty-state">
                <p className="canvas-empty-state__title">
                  {loadError ?? 'This canvas is empty'}
                </p>
                <p className="canvas-empty-state__hint">
                  {loadError
                    ? 'Nothing was loaded, so there is nothing to edit yet.'
                    : 'Add a note, a group, or an existing resource from the toolbar above.'}
                </p>
              </div>
            ) : null
          }
        >
          {/* No wrapper element: the transform layer is pointer-transparent and
              only its direct children opt back in, so a full-size wrapper
              would sit over the edge hit paths and make edges unselectable. */}
          {transformLayerContent}
        </CanvasBoardShell>
      </div>
      <EditorOverlay
        editor={editor}
        zoom={zoom}
        wheelBehavior={gestures.prefs.wheel}
        onFitNode={handleFitNode}
      />
    </div>
  );
};