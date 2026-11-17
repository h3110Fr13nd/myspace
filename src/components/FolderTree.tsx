import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Circle,
  FileText,
  Folder,
  FolderPlus,
  Link,
  PenLine,
  Plus,
  Share2,
  Shapes,
  Table2,
  Upload,
} from 'lucide-react';
import { getReadSet, toggleReadState } from './ReadToggle';
import { openCreateResourceModal, type CreateResourceModalOptions } from '../lib/createResourceEvents';
import { ResourceTypeIcon } from './ui/ResourceTypeIcon';
import { showToast } from './ui/Toast';
import { Button } from './ui/Button';

export interface FileNode {
  id: string;
  type: 'folder' | 'space' | 'document' | 'pdf' | 'image' | 'canvas' | 'sheet' | 'form';
  title: string;
  path?: string | null;
  children?: FileNode[];
  hasMoreChildren?: boolean;
}

interface FolderTreeProps {
  treeData: FileNode[];
  activeDocId?: string;
  activeFolderId?: string;
  activeFolderTitle?: string;
  currentUser?: string;
  hasMoreRoots?: boolean;
}

interface TreeContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  treeData,
  activeDocId,
  activeFolderId,
  activeFolderTitle,
  currentUser,
  hasMoreRoots = false,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [fullTreeData, setFullTreeData] = useState<FileNode[] | null>(null);
  const [loadingListId, setLoadingListId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const manualTogglesRef = useRef<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Subscribe to read state changes
  useEffect(() => {
    setIsHydrated(true);
    setReadIds(getReadSet(currentUser));

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string; user?: string; isRead: boolean }>;
      if (!customEvent.detail.user || customEvent.detail.user === (currentUser || 'anonymous')) {
        setReadIds((prev) => {
          const next = new Set(prev);
          if (customEvent.detail.isRead) {
            next.add(customEvent.detail.id);
          } else {
            next.delete(customEvent.detail.id);
          }
          return next;
        });
      }
    };

    window.addEventListener('resource-read-status-changed', handleUpdate);
    return () => window.removeEventListener('resource-read-status-changed', handleUpdate);
  }, [currentUser]);

  // Helper to find ancestor folder IDs for activeDocId
  const findAncestorFolderIds = (nodes: FileNode[], targetId: string, path: string[] = []): string[] | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return path;
      }
      if ((node.type === 'folder' || node.type === 'space') && node.children && node.children.length > 0) {
        const result = findAncestorFolderIds(node.children, targetId, [...path, node.id]);
        if (result) return result;
      }
    }
    return null;
  };

  const findNode = (nodes: FileNode[], targetId: string): FileNode | null => {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      if (node.children && node.children.length > 0) {
        const found = findNode(node.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  const activePath = activeDocId
    ? [...(findAncestorFolderIds(treeData, activeDocId) ?? []), activeDocId]
    : [];
  const initialListSize = 25;
  const listPageSize = 25;
  const currentTreeData = fullTreeData ?? treeData;
  const visibleNodes = (nodes: FileNode[], parentId: string) => {
    const limit = visibleCounts[parentId] ?? initialListSize;
    const visible = nodes.slice(0, limit);
    const activePathIndex = parentId === 'root' ? -1 : activePath.indexOf(parentId);
    const activeChildId = activePath[activePathIndex + 1];
    if (activeChildId && !visible.some((node) => node.id === activeChildId)) {
      const activeChild = nodes.find((node) => node.id === activeChildId);
      if (activeChild) visible.push(activeChild);
    }
    return visible;
  };

  const renderNodes = (nodes: FileNode[], parentId: string, level: number, hasMore = false) => {
    const limit = visibleCounts[parentId] ?? initialListSize;
    const canLoadMore = hasMore || nodes.length > limit;
    const loadMore = async () => {
      if (fullTreeData) {
        setVisibleCounts((previous) => ({
          ...previous,
          [parentId]: Math.min(nodes.length, limit + listPageSize),
        }));
        return;
      }

      setLoadingListId(parentId);
      try {
        const response = await fetch('/api/v1/workspace/tree');
        if (!response.ok) throw new Error('Workspace tree request failed.');
        const payload = await response.json() as { treeData: FileNode[] };
        if (!Array.isArray(payload.treeData)) throw new Error('Workspace tree response was invalid.');
        setFullTreeData(payload.treeData);
        setVisibleCounts((previous) => ({
          ...previous,
          [parentId]: limit + listPageSize,
        }));
      } catch {
        showToast('Could not load more resources. Try again.', { tone: 'warn' });
      } finally {
        setLoadingListId(null);
      }
    };
    return (
      <>
        {visibleNodes(nodes, parentId).map((node) => renderNode(node, level))}
        {canLoadMore && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="folder-tree-show-more"
            onClick={() => void loadMore()}
            disabled={loadingListId === parentId}
          >
            {loadingListId === parentId ? 'Loading resources…' : 'Show ' + listPageSize + ' more resources'}
          </Button>
        )}
      </>
    );
  };

  // Initialize tree: ONLY keep nesting of the currently-open file's ancestor path.
  // Manual user toggles (expand/collapse) persist and take precedence.
  useEffect(() => {
    if (treeData.length > 0) {
      const initialMap: Record<string, boolean> = {};

      if (activeDocId) {
        // Expand every ancestor folder between the root and the open file
        const ancestors = findAncestorFolderIds(treeData, activeDocId) || [];
        ancestors.forEach((id) => {
          initialMap[id] = true;
        });

        // If the open item is itself a folder/space, expand it so its own
        // nesting is visible (the "tree of the open file").
        const openNode = findNode(treeData, activeDocId);
        if (openNode && (openNode.type === 'folder' || openNode.type === 'space')) {
          initialMap[activeDocId] = true;
        }
      }

      // Preserve only the folders the user explicitly toggled; drop the rest
      // so previously auto-expanded sibling branches collapse cleanly.
      setExpandedFolders((prev) => {
        const manualState: Record<string, boolean> = {};
        manualTogglesRef.current.forEach((id) => {
          if (prev[id] !== undefined) manualState[id] = prev[id];
        });
        return { ...initialMap, ...manualState };
      });
    }
  }, [activeDocId, treeData]);

  // Keep the menu open for clicks inside it and provide a predictable keyboard path.
  useEffect(() => {
    if (!contextMenu) return;

    contextMenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });

    const close = () => setContextMenu(null);
    const onMouseDown = (e: MouseEvent) => {
      if (!contextMenuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        contextMenuTriggerRef.current?.focus();
        return;
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const items = Array.from(
        contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
      );
      if (items.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (activeIndex + 1) % items.length
            : (activeIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [contextMenu]);

  // Folder Toggle
  const toggleFolder = (folderId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    manualTogglesRef.current.add(folderId);

    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleOpenShare = (node: FileNode) => {
    setContextMenu(null);
    window.dispatchEvent(
      new CustomEvent('open-share-modal', {
        detail: {
          resourceId: node.id,
          title: node.title,
          type: node.type,
        },
      })
    );
  };

  const nodeUrlFor = (node: FileNode) =>
    node.type === 'folder' || node.type === 'space'
      ? `/folders/${encodeURIComponent(node.path || node.id)}`
      : `/?doc=${encodeURIComponent(node.id)}`;

  const handleCopyLink = (node: FileNode) => {
    setContextMenu(null);
    if (typeof window === 'undefined') return;
    const copy = navigator.clipboard?.writeText;
    if (!copy) {
      showToast('Clipboard access is unavailable here.', { tone: 'warn' });
      return;
    }

    const url = `${window.location.origin}${nodeUrlFor(node)}`;
    copy.call(navigator.clipboard, url)
      .then(() => showToast('Link copied.', { tone: 'success' }))
      .catch(() => showToast('Could not copy the link. Try copying the page address instead.', { tone: 'warn' }));
  };

  const handleToggleRead = (node: FileNode) => {
    setContextMenu(null);
    toggleReadState(node.id, currentUser);
  };

  const handleTreeCreate = (opts?: CreateResourceModalOptions) => {
    setContextMenu(null);
    openCreateResourceModal(opts);
  };

  const handleCreateInFolderId = (folderId: string, defaultType?: CreateResourceModalOptions['type']) => {
    handleTreeCreate({ parentFolder: folderId, type: defaultType });
  };

  const currentFolderOptions = activeFolderId ? { parentFolder: activeFolderId } : {};
  const currentFolderContext = activeFolderTitle ? ` in ${activeFolderTitle}` : '';

  const handleContextMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const row = e.currentTarget as HTMLElement;
    const rect = row.getBoundingClientRect();
    contextMenuTriggerRef.current = row.querySelector<HTMLButtonElement>('.tree-row-more');
    setContextMenu({
      x: e.clientX || rect.left,
      y: e.clientY || rect.bottom,
      node,
    });
  };

  const openRowMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTriggerRef.current = e.currentTarget as HTMLButtonElement;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: rect.left,
      y: rect.bottom + 2,
      node,
    });
  };

  const renderNode = (node: FileNode, level: number = 0) => {
    const isFolder = node.type === 'folder' || node.type === 'space';
    const isExpanded = !!expandedFolders[node.id];
    const isActive = activeDocId === node.id;
    const nodeUrl = nodeUrlFor(node);

    if (isFolder) {
      return (
        <div key={node.id} style={{ marginBottom: '4px' }} data-testid="folder-node" data-folder-id={node.id} className="tree-node-group">
          <div
            onContextMenu={(e) => handleContextMenu(node, e)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: isActive ? '1px solid var(--accent-cyan)' : '1px solid transparent',
              borderRadius: '6px',
              padding: '3px 6px',
            }}
            className={`tree-row${isActive ? ' is-active' : ''}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
              {/* Folder Accordion Toggle Arrow */}
              <button
                type="button"
                onClick={(e) => toggleFolder(node.id, e)}
                className="folder-tree-toggle"
                style={{
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  opacity: 0.8,
                }}
                title={isExpanded ? 'Collapse Folder' : 'Expand Folder'}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.title}`}
                aria-expanded={isExpanded}
                data-testid="folder-toggle"
              >
                <ChevronDown
                  size={13}
                  aria-hidden="true"
                  className={`folder-tree-chevron${isExpanded ? ' is-expanded' : ''}`}
                />
              </button>

              {/* Folder Title Link */}
              <a
                href={nodeUrl}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: node.type === 'space' ? '0.9rem' : '0.85rem',
                  fontWeight: node.type === 'space' ? 700 : 600,
                  textDecoration: 'none',
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                data-testid="folder-link"
                data-folder-path={node.path || node.id}
              >
                <span style={{ display: 'inline-flex', flex: '0 0 auto', opacity: 0.9 }}>
                  <ResourceTypeIcon type={node.type} expanded={isExpanded} />
                </span>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {node.title}
                </span>
                {readIds.has(node.id) && (
                  <span title="Marked as Read" style={{ color: 'var(--status-success)', fontSize: '0.75rem', fontWeight: 700, marginLeft: '4px' }}>✓</span>
                )}
              </a>
            </div>

            {/* Row Actions: More Menu (⋯) on hover / active */}
            <button
              type="button"
              onClick={(e) => openRowMenu(node, e)}
              className="tree-row-more"
              style={{
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '1rem',
                cursor: 'pointer',
                padding: '0 4px',
                borderRadius: '4px',
                opacity: 0.45,
                lineHeight: 1.2,
              }}
              title="More actions"
              aria-label={`More actions for ${node.title}`}
              aria-haspopup="menu"
              aria-expanded={contextMenu?.node.id === node.id}
            >
              ⋯
            </button>
          </div>

          {/* Subtree Rendering */}
          {isExpanded && node.children && node.children.length > 0 && (
            <div style={{ borderLeft: '1px solid rgba(255, 255, 255, 0.1)', marginLeft: '12px', paddingLeft: '4px', marginTop: '2px' }}>
              {renderNodes(node.children, node.id, level + 1, Boolean(node.hasMoreChildren))}
            </div>
          )}
        </div>
      );
    }

    // Resource Node (Document, PDF, Image, Canvas, Sheet, Form)
    return (
      <div key={node.id} style={{ marginBottom: '3px' }} data-testid="file-node" data-file-id={node.id} className="tree-node-group">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: isActive ? '1px solid var(--accent-cyan)' : '1px solid transparent',
            borderRadius: '6px',
            padding: '2px 4px',
          }}
          className={`tree-row${isActive ? ' is-active' : ''}`}
        >
          <a
            href={nodeUrl}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: '0.8rem',
              fontWeight: isActive ? 700 : 400,
              textDecoration: 'none',
              padding: '3px 4px',
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            className="folder-tree-doc-link"
            data-testid="file-link"
            data-resource-id={node.id}
          >
            <span style={{ display: 'inline-flex', flex: '0 0 auto' }}>
              <ResourceTypeIcon type={node.type} />
            </span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {node.title}
            </span>
            {readIds.has(node.id) && (
              <span title="Marked as Read" style={{ color: 'var(--status-success)', fontSize: '0.75rem', fontWeight: 700, marginLeft: '4px' }}>✓</span>
            )}
          </a>

          {/* Row Actions: More Menu (⋯) on hover / active */}
          <button
            type="button"
            onClick={(e) => openRowMenu(node, e)}
            className="tree-row-more"
            style={{
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0 4px',
              borderRadius: '4px',
              opacity: 0,
              lineHeight: 1.2,
            }}
            title="More actions"
            aria-label={`More actions for ${node.title}`}
            aria-haspopup="menu"
            aria-expanded={contextMenu?.node.id === node.id}
          >
            ⋯
          </button>
        </div>
      </div>
    );
  };

  const isAnonymous = !currentUser || currentUser === 'user:anonymous';

  return (
    <div className="folder-tree" data-ready={isHydrated ? 'true' : 'false'} onContextMenu={(e) => e.preventDefault()}>
        <h2 className="folder-tree-heading">{isAnonymous ? 'Shared resources' : 'Your resources'}</h2>

      {/* Frequent workspace actions */}
      {!isAnonymous && (
        <div
          className="folder-tree-actions"
          data-testid="folder-tree-actions"
        >
          <button
            type="button"
            onClick={() => handleTreeCreate({ ...currentFolderOptions, mode: 'create' })}
            className="ui-button ui-button--primary ui-button--sm"
            data-testid="tree-new-btn"
            title={`Create a note, canvas, sheet, or drawing${currentFolderContext}`}
          >
            <Plus size={14} aria-hidden="true" /> New
          </button>
          <button
            type="button"
            onClick={() => handleTreeCreate({ ...currentFolderOptions, type: 'folder' })}
            className="ui-button ui-button--secondary ui-button--sm"
            data-testid="tree-new-folder-btn"
            title={`Create a new folder${currentFolderContext}`}
          >
            <Folder size={14} aria-hidden="true" /> Folder
          </button>
          <button
            type="button"
            onClick={() => handleTreeCreate({ ...currentFolderOptions, mode: 'import' })}
            className="ui-button ui-button--secondary ui-button--sm"
            data-testid="tree-import-btn"
            title={`Upload PDF / image or import from Google Drive${activeFolderTitle ? ` into ${activeFolderTitle}` : ''}`}
          >
            <Upload size={14} aria-hidden="true" /> Import
          </button>
        </div>
      )}

      {renderNodes(currentTreeData, 'root', 0, hasMoreRoots && !fullTreeData)}

      {treeData.length === 0 && (
        <p className="folder-tree-empty">
          {isAnonymous
            ? 'No shared resources are available yet.'
            : 'No resources yet. Create a note or import a file using the actions above.'}
        </p>
      )}

      {/* Row Context / More Menu (Folders: create & import; Files: share, copy, read status) */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-testid="tree-context-menu"
          className="ui-card folder-tree-context-menu"
          role="menu"
          aria-label={`Actions for ${contextMenu.node.title}`}
          style={{
            left: Math.max(8, Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240)),
            top: Math.max(8, Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="folder-tree-context-menu__heading">
            <ResourceTypeIcon type={contextMenu.node.type} /> {contextMenu.node.title}
          </div>
          {contextMenu.node.type === 'folder' || contextMenu.node.type === 'space' ? (
            <>
              <ContextMenuItem label="New folder" icon={<FolderPlus size={15} />} onClick={() => handleCreateInFolderId(contextMenu.node.id, 'folder')} />
              <ContextMenuItem label="New note" icon={<FileText size={15} />} onClick={() => handleCreateInFolderId(contextMenu.node.id, 'document')} />
              <ContextMenuItem label="New canvas" icon={<Shapes size={15} />} onClick={() => handleCreateInFolderId(contextMenu.node.id, 'canvas')} />
              <ContextMenuItem label="New sheet" icon={<Table2 size={15} />} onClick={() => handleCreateInFolderId(contextMenu.node.id, 'sheet')} />
              <ContextMenuItem label="New diagram" icon={<PenLine size={15} />} onClick={() => handleCreateInFolderId(contextMenu.node.id, 'excalidraw')} />
              <div className="folder-tree-context-menu__separator" role="separator" />
              <ContextMenuItem label="Import or upload" icon={<Upload size={15} />} onClick={() => handleTreeCreate({ parentFolder: contextMenu.node.id, mode: 'import' })} />
              <div className="folder-tree-context-menu__separator" role="separator" />
              <ContextMenuItem label="Share and manage access" icon={<Share2 size={15} />} onClick={() => handleOpenShare(contextMenu.node)} />
              <ContextMenuItem label="Copy link" icon={<Link size={15} />} onClick={() => handleCopyLink(contextMenu.node)} />
            </>
          ) : (
            <>
              <ContextMenuItem label="Share and manage access" icon={<Share2 size={15} />} onClick={() => handleOpenShare(contextMenu.node)} />
              <ContextMenuItem label="Copy link" icon={<Link size={15} />} onClick={() => handleCopyLink(contextMenu.node)} />
              <ContextMenuItem
                label={readIds.has(contextMenu.node.id) ? 'Mark as Unread' : 'Mark as Read'}
                icon={readIds.has(contextMenu.node.id) ? <Check size={15} /> : <Circle size={15} />}
                onClick={() => handleToggleRead(contextMenu.node)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const ContextMenuItem: React.FC<{ label: string; icon: React.ReactNode; onClick: () => void }> = ({ label, icon, onClick }) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="folder-tree-context-menu__item"
    role="menuitem"
    onClick={onClick}
  >
    <span className="folder-tree-context-menu__icon" aria-hidden="true">{icon}</span>
    <span>{label}</span>
  </Button>
);
