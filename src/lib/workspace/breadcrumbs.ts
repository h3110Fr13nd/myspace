import { buildResourcePath } from '../resourceUrls';
import type { WorkspaceResource } from './treeBuilder';

export interface BreadcrumbItem {
  title: string;
  href?: string;
  icon: string;
}

export interface BuildBreadcrumbsOptions {
  isFolder?: boolean;
  isPdf?: boolean;
  isImage?: boolean;
  isGoogleDrive?: boolean;
}

export function buildBreadcrumbs(
  activeDoc: WorkspaceResource,
  rawResources: WorkspaceResource[],
  options: BuildBreadcrumbsOptions = {}
): BreadcrumbItem[] {
  const { isFolder = false, isPdf = false, isImage = false, isGoogleDrive = false } = options;

  const breadcrumbItems: BreadcrumbItem[] = [
    { title: 'Vault', href: '/', icon: '🏠' }
  ];

  if (activeDoc.parent_id) {
    const resourcesById = new Map(rawResources.map((resource) => [resource.id, resource]));
    const ancestors: WorkspaceResource[] = [];
    const visited = new Set<string>([activeDoc.id]);
    let parentId: string | null | undefined = activeDoc.parent_id;

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = resourcesById.get(parentId);
      if (!parent) break;
      ancestors.push(parent);
      parentId = parent.parent_id;
    }

    ancestors.reverse().forEach((ancestor) => {
      breadcrumbItems.push({
        title: ancestor.title,
        href: buildResourcePath(ancestor, ancestor.path || undefined),
        icon: '📁',
      });
    });
  } else if (activeDoc.metadata?.category) {
    breadcrumbItems.push({
      title: String(activeDoc.metadata.category),
      href: `/?doc=${encodeURIComponent(String(activeDoc.metadata.category))}`,
      icon: '📁',
    });
  }

  breadcrumbItems.push({
    title: activeDoc.title,
    icon: isFolder ? '📁' : isPdf ? '📕' : isImage ? '🖼️' : isGoogleDrive ? '☁️' : '📄',
  });

  return breadcrumbItems;
}
