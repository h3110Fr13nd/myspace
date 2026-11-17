import React from 'react';
import {
  Cloud,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Shapes,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getResourceIcon, resolveResourceType } from '../../lib/registry/resourceRegistry';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  document: FileText,
  spatial: Shapes,
  data: Table2,
  media: FileImage,
  cloud: Cloud,
  container: FolderTree,
};

interface ResourceTypeIconProps {
  type: string;
  size?: number;
  expanded?: boolean;
  className?: string;
}

/** Renders registry-backed resource categories with consistent SVG icons. */
export const ResourceTypeIcon: React.FC<ResourceTypeIconProps> = ({
  type,
  size = 15,
  expanded = false,
  className,
}) => {
  const category = resolveResourceType({ type }).category;
  const Icon = type === 'folder'
    ? expanded ? FolderOpen : Folder
    : type === 'space'
      ? FolderTree
      : CATEGORY_ICONS[category] || FileText;

  // Retain the catalog glyph as metadata while displaying a consistent SVG.
  return (
    <Icon
      size={size}
      strokeWidth={1.8}
      aria-hidden="true"
      className={className}
      data-resource-glyph={getResourceIcon(type)}
    />
  );
};
