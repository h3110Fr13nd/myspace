import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { JsonCanvasSpec, CanvasNode, CanvasEdge, CanvasPortSide, CanvasColorCode } from './types';
import { getAnchor, computeBoundingBox } from './types';
import { DEFAULT_EDGE_LABEL, HISTORY_LIMIT } from './core/constants';
import { useHistory, type HistoryTag } from './core/useHistory';
import { useConnection, type ConnectionResult } from './core/useConnection';
import { usePointerInteraction } from './core/usePointerInteraction';
import { autoLayout } from './core/autoLayout';
import { NodeIndex } from './core/spatialIndex';
import { resolveEdgeEnd } from './core/routing';
import {
  GROUP_PADDING,
  GROUPING_VERSION,
  GroupIndex,
  edgesForNodes,
  enforceInvariants,
  enforceMembershipPolicy,
  groupNodes,
  isMigrated,
  isGroup,
  membershipOf,
  normalise,
  reparent,
  resolveDropTarget,
  topLevelUnits,
  ungroup,
} from './core/grouping';
import type { Rect } from './core/transform';
import type { PickedResource } from './ResourcePickerModal';
import type { ContextMenuState } from './useCanvasContextMenu';
import { showToast } from '../ui';
import { stripHtml } from '../../lib/render/codeHighlighter';

/**
 * Board children that own their pointer press. Both the shell and this hook
 * must consult the same list, otherwise a click on one of them is swallowed by
 * the board and starts a marquee instead of the interaction it advertises.
 */
const OWNED_POINTER_SELECTOR = '.canvas-interactive-node, .canvas-port-handle, .canvas-edge-endpoint';

