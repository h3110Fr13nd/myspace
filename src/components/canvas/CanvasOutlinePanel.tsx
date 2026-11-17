import React, { useCallback, useMemo, useState } from 'react';

import type { CanvasNode } from './types';
import {
  buildOutline,
  flattenOutline,
  isGroup,
  isStructural,
  membershipOf,
  type OutlineNode,
} from './core/grouping';

/**
 * The group tree, as a panel.
 *
 * This is the surface that answers "is this parent or inferred?" without the
 * user having to infer anything: membership is drawn as nesting, so the thing
 * the model stores is the thing on screen.
 *
 * Deliberately presentational. The tree comes from `buildOutline` (pure, in the
 * core, unit tested without a DOM) and every mutation is a callback, so this
 * file holds no grouping logic and could be reused by a command palette or an
 * export view without dragging any of this along.
 */

export interface OutlinePanelProps {
  nodes: CanvasNode[];
  selectedNodeIds: ReadonlySet<string>;
  /** True when the board is editable; the panel is read-only in the viewer. */
  editable?: boolean;
  onSelect: (ids: string[]) => void;
  onMove: (ids: string[], parentId: string | null) => void;
  onToggleMembership?: (groupId: string, membership: 'spatial' | 'structural') => void;
  onFocusNode?: (nodeId: string) => void;
  onCopySubtree?: (groupId: string) => void;
}

const TYPE_GLYPH: Record<string, string> = {
  group: '🗂️',
  text: '📝',
  resource: '🔗',
  file: '📄',
  link: '🔗',
};

function labelFor(node: CanvasNode): string {
  return node.label || node.resolvedTitle || node.resourceId || node.id;
}

