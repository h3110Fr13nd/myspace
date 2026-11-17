import { isUnlistedResource } from '../visibility';

export interface WorkspaceResource {
  id: string;
  type: string;
  parent_id?: string | null;
  owner_id?: string | null;
  path?: string | null;
  title: string;
  metadata?: any;
  is_public?: boolean;
  is_draft?: boolean;
}

export interface TreeNode {
  id: string;
  type: string;
  title: string;
  path?: string | null;
  children: TreeNode[];
  hasMoreChildren?: boolean;
}

export interface TreePreview {
  nodes: TreeNode[];
  hasMoreRoots: boolean;
}

/**
 * Prunes folders and spaces that have no accessible child resources.
 */
export function pruneEmptyFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => {
    if (n.type === 'folder' || n.type === 'space') {
      n.children = pruneEmptyFolders(n.children || []);
      return n.children.length > 0;
    }
    return true;
  });
}

/**
 * Builds the folder tree hierarchy, hiding unlisted resources from non-owners
 * and pruning empty folders.
 */
export function buildTree(resources: WorkspaceResource[], currentUser: string = 'user:anonymous'): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  resources.forEach((r) => {
    const isOwner = r.owner_id === currentUser;
    const isContainer = r.type === 'folder' || r.type === 'space';
    // Shared with the reader and the search index: a note hidden from the tree
    // must also be hidden from search, or the tree is the only thing enforcing
    // it. See `src/lib/visibility.ts`.
    const isUnlisted = isUnlistedResource(r);
    // Hide unlisted from public tree explorer
    if (isUnlisted && !isOwner) return;

    map.set(r.id, {
      id: r.id,
      type: r.type,
      title: r.is_draft ? `[Draft] ${r.title}` : r.title,
      ...(isContainer && r.path ? { path: r.path } : {}),
      children: [],
    });
  });

  resources.forEach((r) => {
    const node = map.get(r.id);
    if (!node) return;
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return pruneEmptyFolders(roots);
}

/** Build a small SSR tree payload while retaining the active resource path. */
export function buildTreePreview(
  resources: WorkspaceResource[],
  currentUser: string,
  activeResourceId?: string,
  pageSize = 25,
): TreePreview {
  const fullTree = buildTree(resources, currentUser);
  const findPath = (nodes: TreeNode[], id: string, path: string[] = []): string[] | null => {
    for (const node of nodes) {
      const nextPath = [...path, node.id];
      if (node.id === id) return nextPath;
      const childPath = findPath(node.children, id, nextPath);
      if (childPath) return childPath;
    }
    return null;
  };
  const activePath = activeResourceId ? findPath(fullTree, activeResourceId) ?? [] : [];
  const pathIndexById = new Map(activePath.map((id, index) => [id, index]));

  const trimList = (nodes: TreeNode[], activeChildId?: string) => {
    const visible = nodes.slice(0, pageSize);
    if (activeChildId && !visible.some((node) => node.id === activeChildId)) {
      const activeChild = nodes.find((node) => node.id === activeChildId);
      if (activeChild) visible.push(activeChild);
    }
    return {
      nodes: visible,
      hasMore: nodes.length > visible.length,
    };
  };

  const trimNode = (node: TreeNode): TreeNode => {
    const pathIndex = pathIndexById.get(node.id) ?? -1;
    const children = trimList(node.children, activePath[pathIndex + 1]);
    return {
      ...node,
      children: children.nodes.map(trimNode),
      hasMoreChildren: children.hasMore,
    };
  };

  const roots = trimList(fullTree, activePath[0]);
  return {
    nodes: roots.nodes.map(trimNode),
    hasMoreRoots: roots.hasMore,
  };
}