export interface CanvasBoardRefProps {
  viewportRef?: any;
  viewportElement?: HTMLDivElement | null;
  transform?: { x: number; y: number; k: number };
  zoom?: number;
  pan?: { x: number; y: number };
  setZoom?: React.Dispatch<React.SetStateAction<number>> | ((z: number | ((prev: number) => number)) => void);
  setPan?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>> | ((p: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void);
  isSpacePressed?: boolean;
  activeMode?: 'select' | 'pan';
  setActiveMode?: (mode: 'select' | 'pan') => void;
  isFullscreen?: boolean;
  onExitFullscreen?: () => void;
  startPan?: (e: React.MouseEvent | React.PointerEvent) => void;
  handlePointerDown?: (e: React.PointerEvent) => boolean;
  didPanWithRightClickRef?: React.MutableRefObject<boolean>;
  handleFitToBounds?: () => void;
  handleResetZoom?: () => void;
}

export interface UseCanvasEditorOptions {
  canvasId: string;
  initialData?: JsonCanvasSpec;
  currentUser?: string;
  board: CanvasBoardRefProps;
}

export interface UseCanvasEditorReturn {
  nodes: CanvasNode[];
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  edges: CanvasEdge[];
  setEdges: React.Dispatch<React.SetStateAction<CanvasEdge[]>>;
  title: string;
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedEdgeIds: Set<string>;
  setSelectedEdgeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  singleSelectedNode: CanvasNode | null;
  singleSelectedEdge: CanvasEdge | null;
  historyIndex: number;
  historyLength: number;
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  pushHistory: (newNodes: CanvasNode[], newEdges: CanvasEdge[]) => void;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  isSaving: boolean;
  saveStatus: string | null;
  handleSave: () => Promise<void>;
  handleExportObsidian: () => void;
  clientToCanvasCoord: (clientX: number, clientY: number) => { x: number; y: number };
  marquee: Rect | null;
  isDraggingNodes: boolean;
  resizingNodeId: string | null;
  draftEdge: { fromNode: string; fromSide: CanvasPortSide; currentX: number; currentY: number } | null;
  /** Node currently under a connection drag, highlighted as the drop target. */
  connectionTargetNodeId: string | null;
  /** Port the draft would snap to, if any. */
  connectionTargetSide: CanvasPortSide | null;
  /** Edge endpoint currently being re-pointed. */
  activeEdgeEnd: { edgeId: string; end: 'from' | 'to' } | null;
  hoveredNodeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
  /** Begin re-pointing an existing edge endpoint. */
  startEdgeEndDrag: (edgeId: string, end: 'from' | 'to', e: React.MouseEvent | React.PointerEvent) => void;
  /** Move the in-flight connection to a pointer position. */
  updateConnection: (clientX: number, clientY: number) => void;
  /** Commit the in-flight connection at a pointer position. */
  finishConnection: (clientX: number, clientY: number) => void;
  /** Abort the in-flight connection, leaving the document untouched. */
  cancelConnection: () => void;
  /** Unlink one endpoint, keeping the rest of the edge. */
  detachEdgeEnd: (edgeId: string, end: 'from' | 'to') => void;
  /** Remove an edge entirely. */
  deleteEdge: (edgeId: string) => void;
  editingNode: CanvasNode | null;
  setEditingNode: (node: CanvasNode | null) => void;
  editTextValue: string;
  setEditTextValue: (val: string) => void;
  handleApplyTextEdit: () => void;
  isPickerOpen: boolean;
  setIsPickerOpen: (open: boolean) => void;
  handleSelectResource: (item: PickedResource) => void;
  isJsonModalOpen: boolean;
  setIsJsonModalOpen: (open: boolean) => void;
  handleApplyJson: (newNodes: CanvasNode[], newEdges: CanvasEdge[], newTitle?: string) => void;
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  handleAddText: () => void;
  handleAddTextAt: (x: number, y: number) => void;
  handleAddGroup: () => void;
  handleAddGroupAt: (x: number, y: number) => void;
  handleGroupSelected: () => void;
  handleUngroupSelected: () => void;
  handleFitGroupToContents: (groupId: string) => void;
  /** The `parentId` tree for the current document. One instance per commit. */
  groupIndex: GroupIndex;
  handleMoveToGroup: (
    ids: string[],
    parentId: string | null
  ) => { ok: boolean; reason?: 'cycle' | 'unknown-parent' };
  handleSetMembership: (groupId: string, membership: 'spatial' | 'structural') => void;
  handleAssignableGroups: (ids: string[]) => { id: string; label: string; depth: number }[];
  handleSelectGroupMembers: (groupId: string) => void;
  selectionForClick: (nodeId: string) => Set<string>;
  drillPath: string[];
  activeGroupId: string | null;
  /** Group a drag would drop into, for the on-canvas hint. */
  dropTargetGroupId: string | null;
  handleDrillInto: (groupId: string) => void;
  handleDrillOut: () => void;
  handleResetDrill: () => void;
  handleDuplicateSelected: () => void;
  deleteSelected: () => void;
  handleBulkColorChange: (code: CanvasColorCode) => void;
  handleContextMenuColorChange: (color: CanvasColorCode) => void;
  handleAutoLayout: () => void;
  startNodeDrag: (nodeId: string, e: React.MouseEvent, targetSelectedIds?: Set<string>) => void;
  startNodeResize: (nodeId: string, e: React.MouseEvent) => void;
  startPortConnect: (nodeId: string, side: CanvasPortSide, e: React.MouseEvent | React.PointerEvent) => void;
  handleNodePointerDown: (nodeId: string, e: React.PointerEvent) => void;
  handleNodeClick: (nodeId: string, e: React.MouseEvent) => void;
  handleNodeContextMenu: (nodeId: string, e: React.MouseEvent) => void;
  handleEdgeClick: (edgeId: string, e?: React.MouseEvent) => void;
  handleEdgeContextMenu: (edgeId: string, e: React.MouseEvent) => void;
  handleBoardPointerDown: (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => void;
  handleBoardContextMenu: (e: React.MouseEvent) => void;
}

export function useCanvasEditor({
  canvasId,
  initialData,
  board,
}: UseCanvasEditorOptions): UseCanvasEditorReturn {
  /**
   * The document as it enters the editor, normalised once and shared.
   *
   * A document handed in as a prop has bypassed the fetch path, so without this
   * it would be the one way to reach the editor with membership that no consumer
   * reads. It is computed once into a ref rather than inline in `useState`
   * because the history has to be seeded from the *same* value: seeding it from
   * the raw prop left the first undo restoring an un-normalised document, which
   * is how a group could snap back to pre-migration geometry.
   */
  const seedRef = useRef<CanvasNode[] | null>(null);
  if (seedRef.current === null) {
    seedRef.current = enforceInvariants(
      normalise(initialData?.nodes ?? [], { alreadyHasParentId: isMigrated(initialData) }).nodes
    );
  }
  const [nodes, setNodes] = useState<CanvasNode[]>(seedRef.current);
  const [edges, setEdges] = useState<CanvasEdge[]>(initialData?.edges || []);
  const [title, setTitle] = useState(
    initialData?.title || canvasId.replace(/^canvas:/, '').replace(/[-_]/g, ' ')
  );

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  /**
   * Gesture flags the host still needs for rendering. The interaction itself is
   * owned by `core/usePointerInteraction`; these only mirror whether one is
   * running so the board can show a grabbing cursor.
   */
  const [isDraggingNodes, setIsDraggingNodes] = useState(false);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  /** True once a press became a drag, so the click that follows is ignored. */
  const didDragRef = useRef(false);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  /**
   * Fullscreen is owned by the editor, but the board shell and the Escape
   * handler both need it, and a keypress must not be swallowed by a stale
   * closure. These refs keep Escape authoritative even mid-gesture.
   */
  const isFullscreenRef = useRef(false);
  const exitFullscreenRef = useRef<(() => void) | null>(null);
  isFullscreenRef.current = board.isFullscreen ?? false;
  exitFullscreenRef.current = board.onExitFullscreen ?? null;

  const [editingNode, setEditingNode] = useState<CanvasNode | null>(null);
  const [editTextValue, setEditTextValue] = useState('');

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /**
   * Mirrors of the live document, so `commit` and the node handlers can read the
   * current value without being listed as dependencies. Without these, every
   * handler that commits would be rebuilt on every frame of a drag, which would
   * re-render the whole board mid-drag.
   *
   * `commit` also assigns them directly, so two commits in the same tick both
   * see the first one's result rather than the pre-commit state.
   */
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const edgesRef = useRef<CanvasEdge[]>(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  /**
   * Undo/redo lives in the shared core so coalescing, the depth cap and the
   * cursor all behave the same for every surface. The previous inline version
   * had no coalescing at all, so every intermediate frame of a drag became its
   * own undo step, and `pushHistory` was rebuilt on each push because it closed
   * over the history state.
   */
  const history = useHistory(
    // Seeded from the normalised document, not the raw prop, so undo returns the
    // same starting state the board is actually showing.
    { nodes: seedRef.current ?? [], edges: initialData?.edges ?? [] },
    HISTORY_LIMIT
  );
  const pushHistory = useCallback(
    (newNodes: CanvasNode[], newEdges: CanvasEdge[], tag: HistoryTag = 'structural') => {
      history.push({ nodes: newNodes, edges: newEdges }, tag);
    },
    [history]
  );

  const applySnapshot = useCallback((snapshot: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
  }, []);

  /**
   * The core history owns the cursor and hands back the snapshot it lands on;
   * applying it to the live document stays here, because that is the one part
   * that is genuinely host-specific.
   */
  const handleUndo = useCallback(() => applySnapshot(history.undo()), [applySnapshot, history]);
  const handleRedo = useCallback(() => applySnapshot(history.redo()), [applySnapshot, history]);

  // -------------------------------------------------------------------------
  // The group tree, and the one place nodes are written
  // -------------------------------------------------------------------------

  /**
   * Built once per commit rather than per query. Every membership question —
   * badge count, click-to-select, fit-to-contents, layout, the outline — reads
   * this, so they cannot disagree with each other or with what is stored.
   *
   * Previously each of those call sites re-derived membership from geometry,
   * which is what let the badge report a different count from the drag set.
   */
  const groupIndex = useMemo(() => new GroupIndex(nodes), [nodes]);

  /**
   * The single write path for nodes.
   *
   * Every mutation goes through here so the document can never hold a state the
   * rest of the app would have to defend against: no cycles, no self-parent, no
   * dangling `parentId`, no empty or single-child group, spatial groups
   * re-fitted, and children that escaped a spatial frame released. Handlers
   * describe the *intent* (a reparent, a group, a delete) and this applies the
   * invariants, so no call site can forget a rule.
   *
   * `edges` follows the nodes so a group removed by an invariant takes its edges
   * with it instead of leaving endpoints pointing at nothing.
   */
  const commit = useCallback(
    (
      next: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[]),
      nextEdges?: CanvasEdge[],
      tag: HistoryTag = 'structural'
    ) => {
      const draft = typeof next === 'function' ? next(nodesRef.current) : next;
      const released = enforceMembershipPolicy(draft);
      const finalNodes = enforceInvariants(released.nodes);
      const removed = new Set(
        draft.filter((d) => !finalNodes.some((f) => f.id === d.id)).map((d) => d.id)
      );
      const finalEdges =
        nextEdges ?? (removed.size > 0 ? edgesForNodes(edgesRef.current, removed) : edgesRef.current);
      nodesRef.current = finalNodes;
      edgesRef.current = finalEdges;
      setNodes(finalNodes);
      setEdges(finalEdges);
      pushHistory(finalNodes, finalEdges, tag);
    },
    [pushHistory]
  );

  useEffect(() => {
    if (initialData) return;
    let isMounted = true;
    async function loadCanvas() {
      try {
        const cleanId = canvasId.replace(/^canvas:/, '');
        const res = await fetch(`/api/v1/resources/canvas/${encodeURIComponent(cleanId)}`);
        if (res.ok) {
          const data: JsonCanvasSpec = await res.json();
          if (isMounted) {
            /**
             * Normalised on the way in, so a document authored before the
             * `parentId` migration — or hand-edited in the JSON modal after it —
             * acquires stated membership instead of relying on geometry that the
             * rest of the app no longer consults.
             */
            const loadedNodes = enforceInvariants(
              normalise(data.nodes || [], { alreadyHasParentId: isMigrated(data) }).nodes
            );
            const loadedEdges = data.edges || [];
            nodesRef.current = loadedNodes;
            edgesRef.current = loadedEdges;
            setNodes(loadedNodes);
            setEdges(loadedEdges);
            if (data.title) setTitle(data.title);
            // Server content replaces the document wholesale, so the history
            // has to restart from it rather than accumulate the fetch as a step.
            history.reset({ nodes: loadedNodes, edges: loadedEdges });
          }
        }
      } catch (err) {
        console.warn('Failed to load canvas:', err);
      }
    }
    loadCanvas();
    return () => {
      isMounted = false;
    };
  }, [canvasId, initialData]);

  const bounds = useMemo(() => {
    if (nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 1600, maxY: 1000, width: 1600, height: 1000 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });

    return {
      minX,
      minY,
      maxX: maxX + 180,
      maxY: maxY + 180,
      width: Math.max(maxX - minX + 360, 1600),
      height: Math.max(maxY - minY + 360, 1000),
    };
  }, [nodes]);