export const CanvasOutlinePanel: React.FC<OutlinePanelProps> = ({
  nodes,
  selectedNodeIds,
  editable = true,
  onSelect,
  onMove,
  onToggleMembership,
  onFocusNode,
  onCopySubtree,
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Id currently under the drag, and the id it is hovering. Kept as state rather
   * than CSS so the drop indicator can state *what will happen* ("move into X")
   * rather than only tinting a row.
   */
  /**
   * The dragged id lives in a ref, with state only for the dimming.
   *
   * `dragover` fires before React has necessarily re-rendered, so reading the
   * dragged id from state makes `canDropOn` see `null` and refuse the drop. The
   * ref is authoritative for the drag handlers; the state is cosmetic and is
   * allowed to lag.
   */
  const dragIdRef = React.useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<{ groupId: string | null } | null>(null);

  const outline = useMemo(() => buildOutline(nodes), [nodes]);
  const rows = useMemo(() => flattenOutline(outline, collapsed), [outline, collapsed]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const endDrag = useCallback(() => {
    dragIdRef.current = null;
    setDragId(null);
    setDropOn(null);
  }, []);

  /** Commit a drop, or refuse it with a reason the user can act on. */
  const commitDrop = useCallback(
    (targetGroupId: string | null) => {
      const dragging = dragIdRef.current;
      if (!dragging) return;
      // A group cannot be dropped into its own subtree; the core would refuse it
      // anyway, but refusing here means the row never highlights in the first
      // place, so the user is not offered an action that cannot happen.
      onMove([dragging], targetGroupId);
      endDrag();
    },
    [onMove, endDrag]
  );

  const canDropOn = useCallback(
    (groupId: string | null): boolean => {
      const dragging = dragIdRef.current;
      if (!dragging) return false;
      if (!groupId) return true; // the root strip
      if (groupId === dragging) return false;
      // Walk up from the candidate: if the dragged node is an ancestor of it,
      // the move would create a cycle.
      const byId = new Map(nodes.map((n) => [n.id, n]));
      let cursor: string | undefined = groupId;
      while (cursor) {
        if (cursor === dragging) return false;
        cursor = byId.get(cursor)?.parentId;
      }
      return true;
    },
    [nodes]
  );

  if (nodes.length === 0) {
    return (
      <div className="canvas-outline" style={emptyStyle}>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Nothing on this board yet.
        </p>
      </div>
    );
  }

  return (
    <div className="canvas-outline" data-canvas-outline="true" style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          OUTLINE
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {nodes.length} item{nodes.length === 1 ? '' : 's'}
        </span>
      </div>

      <div
        /**
         * The root strip. Dropping here unparents, which is the one reparent
         * that has no menu equivalent worth the click count — "Top level" is
         * buried in a submenu, whereas dropping at the top of the list is where
         * the eye already is.
         */
        onDragOver={(e) => {
          if (!canDropOn(null)) return;
          e.preventDefault();
          setDropOn({ groupId: null });
        }}
        onDragLeave={() => setDropOn((d) => (d?.groupId === null ? null : d))}
        onDrop={(e) => {
          e.preventDefault();
          commitDrop(null);
        }}
        style={{
          ...rootStripStyle,
          outline: dropOn?.groupId === null ? '2px dashed var(--accent-cyan)' : '2px dashed transparent',
        }}
      >
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Top level</span>
      </div>

      <div style={listStyle}>
        {rows.map((row) => {
          const group = isGroup(row.node);
          const structural = isStructural(row.node);
          const isSelected = selectedNodeIds.has(row.id);
          const outside = row.outsideChildIds.length;
          const isDropTarget = dropOn?.groupId === row.id && canDropOn(row.id);
          return (
            <div
              key={row.id}
              draggable={editable}
              onDragStart={(e) => {
                if (!editable) return;
                dragIdRef.current = row.id;
                setDragId(row.id);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox refuses to start a drag with no payload.
                e.dataTransfer.setData('text/plain', row.id);
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!group || !canDropOn(row.id)) return;
                e.preventDefault();
                e.stopPropagation();
                setDropOn({ groupId: row.id });
              }}
              onDragLeave={() => setDropOn((d) => (d?.groupId === row.id ? null : d))}
              onDrop={(e) => {
                if (!group) return;
                e.preventDefault();
                e.stopPropagation();
                commitDrop(row.id);
              }}
              onClick={() => onSelect(group ? [row.id] : [row.id])}
              onDoubleClick={() => onFocusNode?.(row.id)}
              data-outline-id={row.id}
              data-outline-depth={row.depth}
              title={
                group
                  ? `${row.node.label ?? 'Group'} — ${row.containedCount} inside` +
                    (outside ? `, ${outside} outside the frame` : '') +
                    (structural ? ' — structural' : '')
                  : undefined
              }
              style={{
                ...rowStyle,
                paddingLeft: 6 + row.depth * 14,
                background: isSelected ? 'rgba(0, 242, 254, 0.14)' : 'transparent',
                borderLeft: isSelected
                  ? '2px solid var(--accent-cyan)'
                  : '2px solid transparent',
                boxShadow: isDropTarget ? 'inset 0 0 0 1.5px var(--accent-cyan)' : undefined,
                opacity: dragId && dragId !== row.id ? 0.55 : 1,
                cursor: editable ? (group ? 'grab' : 'pointer') : 'pointer',
              }}
            >
              {group ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(row.id);
                  }}
                  aria-label={collapsed.has(row.id) ? `Expand ${row.node.label}` : `Collapse ${row.node.label}`}
                  style={{
                    ...twistyStyle,
                    transform: collapsed.has(row.id) ? 'rotate(0deg)' : 'rotate(90deg)',
                  }}
                >
                  ▸
                </button>
              ) : (
                <span style={{ width: 16, flexShrink: 0 }} />
              )}

              <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>
                {TYPE_GLYPH[row.node.type] ?? '•'}
              </span>

              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.76rem',
                  color: group ? 'var(--text-primary, #f8fafc)' : 'var(--text-secondary)',
                  fontWeight: group ? 600 : 400,
                }}
              >
                {labelFor(row.node)}
              </span>

              {group && structural && (
                <span title="Structural: members are kept even when outside the frame" style={badgeStyle}>
                  🧱
                </span>
              )}

              {outside > 0 && (
                <span
                  title={`${outside} member${outside === 1 ? '' : 's'} outside this group’s frame`}
                  style={{ ...badgeStyle, color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.5)' }}
                >
                  ↗{outside}
                </span>
              )}

              {group && row.containedCount > 0 && (
                <span style={countStyle}>{row.containedCount}</span>
              )}

              {group && onToggleMembership && editable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMembership(row.id, membershipOf(row.node) === 'structural' ? 'spatial' : 'structural');
                  }}
                  title={
                    membershipOf(row.node) === 'structural'
                      ? 'Switch to a contained frame'
                      : 'Switch to a structural folder'
                  }
                  style={iconButtonStyle}
                >
                  {membershipOf(row.node) === 'structural' ? '🧱' : '🖼️'}
                </button>
              )}

              {group && onCopySubtree && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopySubtree(row.id);
                  }}
                  title="Copy this group and everything under it as JSON"
                  style={iconButtonStyle}
                >
                  ⧉
                </button>
              )}
            </div>
          );
        })}
      </div>

      {dropOn && dragId && (
        <div style={hintStyle}>
          {dropOn.groupId === null
            ? 'Drop to move to the top level'
            : `Drop to move into ${labelFor(
                nodes.find((n) => n.id === dropOn.groupId) as CanvasNode
              )}`}
        </div>
      )}
    </div>
  );
};

