import { buildResourcePath } from '../resourceUrls';
import type { GraphNode, GraphLink } from '../../components/graph/constants';
import type { Backlink } from '../../components/Backlinks';
import type { WorkspaceResource } from './treeBuilder';
import { metadataRelationships, type Relationship } from '../relationships';

/** Declared (metadata) and inline (`[[t|alias|type]]`) relationships of a resource. */
function relationshipsOf(resource: WorkspaceResource): Relationship[] {
  const inline = Array.isArray(resource.metadata?.linkRelationships) ? resource.metadata.linkRelationships : [];
  return metadataRelationships({ relationships: [...metadataRelationships(resource.metadata), ...inline] });
}

/**
 * Relationships a canvas draws between two other resources (labelled edges
 * between resource cards). Both ends must be visible to the viewer — they are
 * resolved only against the viewer's own resource list.
 */
function pushCanvasEdgeLinks(
  canvas: WorkspaceResource,
  resolve: (ref: string) => WorkspaceResource | undefined,
  links: GraphLink[],
  keep: (id: string) => boolean = () => true
): void {
  const rels = canvas.metadata?.edgeRelationships;
  if (!Array.isArray(rels)) return;
  for (const rel of rels) {
    if (!rel || typeof rel.source !== 'string' || typeof rel.target !== 'string' || typeof rel.type !== 'string') continue;
    const a = resolve(rel.source);
    const b = resolve(rel.target);
    if (!a || !b || a.id === b.id || !keep(a.id) || !keep(b.id)) continue;
    links.push({ source: a.id, target: b.id, label: rel.type });
  }
}

/**
 * Named links from `resource`: one per relationship, so two notes can be joined
 * by several. Returns the target ids that got a named link, so the caller can
 * skip the plain wikilink edge to them.
 */
function pushRelationshipLinks(
  resource: WorkspaceResource,
  resolve: (ref: string) => WorkspaceResource | undefined,
  links: GraphLink[],
  keep: (targetId: string) => boolean = () => true
): Set<string> {
  const named = new Set<string>();
  for (const rel of relationshipsOf(resource)) {
    const target = resolve(rel.target);
    if (!target || target.id === resource.id || !keep(target.id)) continue;
    links.push({ source: resource.id, target: target.id, label: rel.type });
    named.add(target.id);
  }
  return named;
}

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

    // Neighbours through relationships a canvas draws between two resources.
    if (Array.isArray(resource.metadata?.edgeRelationships)) {
      for (const rel of resource.metadata.edgeRelationships) {
        const a = typeof rel?.source === 'string' ? resolveWikilink(rel.source) : undefined;
        const b = typeof rel?.target === 'string' ? resolveWikilink(rel.target) : undefined;
        if (a && b && a.id === activeNodeId) neighbourIds.add(b.id);
        else if (a && b && b.id === activeNodeId) neighbourIds.add(a.id);
      }
    }

    // Relationship-only neighbours (declared in metadata, not linked inline).
    for (const rel of relationshipsOf(resource)) {
      const target = resolveWikilink(rel.target);
      if (!target) continue;
      if (resource.id === activeNodeId) neighbourIds.add(target.id);
      else if (target.id === activeNodeId) neighbourIds.add(resource.id);
    }

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
    const named = pushRelationshipLinks(resource, resolveWikilink, links, (id) => localResources.has(id));
    pushCanvasEdgeLinks(resource, resolveWikilink, links, (id) => localResources.has(id));
    const wikilinks = resource.metadata?.wikilinks;
    if (!Array.isArray(wikilinks)) continue;
    for (const targetSlug of wikilinks) {
      if (typeof targetSlug !== 'string') continue;
      const target = resolveWikilink(targetSlug);
      if (target && localResources.has(target.id) && !named.has(target.id)) {
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

    // 2. Named relationships (possibly several per pair).
    const resolveRef = (ref: string) =>
      resolvedWikilinks.has(ref)
        ? resolvedWikilinks.get(ref)
        : resolvedWikilinks
            .set(ref, resourceBySlug.get(ref) ?? resourceById.get(ref) ?? rawResources.find((x) => x.id.includes(ref)))
            .get(ref);
    const named = pushRelationshipLinks(r, resolveRef, links);
    pushCanvasEdgeLinks(r, resolveRef, links);

    // 3. Semantic Wikilinks: Connect to referenced entities
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
        if (targetDoc && !named.has(targetDoc.id)) {
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
  const pointsHere = (slug: unknown) =>
    typeof slug === 'string' && !!slug && (activeDoc.id.includes(slug) || activeDoc.metadata?.slug === slug || slug === activeDoc.id);
  const out: Backlink[] = [];
  for (const r of rawResources) {
    if (r.id === activeDoc.id) continue;
    const linked = Array.isArray(r.metadata?.wikilinks) && r.metadata.wikilinks.some(pointsHere);
    // Named relationships pointing at this note (inline or declared).
    const relations = [...new Set(relationshipsOf(r).filter((rel) => pointsHere(rel.target)).map((rel) => rel.type))];
    if (!linked && relations.length === 0) continue;
    out.push({
      id: r.id,
      title: r.title,
      path: buildResourcePath(r, r.path || undefined),
      // Only real prose: a synthesized "Linked reference from ..." line is noise.
      excerpt: r.metadata?.summary || r.metadata?.description || '',
      slug: r.metadata?.slug,
      ...(relations.length ? { relations } : {}),
    });
  }
  return out;
}