  /** Last known pointer position in world space. See `clientToCanvasCoord`. */
  const lastPointerWorldRef = useRef({ x: 0, y: 0 });

  /**
   * Mirrors of the selection, so the drag-end callback can read it without
   * being re-registered (and without capturing a stale snapshot mid-gesture).
   */
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  const clientToCanvasCoord = useCallback(
    (clientX: number, clientY: number) => {
      const el = board.viewportElement || board.viewportRef?.current;
      const rect = el
        ? el.getBoundingClientRect()
        : { left: 0, top: 0 };
      const currentZoom = board.zoom ?? board.transform?.k ?? 1;
      const currentPanX = board.pan?.x ?? board.transform?.x ?? 0;
      const currentPanY = board.pan?.y ?? board.transform?.y ?? 0;
      const world = {
        x: (clientX - rect.left - currentPanX) / currentZoom,
        y: (clientY - rect.top - currentPanY) / currentZoom,
      };
      // Every pointer interaction funnels through here, so this is the one place
      // that can know where the pointer is in world space without a second
      // listener. Keyboard shortcuts that need a spatial target (reparent into
      // the group under the cursor) read it from here.
      lastPointerWorldRef.current = world;
      return world;
    },
    [board.viewportElement, board.viewportRef, board.zoom, board.transform, board.pan]
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus('Saving changes...');
    try {
      const cleanId = canvasId.replace(/^canvas:/, '');
      const res = await fetch(`/api/v1/resources/canvas/${encodeURIComponent(cleanId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          nodes,
          edges,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to save canvas');
      }

      setSaveStatus('Saved successfully');
      showToast('Canvas saved successfully!', { tone: 'success' });
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message}`);
      showToast(`Failed to save canvas: ${err.message}`, { tone: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }, [canvasId, title, nodes, edges]);

  const handleExportObsidian = useCallback(() => {
    const data = {
      title,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.round(n.width),
        height: Math.round(n.height),
        color: n.color || undefined,
        text: n.text || undefined,
        file: n.file || undefined,
        subpath: n.subpath || undefined,
        url: n.url || undefined,
        label: n.label || undefined,
        background: n.background || undefined,
        backgroundStyle: n.backgroundStyle || undefined,
        resourceId: n.resourceId || undefined,
        resourceType: n.resourceType || undefined,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        fromNode: e.fromNode,
        fromSide: e.fromSide || undefined,
        fromEnd: e.fromEnd || undefined,
        toNode: e.toNode,
        toSide: e.toSide || undefined,
        toEnd: e.toEnd || undefined,
        label: e.label || undefined,
        color: e.color || undefined,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${canvasId.replace(/^canvas:/, '')}.canvas`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [canvasId, title, nodes, edges]);

  /**
   * Delete the selection, edges included.
   *
   * Deleting a group releases its children to the grandparent first, rather than
   * deleting the children along with it. Deleting the container and its
   * contents in one keystroke is a real footgun on a board where a group is a
   * folder holding work, and it is not what "delete the group" reads as. A group
   * left empty by the release is then removed by the invariant pass, so the
   * end state is the same when the group had nothing worth keeping.
   */
  const deleteSelected = useCallback(() => {
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    let next = nodes;
    for (const id of selectedNodeIds) {
      if (!isGroup(groupIndex.get(id) ?? { type: 'group' })) continue;
      const result = ungroup(next, id);
      next = result.nodes;
    }

    const removedIds = new Set(selectedNodeIds);
    const updatedNodes = next.filter((n) => !removedIds.has(n.id));
    const updatedEdges = edges.filter(
      (e) =>
        !selectedEdgeIds.has(e.id) &&
        !removedIds.has(e.fromNode) &&
        !removedIds.has(e.toNode)
    );
    commit(updatedNodes, updatedEdges);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
  }, [nodes, edges, selectedNodeIds, selectedEdgeIds, groupIndex, commit]);

  const handleAddText = useCallback(() => {
    const centerCoord = clientToCanvasCoord(window.innerWidth / 2 - 150, window.innerHeight / 2 - 100);
    const newNode: CanvasNode = {
      id: `text_${Date.now()}`,
      type: 'text',
      x: Math.round(centerCoord.x / 20) * 20,
      y: Math.round(centerCoord.y / 20) * 20,
      width: 320,
      height: 180,
      color: '5',
      text: '# New Note\nEnter markdown or LaTeX math here.\n$E = mc^2$',
    };
    commit([...nodes, newNode]);
    setSelectedNodeIds(new Set([newNode.id]));
    setSelectedEdgeIds(new Set());
  }, [nodes, clientToCanvasCoord, commit]);

  const handleAddTextAt = useCallback(
    (x: number, y: number) => {
      const newNode: CanvasNode = {
        id: `text_${Date.now()}`,
        type: 'text',
        x: Math.round(x / 20) * 20,
        y: Math.round(y / 20) * 20,
        width: 320,
        height: 180,
        color: '5',
        text: '# New Note\nEnter markdown or LaTeX math here.',
      };
      commit([...nodes, newNode]);
      setSelectedNodeIds(new Set([newNode.id]));
      setSelectedEdgeIds(new Set());
    },
    [nodes, commit]
  );

  const handleAddGroup = useCallback(() => {
    const centerCoord = clientToCanvasCoord(window.innerWidth / 2 - 250, window.innerHeight / 2 - 180);
    const newGroup: CanvasNode = {
      id: `group_${Date.now()}`,
      type: 'group',
      x: Math.round(centerCoord.x / 20) * 20,
      y: Math.round(centerCoord.y / 20) * 20,
      width: 520,
      height: 380,
      label: 'New Category Container',
      color: '2',
    };
    commit([newGroup, ...nodes]);
    setSelectedNodeIds(new Set([newGroup.id]));
    setSelectedEdgeIds(new Set());
  }, [nodes, clientToCanvasCoord, commit]);

  const handleAddGroupAt = useCallback(
    (x: number, y: number) => {
      const newGroup: CanvasNode = {
        id: `group_${Date.now()}`,
        type: 'group',
        x: Math.round(x / 20) * 20,
        y: Math.round(y / 20) * 20,
        width: 520,
        height: 380,
        label: 'New Category Container',
        color: '2',
      };
      commit([newGroup, ...nodes]);
      setSelectedNodeIds(new Set([newGroup.id]));
      setSelectedEdgeIds(new Set());
    },
    [nodes, edges, pushHistory]
  );

  /**
   * Group the current selection.
   *
   * Delegated to `groupNodes`, which sets `parentId` on each member. The
   * previous version only inserted a group node and relied on geometry to imply
   * membership, which is precisely the coupling Phase 1 removes: a member
   * nudged outside the frame silently stopped being a member while the badge
   * still counted it.
   *
   * Selecting a group together with some of its own members would nest the
   * group inside itself, so members of a selected group are excluded and the
   * selection collapses to whole top-level units.
   */
  const handleGroupSelected = useCallback(() => {
    const units = topLevelUnits(groupIndex, selectedNodeIds);
    const selected = nodes.filter((n) => units.has(n.id) && n.type !== 'group');
    if (selected.length < 2) {
      handleAddGroup();
      return;
    }
    const { nodes: updated, group } = groupNodes(nodes, selected.map((n) => n.id), {
      id: `group_${Date.now()}`,
      label: 'Group',
      color: '2',
    });
    commit(updated);
    setSelectedNodeIds(new Set([group.id]));
    setSelectedEdgeIds(new Set());
  }, [nodes, selectedNodeIds, groupIndex, handleAddGroup, commit]);

  /**
   * Dissolve the selected groups, keeping their children.
   *
   * The previous version deleted the group node outright, which left every
   * child pointing at a `parentId` that no longer existed — a dangling pointer
   * that nothing cleaned up. `ungroup` hands the children to the grandparent
   * and, being non-recursive like tldraw, leaves nested groups intact.
   *
   * The freed children stay selected, which is what the user is left holding.
   */
  const handleUngroupSelected = useCallback(() => {
    const selectedGroups = nodes.filter((n) => selectedNodeIds.has(n.id) && isGroup(n));
    if (selectedGroups.length === 0) return;
    let next = nodes;
    const freed = new Set<string>();
    for (const group of selectedGroups) {
      const result = ungroup(next, group.id);
      next = result.nodes;
      for (const child of groupIndex.childIds(group.id)) freed.add(child);
    }
    commit(next);
    setSelectedNodeIds(freed);
    setSelectedEdgeIds(new Set());
  }, [nodes, selectedNodeIds, groupIndex, commit]);

  /**
   * Shrink a group to hug the children it actually has.
   *
   * Reads members from the `parentId` tree, so it includes a member that sits
   * outside the current frame and therefore *grows* the group to reclaim it. The
   * old geometric version could only ever shrink, so a member assigned by hand
   * to a group it did not visually sit in was invisible here and the group was
   * resized to exclude it.
   *
   * Uses the same padding as the invariant pass so a manual fit and an automatic
   * refit cannot disagree by a few pixels.
   */
  const handleFitGroupToContents = useCallback(
    (groupId: string) => {
      const members = groupIndex.members(groupId);
      if (members.length === 0) return;
      const bbox = computeBoundingBox(members, { x: GROUP_PADDING, y: GROUP_PADDING });
      commit((prev) => prev.map((n) => (n.id === groupId ? { ...n, ...bbox } : n)));
    },
    [groupIndex, commit]
  );

  // -------------------------------------------------------------------------
  // Manual assignment (open decision #5)
  // -------------------------------------------------------------------------

  /**
   * Move nodes under a group, or to the canvas root when `parentId` is null.
   *
   * The explicit counterpart to dragging: this works on nodes that share no
   * spatial relationship with the target at all, which is the case that matters
   * for a structural group and the one a drag can never express.
   *
   * `reparent` refuses a cycle or an unknown parent and reports which, so the
   * caller can surface a real reason instead of silently doing nothing. The
   * refusal is returned rather than thrown because "you cannot put a group
   * inside itself" is user feedback, not a bug.
   */
  const handleMoveToGroup = useCallback(
    (ids: string[], parentId: string | null): { ok: boolean; reason?: 'cycle' | 'unknown-parent' } => {
      const result = reparent(nodes, ids, parentId);
      if (!result.changed) return { ok: false, reason: result.rejected };
      commit(result.nodes);
      setSelectedNodeIds(new Set(ids));
      return { ok: true };
    },
    [nodes, commit]
  );

  /**
   * Flip a group between a visual container and an organisational one.
   *
   * Switching *to* `spatial` is where the difference becomes visible: a
   * `structural` group may be holding children that drifted outside its frame,
   * and committing immediately releases them. That is the honest outcome — the
   * group is now claiming to be a frame, and it should not claim to contain
   * what is visibly outside it — and it is undoable like any other change.
   */
  const handleSetMembership = useCallback(
    (groupId: string, membership: 'spatial' | 'structural') => {
      commit(nodes.map((n) => (n.id === groupId ? { ...n, membership } : n)));
    },
    [nodes, commit]
  );

  /** Groups that could legally receive `ids`, nearest-first, for the Move to menu. */
  const handleAssignableGroups = useCallback(
    (ids: string[]): { id: string; label: string; depth: number }[] => {
      const moving = new Set(ids);
      return nodes
        .filter((g) => {
          if (!isGroup(g) || moving.has(g.id)) return false;
          return !ids.some((id) => groupIndex.isDescendantOf(g.id, id));
        })
        .map((g) => ({ id: g.id, label: g.label ?? 'Group', depth: groupIndex.depth(g.id) }))
        .sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label));
    },
    [nodes, groupIndex]
  );

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * The innermost group that should be selected for a click on `nodeId`.
   *
   * Click selects the *outermost* group, per tldraw/Figma/draw.io, and drilling
   * narrows the scope rather than changing what a click means. Without a scope
   * a click on a deeply nested node would jump straight to the outermost group,
   * which is correct but makes the middle of the hierarchy unreachable.
   */
  const [drillPath, setDrillPath] = useState<string[]>([]);

  /** Resolve a click to the selection set implied by the current drill scope. */
  const selectionForClick = useCallback(
    (nodeId: string): Set<string> => {
      const clicked = groupIndex.get(nodeId);
      if (!clicked) return new Set([nodeId]);
      // Not a group: the click means the node, unless it is a child of the
      // group currently in scope, in which case it means that group.
      if (!isGroup(clicked)) {
        const parentId = clicked.parentId;
        return new Set([parentId && groupIndex.get(parentId) ? parentId : nodeId]);
      }
      return new Set([nodeId]);
    },
    [groupIndex]
  );

  /** Select a group's members from the tree rather than by geometry. */
  const handleSelectGroupMembers = useCallback(
    (groupId: string) => {
      const members = groupIndex.childIds(groupId);
      if (members.length === 0) return;
      setSelectedNodeIds(new Set(members));
    },
    [groupIndex]
  );

  /**
   * Descend into a group (double-click, `Enter`, or `Tab`).
   *
   * The scope is a path rather than a single id so repeated descent into nested
   * groups is well defined and `Esc` can pop exactly one level.
   */
  const handleDrillInto = useCallback(
    (groupId: string) => {
      setDrillPath((path) => (path[path.length - 1] === groupId ? path : [...path, groupId]));
    },
    []
  );

  const handleDrillOut = useCallback(() => {
    setDrillPath((path) => path.slice(0, -1));
  }, []);

  const handleResetDrill = useCallback(() => setDrillPath([]), []);

  /** The group whose children the pointer is currently "inside". */
  const activeGroupId = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;

  /**
   * The group a drag would drop into right now, or null.
   *
   * Drives the "Drop into X" affordance during a node drag. Recomputed from the
   * last known pointer position, which `clientToCanvasCoord` keeps current, so
   * it needs no extra listener and no per-frame state of its own.
   */
  const dropTargetGroupId = useMemo(() => {
    if (!isDraggingNodes || selectedNodeIds.size === 0) return null;
    return resolveDropTarget(nodes, selectedNodeIds, lastPointerWorldRef.current)?.groupId ?? null;
  }, [isDraggingNodes, selectedNodeIds, nodes]);

  const handleDuplicateSelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const toDuplicate = nodes.filter((n) => selectedNodeIds.has(n.id));
    const newNodes = toDuplicate.map((n) => ({
      ...n,
      id: `${n.type || 'node'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      x: n.x + 40,
      y: n.y + 40,
    }));
    commit([...nodes, ...newNodes]);
    setSelectedNodeIds(new Set(newNodes.map((n) => n.id)));
  }, [nodes, selectedNodeIds, commit]);

  const handleBulkColorChange = useCallback(
    (code: CanvasColorCode) => {
      if (selectedNodeIds.size === 0) return;
      commit(nodes.map((n) => (selectedNodeIds.has(n.id) ? { ...n, color: code } : n)));
    },
    [nodes, selectedNodeIds, commit]
  );

  const handleContextMenuColorChange = useCallback(
    (color: CanvasColorCode) => {
      if (contextMenu?.targetType === 'edge' && contextMenu.edge) {
        const edgeId = contextMenu.edge.id;
        const updated = edges.map((e) => (e.id === edgeId ? { ...e, color } : e));
        setEdges(updated);
        pushHistory(nodes, updated);
      } else if (contextMenu?.targetType === 'node' && contextMenu.node) {
        const nodeId = contextMenu.node.id;
        commit(nodes.map((n) => (n.id === nodeId ? { ...n, color } : n)));
      } else if (selectedNodeIds.size > 0) {
        handleBulkColorChange(color);
      }
    },
    [contextMenu, nodes, edges, selectedNodeIds, handleBulkColorChange, pushHistory]
  );

  const handleSelectResource = useCallback(
    (item: PickedResource) => {
      const isCanvas = item.type === 'canvas' || item.id.startsWith('canvas:');
      const isSheet = item.type === 'sheet' || item.id.startsWith('sheet:');
      const isExcalidraw = item.type === 'excalidraw' || item.id.startsWith('excalidraw:');
      const isJupyter = item.type === 'jupyter' || item.id.startsWith('jupyter:');
      const isMermaid = item.type === 'mermaid' || item.id.startsWith('mermaid:');
      const isPaper = item.type === 'paper' || item.id.startsWith('paper:');

      const width = isCanvas || isExcalidraw || isJupyter ? 580 : isSheet ? 560 : isMermaid ? 480 : 340;
      const height = isExcalidraw ? 420 : isJupyter ? 440 : isCanvas ? 380 : isSheet ? 360 : isMermaid ? 320 : 220;
      const color = isCanvas ? '5' : isExcalidraw ? '3' : isSheet ? '4' : isJupyter ? '2' : isMermaid ? '1' : isPaper ? '6' : '4';

      const centerCoord = clientToCanvasCoord(window.innerWidth / 2 - width / 2, window.innerHeight / 2 - height / 2);

      const cleanId = stripHtml(item.id);
      const cleanTitle = stripHtml(item.title);
      const cleanType = stripHtml(item.type);

      const newNode: CanvasNode = {
        id: `node_${Date.now()}`,
        type: 'resource',
        x: Math.round(centerCoord.x / 20) * 20,
        y: Math.round(centerCoord.y / 20) * 20,
        width,
        height,
        color,
        resourceId: cleanId,
        resourceType: cleanType,
        resolvedTitle: cleanTitle,
        resolvedSummary: item.summary,
        resolvedMetadata: item.metadata,
      };

      commit([...nodes, newNode]);
      setSelectedNodeIds(new Set([newNode.id]));
      setSelectedEdgeIds(new Set());
    },
    [nodes, edges, clientToCanvasCoord, pushHistory]
  );

  /**
   * Re-arranges every node into depth columns. The algorithm, including group
   * preservation and cycle breaking, lives in `core/autoLayout` so it can be
   * tested directly instead of via a copy.
   */
  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return;
    // A single undo step for the whole rearrangement, and the same invariants
    // every other write gets, so layout cannot produce a document that the rest
    // of the app would have to defend against.
    commit(autoLayout(nodes, edges).nodes, edges, 'structural');
  }, [nodes, edges, commit]);

