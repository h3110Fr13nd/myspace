import type { CanvasNode, CanvasEdge, CanvasColorCode } from './types';
import { isGroup } from './core/grouping';
import type { ContextMenuItem } from './CanvasContextMenu';

export interface ContextMenuState {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  targetType: 'board' | 'node' | 'edge' | 'multi';
  targetId?: string;
  node?: CanvasNode;
  edge?: CanvasEdge;
}

export interface BuildMenuItemsOptions {
  state: ContextMenuState;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  isStudio: boolean;
  onAddTextAt: (x: number, y: number) => void;
  onAddGroupAt: (x: number, y: number) => void;
  onAddResourceAt?: (type: string, x: number, y: number) => void;
  onOpenResourcePicker: () => void;
  onEditNodeText?: (node: CanvasNode) => void;
  onFitGroupToContents?: (groupId: string) => void;
  onGroupSelected?: () => void;
  onUngroupSelected?: () => void;
  onMoveToGroup?: (ids: string[], parentId: string | null) => void;
  onSetMembership?: (groupId: string, membership: 'spatial' | 'structural') => void;
  onSelectGroupMembers?: (groupId: string) => void;
  onDrillInto?: (groupId: string) => void;
  onDuplicateSelected?: () => void;
  onDeleteSelected: () => void;
  onChangeColor: (color: CanvasColorCode) => void;
  onSelectAll: () => void;
  onFitToBounds: () => void;
  onResetZoom: () => void;
  onAutoLayout?: () => void;
  onOpenJsonEditor?: () => void;
  onExportObsidian?: () => void;
  onNavigateToStudio?: (targetNodeId?: string) => void;
  onCopyJson?: () => void;
  /** Groups that could receive `ids`, for the Move to submenu. */
  assignableGroups?: { id: string; label: string; depth: number }[];
  /** parentId of a single clicked node, for the header line. */
  parentLabelOf?: (nodeId: string) => string | null;
}

