import { buildResourcePath } from '../resourceUrls';
import type { GraphNode, GraphLink } from '../../components/graph/constants';
import type { Backlink } from '../../components/Backlinks';
import type { WorkspaceResource } from './treeBuilder';

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const toGraphNode = (resource: WorkspaceResource): GraphNode => ({
  id: resource.id,
  title: resource.title,
  type: (resource.metadata?.entityType || resource.type) as GraphNode['type'],
  path: buildResourcePath(resource, resource.path || undefined),
});

/**
 * Builds the small graph shown beside a resource. The sidebar is a local graph,
 * so only its active node and one-hop neighbours need to cross the SSR island
 * boundary. The full graph remains available through the authenticated graph
 * endpoint when the user expands the view.
 */
export function buildSidebarGraphData(
  rawResources: WorkspaceResource[],
  activeNodeId?: string,
  maxNodes = 25,
): GraphData {
  if (!activeNodeId) {
    const localResources = rawResources.slice(0, 20);
    return buildGraphData(localResources);
  }

  const resourceById = new Map(rawResources.map((resource) => [resource.id, resource]));
  const resourceBySlug = new Map<string, WorkspaceResource>();
  for (const resource of rawResources) {
    const slug = resource.metadata?.slug;
    if (typeof slug === 'string' && slug && !resourceBySlug.has(slug)) {
      resourceBySlug.set(slug, resource);
    }
  }

  const activeResource = resourceById.get(activeNodeId);
  if (!activeResource) return { nodes: [], links: [] };

  const resolvedWikilinks = new Map<string, WorkspaceResource | undefined>();
  const resolveWikilink = (slug: string): WorkspaceResource | undefined => {
    if (!resolvedWikilinks.has(slug)) {
      resolvedWikilinks.set(
        slug,
        resourceBySlug.get(slug)
          ?? resourceById.get(slug)
          ?? rawResources.find((resource) => resource.id.includes(slug)),
      );
    }
    return resolvedWikilinks.get(slug);
  };

  const neighbourIds = new Set<string>();
  if (activeResource.parent_id && resourceById.has(activeResource.parent_id)) {
    neighbourIds.add(activeResource.parent_id);
  }

  for (const resource of rawResources) {
    if (resource.parent_id === activeNodeId) neighbourIds.add(resource.id);

    const wikilinks = resource.metadata?.wikilinks;
    if (!Array.isArray(wikilinks)) continue;
    if (resource.id === activeNodeId) {
      for (const targetSlug of wikilinks) {
        if (typeof targetSlug !== 'string') continue;
        const target = resolveWikilink(targetSlug);
        if (target) neighbourIds.add(target.id);
      }
    } else if (wikilinks.some((targetSlug: unknown) =>
      typeof targetSlug === 'string' && resolveWikilink(targetSlug)?.id === activeNodeId
    )) {
      neighbourIds.add(resource.id);
    }
  }

  const matched = rawResources.filter((resource) =>
    resource.id === activeNodeId || neighbourIds.has(resource.id)
  );
  const ordered = [activeResource, ...matched.filter((resource) => resource.id !== activeNodeId)]
    .slice(0, Math.max(1, maxNodes));
  const localResources = new Set(ordered.map((resource) => resource.id));
  const links: GraphLink[] = [];

  for (const resource of ordered) {
    if (resource.parent_id && localResources.has(resource.parent_id)) {
      links.push({ source: resource.parent_id, target: resource.id });
    }
    const wikilinks = resource.metadata?.wikilinks;
    if (!Array.isArray(wikilinks)) continue;
    for (const targetSlug of wikilinks) {
      if (typeof targetSlug !== 'string') continue;
      const target = resolveWikilink(targetSlug);
      if (target && localResources.has(target.id)) {
        links.push({ source: resource.id, target: target.id });
      }
    }
  }

  return { nodes: ordered.map(toGraphNode), links };
}

/**
 * Builds nodes and links for force-directed graph visualizer.
 * Connects structural hierarchy (parent folders) and semantic wikilinks.
 */
export function buildGraphData(rawResources: WorkspaceResource[]): GraphData {
  const resourceIds = new Set(rawResources.map((resource) => resource.id));
  const resourceById = new Map(rawResources.map((resource) => [resource.id, resource]));
  const resourceBySlug = new Map<string, WorkspaceResource>();
  const resolvedWikilinks = new Map<string, WorkspaceResource | undefined>();
  for (const resource of rawResources) {
    const slug = resource.metadata?.slug;
    if (typeof slug === 'string' && slug && !resourceBySlug.has(slug)) {
      resourceBySlug.set(slug, resource);
    }
  }

  const nodes: GraphNode[] = rawResources.map(toGraphNode);

  const links: GraphLink[] = [];
  rawResources.forEach((r) => {
    // 1. Structural Link: Connect resource to its parent folder
    if (r.parent_id && resourceIds.has(r.parent_id)) {
      links.push({
        source: r.parent_id,
        target: r.id,
      });
    }

    // 2. Semantic Wikilinks: Connect to referenced entities
    if (r.metadata?.wikilinks && Array.isArray(r.metadata.wikilinks)) {
      r.metadata.wikilinks.forEach((targetSlug: string) => {
        let targetDoc = resolvedWikilinks.get(targetSlug);
        if (!resolvedWikilinks.has(targetSlug)) {
          // Slugs and ids are canonical references. Prefer them over substring
          // matching, which could send `[[target]]` to `target-introduction`.
          // Legacy substring resolution remains the last resort. Memoizing by
          // target avoids rescanning every resource when many notes reference
          // the same legacy slug.
          targetDoc = resourceBySlug.get(targetSlug)
            ?? resourceById.get(targetSlug)
            ?? rawResources.find((resource) => resource.id.includes(targetSlug));
          resolvedWikilinks.set(targetSlug, targetDoc);
        }
        if (targetDoc) {
          links.push({
            source: r.id,
            target: targetDoc.id,
          });
        }
      });
    }
  });

  return { nodes, links };
}

/**
 * Computes incoming backlinks referencing the active document.
 */
export function buildBacklinks(activeDoc: WorkspaceResource, rawResources: WorkspaceResource[]): Backlink[] {
  return rawResources
    .filter((r) => {
      return r.metadata?.wikilinks?.some(
        (slug: string) => activeDoc.id.includes(slug) || activeDoc.metadata?.slug === slug || slug === activeDoc.id
      );
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      path: buildResourcePath(r, r.path || undefined),
      // Only real prose: a synthesized "Linked reference from ..." line is noise.
      excerpt: r.metadata?.summary || r.metadata?.description || '',
      slug: r.metadata?.slug,
    }));
}