  const handleApplyTextEdit = useCallback(() => {
    if (!editingNode) return;
    commit(nodes.map((n) => (n.id === editingNode.id ? { ...n, text: editTextValue } : n)));
    setEditingNode(null);
  }, [editingNode, editTextValue, nodes, commit]);

  const handleApplyJson = useCallback(
    (newNodes: CanvasNode[], newEdges: CanvasEdge[], newTitle?: string) => {
      // Pasted JSON is as untrusted as a fetched document, so it is normalised
      // on the way in rather than trusted to already be in the new model.
      commit(newNodes, newEdges);
      if (newTitle) setTitle(newTitle);
      setIsJsonModalOpen(false);
    },
    [pushHistory]
  );

  /**
   * Node move, resize and marquee live in `core/usePointerInteraction`, which
   * owns the rAF throttle, the drag threshold, the grid snapping and the
   * pointer bookkeeping. This is the host adapter: it supplies the transform and
   * world conversion, applies previews, and turns a finished gesture into a
   * selection change or a history entry.
   *
   * The inline implementation this replaces re-subscribed its window listeners
   * on every `nodes` change — once per animation frame during a drag — and
   * re-derived each node from positions captured in refs, so a fast drag could
   * compose from a stale list.
   */
  const pointerInteraction = usePointerInteraction({
    nodes,
    getTransform: () => ({ x: board.pan?.x ?? 0, y: board.pan?.y ?? 0, k: board.zoom ?? 1 }),
    toWorld: clientToCanvasCoord,
    /**
     * Previews stay raw on purpose. Invariants are O(n) and a drag emits a
     * preview every animation frame, so running them here would re-fit every
     * group sixty times a second for a result the user only sees once. The
     * policy is applied on `onEnd`, which is also what makes a spatial detach a
     * single undo step instead of a stream of them.
     */
    onPreview: (next) => {
      nodesRef.current = next;
      setNodes(next);
    },
    onBegin: (kind) => {
      if (kind === 'move') setIsDraggingNodes(true);
      else if (kind === 'resize') setResizingNodeId('pending');
    },
    onEnd: (kind, finalNodes, moved) => {
      // Only a gesture that actually moved is worth an undo step; a plain click
      // that happened to begin a drag must not fill the history.
      if (!moved) {
        if (kind === 'move') setIsDraggingNodes(false);
        if (kind === 'resize') setResizingNodeId(null);
        return;
      }
      if (kind === 'move') {
        setIsDraggingNodes(false);
        didDragRef.current = true;
        /**
         * Drop into a group first, if one is under the pointer. Done before the
         * invariants so the reparent is part of the same undo step as the move,
         * and so a group that the move pushed a child out of is evaluated after
         * the reparent rather than before.
         */
        const target = resolveDropTarget(
          finalNodes,
          selectedNodeIdsRef.current,
          lastPointerWorldRef.current
        );
        const landed = target
          ? reparent(finalNodes, [...selectedNodeIdsRef.current], target.groupId)
          : { nodes: finalNodes, changed: false as const };
        // Applies the child policy: a child dragged clear of a spatial frame is
        // released here, and structural groups keep theirs.
        commit(landed.nodes, undefined, 'move');
        return;
      }
      if (kind === 'resize') {
        setResizingNodeId(null);
        commit(finalNodes, undefined, 'resize');
      }
    },
    onMarquee: (ids) => {
      setSelectedNodeIds(new Set(ids));
    },
    onMarqueeEnd: (ids) => {
      setSelectedNodeIds(new Set(ids));
    },
    onCancel: (kind, restored) => {
      // A cancelled gesture restores the pre-drag document verbatim, so it must
      // not go through `commit` — there is nothing to enforce and no step to push.
      nodesRef.current = restored;
      setNodes(restored);
      if (kind === 'move') setIsDraggingNodes(false);
      if (kind === 'resize') setResizingNodeId(null);
    },
  });