export function buildCanvasContextMenuItems(opts: BuildMenuItemsOptions): ContextMenuItem[] {
  const {
    state,
    selectedNodeIds,
    nodes,
    isStudio,
    onAddTextAt,
    onAddGroupAt,
    onAddResourceAt,
    onOpenResourcePicker,
    onEditNodeText,
    onFitGroupToContents,
    onGroupSelected,
    onUngroupSelected,
    onMoveToGroup,
    onSetMembership,
    onSelectGroupMembers,
    onDrillInto,
    onDuplicateSelected,
    onDeleteSelected,
    onChangeColor,
    onSelectAll,
    onFitToBounds,
    onResetZoom,
    onAutoLayout,
    onOpenJsonEditor,
    onExportObsidian,
    onNavigateToStudio,
    onCopyJson,
    assignableGroups = [],
    parentLabelOf,
  } = opts;

  const colorSubItems: ContextMenuItem[] = [
    { id: 'color-cyan', label: 'Cyan (#5)', icon: '🟦', action: () => onChangeColor('5') },
    { id: 'color-purple', label: 'Purple (#6)', icon: '🟪', action: () => onChangeColor('6') },
    { id: 'color-emerald', label: 'Emerald (#4)', icon: '🟩', action: () => onChangeColor('4') },
    { id: 'color-amber', label: 'Amber (#3)', icon: '🟨', action: () => onChangeColor('3') },
    { id: 'color-orange', label: 'Orange (#2)', icon: '🟧', action: () => onChangeColor('2') },
    { id: 'color-rose', label: 'Rose (#1)', icon: '🟥', action: () => onChangeColor('1') },
  ];

  /**
   * The "Move to" submenu: the explicit way to express structure that no amount
   * of dragging could. Recents-adjacent ordering is simply shallowest-first, so
   * the groups a user is most likely to want are the ones already near the
   * selection rather than the top of an alphabetical list.
   */
  const buildMoveToSubItems = (ids: string[]): ContextMenuItem[] => {
    if (!onMoveToGroup) return [];
    const items: ContextMenuItem[] = assignableGroups.map((g) => ({
      id: `move-to-${g.id}`,
      // Indent by depth so nesting is legible without opening the outline.
      label: `${'\u00a0\u00a0'.repeat(g.depth)}${g.depth > 0 ? '\u2514 ' : ''}${g.label}`,
      icon: g.depth > 0 ? undefined : '🗂️',
      action: () => onMoveToGroup(ids, g.id),
    }));
    if (items.length > 0) items.push({ id: 'd-move-1', divider: true, label: '' });
    items.push({
      id: 'move-to-root',
      label: 'Top level (no group)',
      icon: '⬆️',
      action: () => onMoveToGroup(ids, null),
    });
    return items;
  };

  const canUnlink = (ids: string[]) => parentLabelOf?.(ids[0]) != null;

  // ==========================================
  // CASE 1: MULTI-NODE SELECTION CONTEXT MENU
  // ==========================================
  if (state.targetType === 'multi' || selectedNodeIds.size > 1) {
    const items: ContextMenuItem[] = [
      {
        id: 'multi-count',
        label: `${selectedNodeIds.size} Nodes Selected`,
        icon: '📦',
        disabled: true,
      },
      { id: 'd-1', divider: true, label: '' },
    ];

    if (isStudio) {
      if (onGroupSelected) {
        items.push({
          id: 'group-selected',
          label: 'Group Selection',
          icon: '🗂️',
          shortcut: 'Ctrl+G',
          action: onGroupSelected,
        });
      }
      if (onDuplicateSelected) {
        items.push({
          id: 'dup-selected',
          label: 'Duplicate Nodes',
          icon: '📋',
          shortcut: 'Ctrl+D',
          action: onDuplicateSelected,
        });
      }
      items.push({
        id: 'change-color-multi',
        label: 'Set Color Accent',
        icon: '🎨',
        subItems: colorSubItems,
      });
      if (onMoveToGroup) {
        const ids = [...selectedNodeIds];
        const subItems = buildMoveToSubItems(ids);
        if (subItems.length > 0) {
          items.push({
            id: 'move-selected-to',
            label: 'Move to Group',
            icon: '📂',
            subItems,
          });
        }
        items.push({
          id: 'unlink-selected',
          label: 'Remove from Group',
          icon: '🔗',
          disabled: !canUnlink(ids),
          action: () => onMoveToGroup(ids, null),
        });
      }
      items.push({ id: 'd-2', divider: true, label: '' });
      items.push({
        id: 'del-selected',
        label: `Delete (${selectedNodeIds.size}) Nodes`,
        icon: '🗑️',
        shortcut: 'Del',
        danger: true,
        action: onDeleteSelected,
      });
    }

    if (onCopyJson) {
      items.push({
        id: 'copy-selected-json',
        label: 'Copy JSON Snippet',
        icon: '📋',
        action: onCopyJson,
      });
    }

    return items;
  }

  // ==========================================
  // CASE 2: SINGLE NODE CONTEXT MENU
  // ==========================================
  if (state.targetType === 'node' && state.node) {
    const node = state.node;
    const items: ContextMenuItem[] = [];

    // Header info
    items.push({
      id: 'node-info',
      label: `${(node.resolvedTitle || node.label || node.id).slice(0, 24)} (${node.type})`,
      icon: node.type === 'group' ? '🗂️' : node.type === 'resource' ? '🔗' : '📄',
      disabled: true,
    });
    items.push({ id: 'd-node-1', divider: true, label: '' });

    // The tree, made legible from the canvas: this line is the answer to "is
    // this parent or inferred?" without opening anything.
    const parentLabel = parentLabelOf?.(node.id) ?? null;
    if (!isGroup(node)) {
      items.push({
        id: 'node-parent',
        label: parentLabel ? `In group: ${parentLabel}` : 'Top level (no group)',
        icon: parentLabel ? '🗂️' : '⬆️',
        disabled: true,
      });
    }

    if (isStudio) {
      if (!isGroup(node) && onMoveToGroup) {
        const subItems = buildMoveToSubItems([node.id]);
        if (subItems.length > 0) {
          items.push({
            id: 'move-node-to',
            label: 'Move to Group',
            icon: '📂',
            subItems,
          });
        }
        items.push({
          id: 'unlink-node',
          label: 'Remove from Group',
          icon: '🔗',
          disabled: !parentLabel,
          action: () => onMoveToGroup([node.id], null),
        });
      }

      // Type-specific primary actions
      if (node.type === 'text' && onEditNodeText) {
        items.push({
          id: 'edit-text',
          label: 'Edit Text & Markdown',
          icon: '✏️',
          action: () => onEditNodeText(node),
        });
      } else if (node.type === 'group') {
        if (onDrillInto) {
          items.push({
            id: 'drill-into-group',
            label: 'Enter Group',
            icon: '⏎',
            shortcut: 'Enter',
            action: () => onDrillInto(node.id),
          });
        }
        if (onSelectGroupMembers) {
          items.push({
            id: 'select-members',
            label: 'Select All Members',
            icon: '☑️',
            action: () => onSelectGroupMembers(node.id),
          });
        }
        if (onSetMembership) {
          const isStructural = node.membership === 'structural';
          items.push({
            id: 'toggle-membership',
            label: isStructural ? 'Children: Structural' : 'Children: Contained',
            icon: isStructural ? '🧱' : '🖼️',
            shortcut: 'Ctrl+Alt+S',
            // A radio, expressed as a toggle: one click flips it, and the label
            // states the current mode so the user can see which they are in.
            subItems: [
              {
                id: 'membership-spatial',
                label: 'Contained — a visual frame',
                icon: isStructural ? '　' : '✓',
                action: () => onSetMembership(node.id, 'spatial'),
              },
              {
                id: 'membership-structural',
                label: 'Structural — a folder that holds',
                icon: isStructural ? '✓' : '　',
                action: () => onSetMembership(node.id, 'structural'),
              },
            ],
          });
        }
        if (onFitGroupToContents) {
          items.push({
            id: 'fit-group',
            label: 'Fit Group to Contents',
            icon: '📐',
            action: () => onFitGroupToContents(node.id),
          });
        }
        if (onUngroupSelected) {
          items.push({
            id: 'ungroup',
            label: 'Ungroup Container',
            icon: '🔓',
            shortcut: 'Ctrl+Shift+G',
            action: onUngroupSelected,
          });
        }
      }

      if (onDuplicateSelected) {
        items.push({
          id: 'dup-node',
          label: 'Duplicate Node',
          icon: '📋',
          shortcut: 'Ctrl+D',
          action: onDuplicateSelected,
        });
      }

      items.push({
        id: 'node-color',
        label: 'Change Color Accent',
        icon: '🎨',
        subItems: colorSubItems,
      });

      items.push({ id: 'd-node-2', divider: true, label: '' });
      items.push({
        id: 'delete-node',
        label: 'Delete Node',
        icon: '🗑️',
        shortcut: 'Del',
        danger: true,
        action: onDeleteSelected,
      });
    } else {
      // Viewer Mode Actions
      if (onNavigateToStudio) {
        items.push({
          id: 'open-in-studio',
          label: 'Edit Node in Canvas Studio',
          icon: '✏️',
          action: () => onNavigateToStudio(node.id),
        });
      }
    }

    if (onCopyJson) {
      items.push({
        id: 'copy-node-json',
        label: 'Copy Node JSON',
        icon: '📋',
        action: onCopyJson,
      });
    }

    return items;
  }

  // ==========================================
  // CASE 3: EDGE CONTEXT MENU
  // ==========================================
  if (state.targetType === 'edge' && state.edge) {
    const items: ContextMenuItem[] = [
      {
        id: 'edge-info',
        label: state.edge.label ? `Edge: "${state.edge.label}"` : 'Relationship Edge',
        icon: '🔗',
        disabled: true,
      },
      { id: 'd-edge-1', divider: true, label: '' },
    ];

    if (isStudio) {
      items.push({
        id: 'edge-color',
        label: 'Set Edge Color',
        icon: '🎨',
        subItems: colorSubItems,
      });
      items.push({ id: 'd-edge-2', divider: true, label: '' });
      items.push({
        id: 'delete-edge',
        label: 'Delete Edge',
        icon: '🗑️',
        danger: true,
        action: onDeleteSelected,
      });
    }

    return items;
  }

  // ==========================================
  // CASE 4: EMPTY BOARD CANVAS CONTEXT MENU
  // ==========================================
  const boardItems: ContextMenuItem[] = [];

  if (isStudio) {
    // Quick Add Nodes sub-menu
    const addSubItems: ContextMenuItem[] = [
      {
        id: 'add-text',
        label: 'Markdown / Math Note',
        icon: '📝',
        action: () => onAddTextAt(state.canvasX, state.canvasY),
      },
      {
        id: 'add-group',
        label: 'Category Container / Group',
        icon: '🗂️',
        action: () => onAddGroupAt(state.canvasX, state.canvasY),
      },
      { id: 'd-add-1', divider: true, label: '' },
      {
        id: 'add-canvas',
        label: 'Interactive Sub-Canvas',
        icon: '🎨',
        action: () => onAddResourceAt ? onAddResourceAt('canvas', state.canvasX, state.canvasY) : onOpenResourcePicker(),
      },
      {
        id: 'add-sketch',
        label: 'Excalidraw Whiteboard',
        icon: '✏️',
        action: () => onAddResourceAt ? onAddResourceAt('excalidraw', state.canvasX, state.canvasY) : onOpenResourcePicker(),
      },
      {
        id: 'add-sheet',
        label: 'Spreadsheet Grid',
        icon: '📊',
        action: () => onAddResourceAt ? onAddResourceAt('sheet', state.canvasX, state.canvasY) : onOpenResourcePicker(),
      },
      {
        id: 'add-jupyter',
        label: 'Jupyter Notebook',
        icon: '🪐',
        action: () => onAddResourceAt ? onAddResourceAt('jupyter', state.canvasX, state.canvasY) : onOpenResourcePicker(),
      },
      {
        id: 'add-mermaid',
        label: 'Mermaid Diagram',
        icon: '📐',
        action: () => onAddResourceAt ? onAddResourceAt('mermaid', state.canvasX, state.canvasY) : onOpenResourcePicker(),
      },
      { id: 'd-add-2', divider: true, label: '' },
      {
        id: 'add-picker',
        label: 'Browse Resource Vault...',
        icon: '🔍',
        action: onOpenResourcePicker,
      },
    ];

    boardItems.push({
      id: 'add-menu',
      label: 'Add Node Here',
      icon: '➕',
      subItems: addSubItems,
    });
    boardItems.push({ id: 'd-board-1', divider: true, label: '' });
  }

  // Navigation & Viewport Sub-menu
  const viewSubItems: ContextMenuItem[] = [
    {
      id: 'fit-all',
      label: 'Fit to All Elements',
      icon: '⛶',
      shortcut: 'F',
      action: onFitToBounds,
    },
    {
      id: 'reset-zoom',
      label: 'Reset Zoom & Pan (100%)',
      icon: '⊙',
      shortcut: '0',
      action: onResetZoom,
    },
  ];

  if (isStudio && onAutoLayout) {
    viewSubItems.push({
      id: 'auto-layout',
      label: 'Auto-Layout (DAG Hierarchy)',
      icon: '🪄',
      action: onAutoLayout,
    });
  }

  boardItems.push({
    id: 'view-menu',
    label: 'Canvas Viewport',
    icon: '🔍',
    subItems: viewSubItems,
  });

  boardItems.push({
    id: 'select-all',
    label: 'Select All Nodes',
    icon: '✅',
    shortcut: 'Ctrl+A',
    action: onSelectAll,
  });

  boardItems.push({ id: 'd-board-2', divider: true, label: '' });

  if (onOpenJsonEditor) {
    boardItems.push({
      id: 'json-editor',
      label: isStudio ? 'JSON Canvas Source' : 'View .canvas Spec',
      icon: '📄',
      action: onOpenJsonEditor,
    });
  }

  if (isStudio && onExportObsidian) {
    boardItems.push({
      id: 'export-canvas',
      label: 'Export Obsidian .canvas File',
      icon: '💾',
      action: onExportObsidian,
    });
  }

  if (!isStudio && onNavigateToStudio) {
    boardItems.push({
      id: 'open-studio-board',
      label: 'Open Canvas in Studio',
      icon: '✏️',
      action: () => onNavigateToStudio(),
    });
  }

  return boardItems;
}