// --- styles -----------------------------------------------------------------
// Local rather than in global.css: these are layout details of one panel, and
// keeping them here means the component is droppable into any board without a
// stylesheet dependency. Colours are still tokens, never literals.

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  /**
   * Claims the leftover column rather than declaring a height.
   *
   * `height: 100%` looked equivalent and was not: as a flex item the default
   * `flex-shrink: 1` let it be squeezed to fit whatever else shares the column,
   * so the tree collapsed to two or three rows in a panel that still looked
   * present. Taking the remainder explicitly is what keeps it scrollable.
   */
  flex: 1,
  minHeight: 0,
  fontSize: '0.76rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '2px 2px 6px',
  color: 'var(--text-muted)',
};

const rootStripStyle: React.CSSProperties = {
  margin: '0 0 4px',
  padding: '5px 8px',
  borderRadius: '6px',
  transition: 'outline-color 0.12s ease',
};

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  /**
   * A floor, so the tree is never squeezed to a couple of rows by a tall
   * sibling. Scrolling within the list is the intended behaviour; a list with
   * no room to scroll is just a broken panel.
   */
  minWidth: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '3px 6px',
  borderRadius: '6px',
  minHeight: '24px',
  userSelect: 'none',
  transition: 'background 0.1s ease, box-shadow 0.1s ease, opacity 0.1s ease',
};

const emptyStyle: React.CSSProperties = {
  padding: '12px 4px',
};

const twistyStyle: React.CSSProperties = {
  width: 16,
  flexShrink: 0,
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.7rem',
  transition: 'transform 0.12s ease',
};

const countStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  color: 'var(--text-muted)',
  background: 'rgba(148, 163, 184, 0.16)',
  borderRadius: '6px',
  padding: '0 5px',
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  padding: '0 4px',
  borderRadius: '6px',
  border: '1px solid var(--border-glass)',
  flexShrink: 0,
};

const iconButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  fontSize: '0.7rem',
  opacity: 0.65,
  flexShrink: 0,
};

const hintStyle: React.CSSProperties = {
  marginTop: '4px',
  padding: '4px 8px',
  fontSize: '0.68rem',
  color: 'var(--accent-cyan)',
  borderTop: '1px solid var(--border-glass)',
};