  const { marquee } = pointerInteraction;

  const startNodeDrag = useCallback(
    (
      nodeId: string,
      e: React.MouseEvent | React.PointerEvent,
      targetSelectedIds?: Set<string>
    ) => {
      e.stopPropagation();
      e.preventDefault();

      if (board.isSpacePressed || board.activeMode === 'pan' || e.button === 1 || e.button === 2) {
        board.startPan?.(e);
        return;
      }

      const ids = targetSelectedIds ?? selectedNodeIds;
      if (!ids.has(nodeId)) {
        // Clicking an unselected node collapses the selection onto it, so the
        // drag moves just that node rather than the whole previous selection.
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedEdgeIds(new Set());
        pointerInteraction.beginMove(e, nodeId, [nodeId]);
        return;
      }
      pointerInteraction.beginMove(e, nodeId, ids);
    },
    [board, pointerInteraction, selectedNodeIds, setSelectedEdgeIds, setSelectedNodeIds]
  );

  const startNodeResize = useCallback(
    (nodeId: string, e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      pointerInteraction.beginResize(e, nodeId);
    },
    [pointerInteraction]
  );

  /**
   * The connection state machine lives in `core/useConnection`; this is the
   * adapter that turns its host-agnostic results into document edits.
   *
   * The inline version this replaces duplicated all of it — its own draft state,
   * its own hit testing, its own Escape handling — and needed live refs purely
   * so the window `pointerup` listener would not commit a connection the user
   * had already cancelled. The core hook owns the drag, resolves drop targets
   * through the spatial index, and exposes `finish()`/`cancel()`
   * synchronously, so none of that is needed here any more.
   */
  const nodeIndex = useMemo(() => new NodeIndex(nodes), [nodes]);

  const applyConnectionResult = useCallback(
    (result: ConnectionResult) => {
      if (result.type === 'create') {
        const updated = [...edges, result.edge];
        setEdges(updated);
        setSelectedEdgeIds(new Set([result.edge.id]));
        setSelectedNodeIds(new Set());
        pushHistory(nodes, updated, 'connect');
        return;
      }

      const updated = edges.map((ed) => {
        if (ed.id !== result.edgeId) return ed;
        if (result.type === 'reattach') {
          // Clearing the stored free position is essential: a later detach would
          // otherwise resurrect a stale coordinate.
          return result.end === 'from'
            ? { ...ed, fromNode: result.nodeId, fromSide: result.side, fromX: undefined, fromY: undefined }
            : { ...ed, toNode: result.nodeId, toSide: result.side, toX: undefined, toY: undefined };
        }
        if (result.type === 'detach') {
          // Keep where it was let go, or the edge has no drawable anchor and its
          // handle disappears along with it.
          return result.end === 'from'
            ? { ...ed, fromNode: '', fromX: result.point.x, fromY: result.point.y }
            : { ...ed, toNode: '', toX: result.point.x, toY: result.point.y };
        }
        return result.end === 'from' ? { ...ed, fromNode: '' } : { ...ed, toNode: '' };
      });

      setEdges(updated);
      pushHistory(nodes, updated, 'connect');
    },
    [edges, nodes, pushHistory, setEdges, setSelectedEdgeIds, setSelectedNodeIds]
  );

  const connection = useConnection({
    nodes,
    edges,
    index: nodeIndex,
    toWorld: clientToCanvasCoord,
    allowReattach: true,
    defaultLabel: DEFAULT_EDGE_LABEL,
    onChange: applyConnectionResult,
  });

  const { drag: connectionDrag } = connection;

  /**
   * Live mirror so the window listeners can ask "is a connection live?" without
   * waiting for a re-render. Escape and a release can land in the same frame,
   * and a cancelled drag must not then be committed.
   */
  const connectionDragRef = useRef(connectionDrag);
  connectionDragRef.current = connectionDrag;

  const cancelConnection = useCallback(() => {
    connectionDragRef.current = null;
    connection.cancel();
  }, [connection]);

  const startPortConnect = useCallback(
    (nodeId: string, side: CanvasPortSide, e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      connection.startFromPort(nodeId, side);
    },
    [connection]
  );

  const startEdgeEndDrag = useCallback(
    (edgeId: string, end: 'from' | 'to', e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // Selecting here keeps the handles visible for the whole drag; otherwise
      // the dot the user is holding vanishes the moment it loses its selection.
      setSelectedEdgeIds(new Set([edgeId]));
      connection.startFromEdgeEnd(edgeId, end);
    },
    [connection, setSelectedEdgeIds]
  );

  const updateConnection = useCallback(
    (clientX: number, clientY: number) => connection.update(clientX, clientY),
    [connection]
  );

  const finishConnection = useCallback(
    (clientX: number, clientY: number) => {
      // The core hook reads the pointer from the event, so feed it the release
      // position before committing. Otherwise a release in empty space detaches
      // at the last *move* position rather than where the user let go.
      connection.update(clientX, clientY);
      connection.finish();
    },
    [connection]
  );

  /** Which end of which edge is being re-pointed, or null. */
  const activeEdgeEnd = useMemo<{ edgeId: string; end: 'from' | 'to' } | null>(() => {
    if (!connectionDrag || connectionDrag.origin.kind !== 'reattach') return null;
    return { edgeId: connectionDrag.origin.edgeId, end: connectionDrag.origin.end };
  }, [connectionDrag]);

  const connectionTargetNodeId = connectionDrag?.target?.nodeId ?? null;
  const connectionTargetSide = connectionDrag?.target?.side ?? null;

  /**
   * The rubber band, in the shape the edge renderer consumes.
   *
   * When re-pointing an existing edge the band is anchored on the *stationary*
   * end and follows the dragged one, which is the convention every mature
   * whiteboard uses. That anchor can itself be detached, so it is resolved with
   * `resolveEdgeEnd` rather than assuming a node is there.
   */
  const draftEdge = useMemo(() => {
    if (!connectionDrag) return null;

    if (connectionDrag.origin.kind === 'create') {
      return {
        fromNode: connectionDrag.origin.fromNode,
        fromSide: connectionDrag.origin.fromSide as CanvasPortSide,
        currentX: connectionDrag.pointer.x,
        currentY: connectionDrag.pointer.y,
      };
    }

    const { edgeId, end, original } = connectionDrag.origin;
    void original;
    const edge = edges.find((ed) => ed.id === edgeId);
    if (!edge) return null;
    const anchor = resolveEdgeEnd(edge, end === 'from' ? 'to' : 'from', nodes);
    if (!anchor) return null;

    return {
      fromNode: anchor.nodeId,
      fromSide: anchor.side as CanvasPortSide,
      currentX: connectionDrag.pointer.x,
      currentY: connectionDrag.pointer.y,
    };
  }, [connectionDrag, edges, nodes]);

  /**
   * Unlink an endpoint explicitly, keeping the rest of the edge.
   *
   * The free position is preserved at the end's current world anchor. Clearing
   * only the node id would leave the edge with nowhere to draw and no handle to
   * grab, so an explicit "unlink" would be indistinguishable from a delete.
   */
  const detachEdgeEnd = useCallback(
    (edgeId: string, end: 'from' | 'to') => {
      const edge = edges.find((ed) => ed.id === edgeId);
      if (!edge) return;
      const anchor = resolveEdgeEnd(edge, end, nodes);
      const free = anchor?.point ?? { x: edge[end === 'from' ? 'fromX' : 'toX'] ?? 0, y: edge[end === 'from' ? 'fromY' : 'toY'] ?? 0 };

      const updated = edges.map((ed) =>
        ed.id === edgeId
          ? end === 'from'
            ? { ...ed, fromNode: '', fromX: free.x, fromY: free.y }
            : { ...ed, toNode: '', toX: free.x, toY: free.y }
          : ed
      );
      setEdges(updated);
      pushHistory(nodes, updated, 'connect');
    },
    [edges, nodes, pushHistory, setEdges]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      const updated = edges.filter((ed) => ed.id !== edgeId);
      if (updated.length === edges.length) return;
      setEdges(updated);
      setSelectedEdgeIds(new Set());
      pushHistory(nodes, updated);
    },
    [edges, nodes, pushHistory, setSelectedEdgeIds]
  );

  const handleNodePointerDown = useCallback(
    (nodeId: string, e: React.PointerEvent) => {
      if (board.isSpacePressed || board.activeMode === 'pan' || e.button === 1 || e.button === 2) {
        board.startPan?.(e);
        return;
      }
      if (e.button !== 0) return;

      let nextSelected = new Set(selectedNodeIds);
      if (e.shiftKey) {
        if (nextSelected.has(nodeId)) {
          nextSelected.delete(nodeId);
        } else {
          nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        setSelectedEdgeIds(new Set());
        startNodeDrag(nodeId, e, nextSelected);
      } else {
        if (!nextSelected.has(nodeId)) {
          nextSelected = new Set([nodeId]);
          setSelectedNodeIds(nextSelected);
          setSelectedEdgeIds(new Set());
        }
        startNodeDrag(nodeId, e, nextSelected);
      }
    },
    [board, selectedNodeIds, startNodeDrag]
  );

  const handleNodeClick = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey) {
        return;
      }
      if (!didDragRef.current) {
        // Scope-aware: a click resolves to whatever the current drill level says
        // the user means, so descending actually changes what a click does
        // rather than just being a visual mode.
        setSelectedNodeIds(selectionForClick(nodeId));
        setSelectedEdgeIds(new Set());
      }
    },
    [selectionForClick]
  );

  const handleNodeContextMenu = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const isMulti = selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId);
      if (!isMulti) {
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedEdgeIds(new Set());
      }
      const node = nodes.find((n) => n.id === nodeId);
      const coord = clientToCanvasCoord(e.clientX, e.clientY);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX: coord.x,
        canvasY: coord.y,
        targetType: isMulti ? 'multi' : 'node',
        targetId: nodeId,
        node,
      });
    },
    [selectedNodeIds, nodes, clientToCanvasCoord]
  );

  const handleEdgeClick = useCallback((edgeId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedEdgeIds(new Set([edgeId]));
    setSelectedNodeIds(new Set());
  }, []);

  const handleEdgeContextMenu = useCallback(
    (edgeId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const edge = edges.find((ed) => ed.id === edgeId);
      if (!edge) return;
      setSelectedEdgeIds(new Set([edgeId]));
      setSelectedNodeIds(new Set());
      const coord = clientToCanvasCoord(e.clientX, e.clientY);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX: coord.x,
        canvasY: coord.y,
        targetType: 'edge',
        targetId: edgeId,
        edge,
      });
    },
    [edges, clientToCanvasCoord]
  );

  const handleBoardPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest(OWNED_POINTER_SELECTOR)) {
        return;
      }

      const isMiddleClick = e.button === 1;
      const isRightClick = e.button === 2;
      const isHandPan = board.activeMode === 'pan' && e.button === 0 && !e.shiftKey;
      const isSpacePan = board.isSpacePressed && e.button === 0;

      if (isMiddleClick || isRightClick || isSpacePan || isHandPan) {
        if (isRightClick && board.didPanWithRightClickRef) {
          board.didPanWithRightClickRef.current = false;
        }
        board.startPan?.(e);
        return;
      }

      if (e.button === 0) {
        // Shift keeps the current selection as the marquee's base, so the band
        // adds to it; a plain drag starts from nothing.
        const base = e.shiftKey ? selectedNodeIds : new Set<string>();
        if (!e.shiftKey) {
          setSelectedNodeIds(new Set());
          setSelectedEdgeIds(new Set());
        }
        pointerInteraction.beginMarquee(e, base);
      }
    },
    [board, clientToCanvasCoord, pointerInteraction, selectedNodeIds, setSelectedEdgeIds, setSelectedNodeIds]
  );

  const handleBoardContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (board.didPanWithRightClickRef?.current) {
        board.didPanWithRightClickRef.current = false;
        return;
      }
      const coord = clientToCanvasCoord(e.clientX, e.clientY);
      const targetType = selectedNodeIds.size > 1 ? 'multi' : 'board';
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX: coord.x,
        canvasY: coord.y,
        targetType,
      });
    },
    [board, clientToCanvasCoord, selectedNodeIds]
  );

  /**
   * The only window listener left here is the connection's: node move, resize
   * and marquee are driven by `core/usePointerInteraction`, which needs no help.
   */
  useEffect(() => {
    if (!connectionDrag) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      // Keep the rubber band and the drop highlight in step with the pointer.
      updateConnection(e.clientX, e.clientY);
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      // A release anywhere commits the connection against whatever node is
      // under the pointer. Previously this only ran from a port's own onMouseUp,
      // so letting go between ports threw the drag away.
      if (connectionDragRef.current) {
        finishConnection(e.clientX, e.clientY);
      }
    };

    /**
     * Pointer Events rather than mouse events: the ports and endpoint handles
     * both open their drag from `onPointerDown`, so a touch that started a
     * connection had no move/up stream to finish it and simply stalled. A
     * single pointer pair covers mouse, pen and touch uniformly.
     */
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [connectionDrag, finishConnection, updateConnection]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const isMeta = e.ctrlKey || e.metaKey;

      if (isMeta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (isMeta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (isMeta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if (isMeta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedNodeIds(new Set(nodes.map((n) => n.id)));
      } else if (isMeta && e.altKey && e.key.toLowerCase() === 'g') {
        /**
         * Reparent into the group under the pointer. The keyboard counterpart
         * of drag-to-group, and the only way to express "these belong to that
         * group" for nodes that are nowhere near it.
         */
        e.preventDefault();
        const target = resolveDropTarget(nodes, selectedNodeIds, lastPointerWorldRef.current);
        if (!target) {
          showToast('No group under the pointer to move these into', { tone: 'warn' });
          return;
        }
        const result = reparent(nodes, [...selectedNodeIds], target.groupId);
        if (!result.changed) {
          showToast(
            result.rejected === 'cycle' ? 'A group cannot go inside itself' : 'That group is gone',
            { tone: 'danger' }
          );
          return;
        }
        commit(result.nodes);
      } else if (isMeta && e.altKey && e.key.toLowerCase() === 's') {
        // Flip the selected groups between a visual frame and a structural one.
        e.preventDefault();
        for (const id of selectedNodeIds) {
          const group = groupIndex.get(id);
          if (!group || !isGroup(group)) continue;
          const next = membershipOf(group) === 'structural' ? 'spatial' : 'structural';
          commit((prev) => prev.map((n) => (n.id === id ? { ...n, membership: next } : n)));
          showToast(
            next === 'structural'
              ? `"${group.label ?? 'Group'}" is now structural`
              : `"${group.label ?? 'Group'}" is now a contained frame`
          );
        }
      } else if (isMeta && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          handleUngroupSelected();
        } else {
          handleGroupSelected();
        }
      } else if (!isMeta && !e.altKey && e.key.toLowerCase() === 'o') {
        // Toggle the outline panel. Skipped while typing, so a note containing
        // the letter "o" does not keep flipping the sidebar.
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas:toggle-outline'));
      } else if (e.key === 'Enter' && selectedNodeIds.size === 1) {
        // Drill into the selected group, tldraw's model.
        const only = nodes.find((n) => n.id === [...selectedNodeIds][0]);
        if (only && isGroup(only)) {
          e.preventDefault();
          setDrillPath((path) => [...path, only.id]);
        }
      } else if (e.key === 'Tab' && activeGroupId) {
        // Cycle through the group in scope, then into its first child group.
        e.preventDefault();
        const inScope = groupIndex.childIds(activeGroupId);
        const groupsInScope = inScope.filter((id) => isGroup(groupIndex.get(id) ?? { type: 'group' }));
        if (groupsInScope.length > 0) {
          setDrillPath((path) => [...path, groupsInScope[0]]);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (connectionDragRef.current) {
          // Abort the connection without touching the document.
          e.preventDefault();
          cancelConnection();
        } else if (isFullscreenRef.current) {
          // Second Escape leaves fullscreen rather than clearing selection.
          e.preventDefault();
          exitFullscreenRef.current?.();
        } else if (isPickerOpen) {
          setIsPickerOpen(false);
        } else if (isJsonModalOpen) {
          setIsJsonModalOpen(false);
        } else if (editingNode) {
          setEditingNode(null);
        } else if (contextMenu) {
          setContextMenu(null);
        } else if (drillPath.length > 0) {
          // Pop out one level before giving up on the selection, so the escape
          // hatch out of a nested group is reachable without the mouse.
          e.preventDefault();
          setDrillPath((path) => path.slice(0, -1));
        } else {
          setSelectedNodeIds(new Set());
          setSelectedEdgeIds(new Set());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    history,
    selectedNodeIds,
    selectedEdgeIds,
    nodes,
    edges,
    groupIndex,
    drillPath,
    activeGroupId,
    commit,
    isPickerOpen,
    isJsonModalOpen,
    editingNode,
    contextMenu,
    isPickerOpen,
    isJsonModalOpen,
    editingNode,
    contextMenu,
    handleRedo,
    handleUndo,
    handleSave,
    handleUngroupSelected,
    handleGroupSelected,
    deleteSelected,
  ]);

  const selectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
  const selectedEdgeId = selectedEdgeIds.size === 1 ? Array.from(selectedEdgeIds)[0] : null;
  const singleSelectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) || null : null;
  const singleSelectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) || null : null;

  return {
    nodes,
    setNodes,
    groupIndex,
    handleMoveToGroup,
    handleSetMembership,
    handleAssignableGroups,
    handleSelectGroupMembers,
    selectionForClick,
    drillPath,
    activeGroupId,
    dropTargetGroupId,
    handleDrillInto,
    handleDrillOut,
    handleResetDrill,
    connectionTargetNodeId,
    connectionTargetSide,
    activeEdgeEnd,
    hoveredNodeId,
    setHoveredNodeId,
    startPortConnect,
    startEdgeEndDrag,
    updateConnection,
    finishConnection,
    cancelConnection,
    detachEdgeEnd,
    deleteEdge,
    edges,
    setEdges,
    title,
    setTitle,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    singleSelectedNode,
    singleSelectedEdge,
    historyIndex: history.index,
    historyLength: history.length,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    handleUndo,
    handleRedo,
    pushHistory,
    bounds,
    isSaving,
    saveStatus,
    handleSave,
    handleExportObsidian,
    clientToCanvasCoord,
    marquee,
    isDraggingNodes,
    resizingNodeId,
    draftEdge,
    editingNode,
    setEditingNode,
    editTextValue,
    setEditTextValue,
    handleApplyTextEdit,
    isPickerOpen,
    setIsPickerOpen,
    handleSelectResource,
    isJsonModalOpen,
    setIsJsonModalOpen,
    handleApplyJson,
    contextMenu,
    setContextMenu,
    handleAddText,
    handleAddTextAt,
    handleAddGroup,
    handleAddGroupAt,
    handleGroupSelected,
    handleUngroupSelected,
    handleFitGroupToContents,
    handleDuplicateSelected,
    deleteSelected,
    handleBulkColorChange,
    handleContextMenuColorChange,
    handleAutoLayout,
    startNodeDrag,
    startNodeResize,
    handleNodePointerDown,
    handleNodeClick,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
    handleBoardPointerDown,
    handleBoardContextMenu,
  };
}