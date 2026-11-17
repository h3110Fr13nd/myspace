/**
 * Universal Extensible Resource Type Registry
 * 
 * Provides a single source of truth for all workspace resource types
 * and components (documents, canvases, sheets, papers, PDFs, Google resources, etc.).
 * Enables seamless polymorphic rendering, discovery, search filtering, and ReBAC scoping.
 */

export type ResourceEditMode = 'wysiwyg' | 'none';

export interface ResourceTypeDefinition {
  type: string;
  label: string;
  icon: string;
  accentColor: string;
  category: 'document' | 'spatial' | 'data' | 'media' | 'cloud' | 'container';
  description: string;
  fileExtensions?: string[];
  canCollab?: boolean;
  canEmbed?: boolean;
  /** How this type's content is edited in the workspace. Defaults to 'none'. */
  editMode?: ResourceEditMode;
  matcher?: (item: { type?: string; id?: string; file?: string }) => boolean;
}

const registry = new Map<string, ResourceTypeDefinition>();
export const RESOURCE_REGISTRY: Record<string, ResourceTypeDefinition> = {};

/**
 * Register a new Resource Type into the workspace ecosystem.
 */
export function registerResourceType(def: ResourceTypeDefinition): void {
  registry.set(def.type.toLowerCase(), def);
  RESOURCE_REGISTRY[def.type.toLowerCase()] = def;
}

/**
 * Built-in Core Resource Type Definitions
 */
const BUILTIN_RESOURCE_TYPES: ResourceTypeDefinition[] = [
  {
    type: 'document',
    label: 'Research Note / Doc',
    icon: '📝',
    accentColor: '#00f2fe',
    category: 'document',
    description: 'Rich Markdown & MDX document with live math, wikilinks, and transclusions.',
    fileExtensions: ['.md', '.mdx', '.markdown'],
    canCollab: true,
    canEmbed: true,
    editMode: 'wysiwyg',
    matcher: (item) =>
      item.type === 'document' ||
      item.id?.startsWith('doc:') ||
      /\.(md|mdx|markdown)$/i.test(item.file || ''),
  },
  {
    type: 'canvas',
    label: 'Spatial Canvas Board',
    icon: '🎨',
    accentColor: '#00f2fe',
    category: 'spatial',
    description: 'Interactive infinite 2D canvas with JSON Canvas v1.0 standard and live node cards.',
    fileExtensions: ['.canvas'],
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      item.type === 'canvas' ||
      item.id?.startsWith('canvas:') ||
      (item.file || '').endsWith('.canvas'),
  },
  {
    type: 'sheet',
    label: 'Relational Sheet',
    icon: '📊',
    accentColor: '#10b981',
    category: 'data',
    description: 'Relational data grid with formula execution, CSV export, and dynamic queries.',
    fileExtensions: ['.sheet', '.csv', '.tsv'],
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      item.type === 'sheet' ||
      item.id?.startsWith('sheet:') ||
      /\.(sheet|csv|tsv)$/i.test(item.file || ''),
  },
  {
    type: 'paper',
    label: 'Academic Paper',
    icon: '📑',
    accentColor: '#c084fc',
    category: 'document',
    description: 'Peer-reviewed research paper with citation graphs and LaTeX formulas.',
    fileExtensions: ['.paper'],
    canCollab: false,
    canEmbed: true,
    editMode: 'wysiwyg',
    matcher: (item) =>
      Boolean(item.type === 'paper' || item.id?.startsWith('paper:')),
  },
  {
    type: 'pdf',
    label: 'PDF Document',
    icon: '📄',
    accentColor: '#ef4444',
    category: 'media',
    description: 'Adobe PDF viewer with text extraction, page jumping, and zoom controls.',
    fileExtensions: ['.pdf'],
    canCollab: false,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'pdf' ||
      item.id?.startsWith('pdf:') ||
      (item.file || '').endsWith('.pdf')),
  },
  {
    type: 'image',
    label: 'Image Asset',
    icon: '🖼️',
    accentColor: '#ec4899',
    category: 'media',
    description: 'Graphic assets, diagrams, and high-resolution figures.',
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
    canCollab: false,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'image' ||
      item.id?.startsWith('image:') ||
      /\.(png|jpe?g|webp|gif|svg)$/i.test(item.file || '')),
  },
  {
    type: 'tex',
    label: 'LaTeX Source',
    icon: '📐',
    accentColor: '#c084fc',
    category: 'document',
    description: 'LaTeX source rendered as HTML by LaTeXML.',
    fileExtensions: ['.tex'],
    canCollab: false,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'tex' || item.id?.startsWith('tex:') || (item.file || '').endsWith('.tex')),
  },
  {
    type: 'google_doc',
    label: 'Google Doc',
    icon: '📘',
    accentColor: '#4285f4',
    category: 'cloud',
    description: 'Live embedded Google Document with bidirectional OAuth sync and ReBAC sharing.',
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'google_doc' ||
      item.type === 'google-doc' ||
      item.id?.startsWith('google_doc:')),
  },
  {
    type: 'google_sheet',
    label: 'Google Sheet',
    icon: '📈',
    accentColor: '#0f9d58',
    category: 'cloud',
    description: 'Live embedded Google Spreadsheet with REST API cell ranges and tabular grid modes.',
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'google_sheet' ||
      item.type === 'google-sheet' ||
      item.id?.startsWith('google_sheet:')),
  },
  {
    type: 'form',
    label: 'Dynamic Form',
    icon: '📋',
    accentColor: '#6366f1',
    category: 'data',
    description: 'Interactive schema-driven input form with validation and PostgreSQL persistence.',
    canCollab: false,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'form' || item.id?.startsWith('form:')),
  },
  {
    type: 'bases',
    label: 'Bases Dynamic View',
    icon: '🔮',
    accentColor: '#00f2fe',
    category: 'data',
    description: 'Dynamic database-like view filtering notes by tags, categories, and frontmatter.',
    canCollab: false,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'bases' || item.id?.startsWith('bases:')),
  },
  {
    type: 'excalidraw',
    label: 'Excalidraw Sketch',
    icon: '🎨',
    accentColor: '#ec4899',
    category: 'spatial',
    description: 'Hand-drawn diagrams, whiteboard wireframes, and architectural doodles.',
    fileExtensions: ['.excalidraw', '.excalidraw.json', '.excalidraw.png', '.excalidraw.svg'],
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'excalidraw' ||
      item.id?.startsWith('excalidraw:') ||
      (item.file || '').includes('.excalidraw')),
  },
  {
    type: 'jupyter',
    label: 'Jupyter Notebook',
    icon: '🪐',
    accentColor: '#f37626',
    category: 'data',
    description: 'Interactive computational notebook with Python code, LaTeX equations, and output visual graphs.',
    fileExtensions: ['.ipynb'],
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'jupyter' ||
      item.type === 'notebook' ||
      item.id?.startsWith('jupyter:') ||
      (item.file || '').endsWith('.ipynb')),
  },
  {
    type: 'mermaid',
    label: 'Mermaid Diagram',
    icon: '📐',
    accentColor: '#6366f1',
    category: 'document',
    description: 'Text-based architectural diagrams, flowcharts, sequence graphs, and class maps.',
    fileExtensions: ['.mmd', '.mermaid'],
    canCollab: true,
    canEmbed: true,
    matcher: (item) =>
      Boolean(item.type === 'mermaid' ||
      item.id?.startsWith('mermaid:') ||
      /\.(mmd|mermaid)$/i.test(item.file || '')),
  },
  {
    type: 'folder',
    label: 'Folder Container',
    icon: '📁',
    accentColor: '#f59e0b',
    category: 'container',
    description: 'Hierarchical container holding nested notes, canvases, and assets.',
    canCollab: false,
    canEmbed: false,
    matcher: (item) =>
      Boolean(item.type === 'folder' || item.id?.startsWith('folder:')),
  },
  {
    type: 'space',
    label: 'Tenant Space',
    icon: '🪐',
    accentColor: '#8b5cf6',
    category: 'container',
    description: 'Top-level collaboration tenant workspace boundaries.',
    canCollab: false,
    canEmbed: false,
    matcher: (item) =>
      Boolean(item.type === 'space' || item.id?.startsWith('space:')),
  },
];

// Initialize builtin types
BUILTIN_RESOURCE_TYPES.forEach(registerResourceType);

/**
 * Resolves the canonical ResourceTypeDefinition for any resource, ID, or file path.
 */
export function resolveResourceType(item?: {
  type?: string;
  id?: string;
  file?: string;
  resourceType?: string;
}): ResourceTypeDefinition {
  if (!item) {
    return registry.get('document')!;
  }

  const rawType = (item.type || item.resourceType || '').toLowerCase();
  if (rawType && registry.has(rawType)) {
    return registry.get(rawType)!;
  }

  // Check matchers
  for (const def of registry.values()) {
    if (def.matcher && def.matcher(item)) {
      return def;
    }
  }

  // Check file extension
  if (item.file) {
    const ext = item.file.slice(item.file.lastIndexOf('.')).toLowerCase();
    for (const def of registry.values()) {
      if (def.fileExtensions?.includes(ext)) {
        return def;
      }
    }
  }

  // Fallback to generic document
  return (
    registry.get(rawType) ||
    registry.get('document') || {
      type: rawType || 'document',
      label: 'Document',
      icon: '📄',
      accentColor: '#00f2fe',
      category: 'document',
      description: 'Generic document resource',
    }
  );
}

/**
 * Quick helpers
 */
export function getResourceIcon(typeOrItem: string | { type?: string; id?: string; file?: string }): string {
  if (typeof typeOrItem === 'string') {
    return registry.get(typeOrItem.toLowerCase())?.icon || '📄';
  }
  return resolveResourceType(typeOrItem).icon;
}

export function getResourceAccentColor(typeOrItem: string | { type?: string; id?: string; file?: string }): string {
  if (typeof typeOrItem === 'string') {
    return registry.get(typeOrItem.toLowerCase())?.accentColor || '#00f2fe';
  }
  return resolveResourceType(typeOrItem).accentColor;
}

/**
 * Whether a resource's content is editable through the built-in WYSIWYG
 * markdown editor (driven by the registry, not per-type hardcoded branches).
 */
export function canWysiwygEdit(typeOrItem: string | { type?: string; id?: string; resourceType?: string }): boolean {
  const def = typeof typeOrItem === 'string'
    ? registry.get(typeOrItem.toLowerCase())
    : resolveResourceType(typeOrItem);
  return def?.editMode === 'wysiwyg';
}

export function listResourceTypes(): ResourceTypeDefinition[] {
  return Array.from(registry.values());
}

/**
 * User-facing create/import catalog for the unified Create & Search command UX.
 * Single source of truth — SearchModal's CREATE_COMMANDS, CreateResourceModal's
 * CREATE_TYPES, blogs TYPE_META all consume this instead of re-declaring.
 */
export type CatalogMode = 'create' | 'import';

export interface ResourceTypeCatalogEntry {
  type: string;
  mode: CatalogMode;
  label: string;
  hint: string;
  description: string;
  accent: string;
}

export const RESOURCE_TYPE_CATALOG: ResourceTypeCatalogEntry[] = [
  { type: 'document', mode: 'create', label: 'New Note / Doc', hint: 'TipTap collaborative document', description: 'Markdown & MDX research note with live math, wikilinks', accent: '#00f2fe' },
  { type: 'folder', mode: 'create', label: 'New Folder', hint: 'Organize resources into folders', description: 'Nested container for organizing vault resources', accent: '#f59e0b' },
  { type: 'canvas', mode: 'create', label: 'New Canvas Board', hint: 'Infinite grid canvas workspace', description: 'Infinite spatial board with node cards, JSON Canvas spec', accent: '#00f2fe' },
  { type: 'sheet', mode: 'create', label: 'New Relational Sheet', hint: 'Spreadsheet with relations', description: 'Tabular data grid with formula-ready CSV scaffolding', accent: '#10b981' },
  { type: 'excalidraw', mode: 'create', label: 'New Excalidraw / Diagram', hint: 'Freeform drawing & diagrams', description: 'Hand-drawn whiteboard diagrams & wireframes', accent: '#ec4899' },
  { type: 'mermaid', mode: 'create', label: 'New Mermaid Diagram', hint: 'Code-first diagrams', description: 'Text-based flowcharts, sequence & ER diagrams', accent: '#6366f1' },
  { type: 'pdf', mode: 'import', label: 'Upload PDF', hint: 'Import & persist a PDF into the vault', description: 'Bring a PDF document into the vault (binary upload)', accent: '#ef4444' },
  { type: 'image', mode: 'import', label: 'Upload Image', hint: 'Import & persist an image', description: 'PNG / JPG / WebP / SVG asset into object storage', accent: '#ec4899' },
  { type: 'google_doc', mode: 'import', label: 'Import Google Doc', hint: 'Pull a Google Docs document', description: 'Link / embed a Google Document', accent: '#4285f4' },
  { type: 'google_sheet', mode: 'import', label: 'Import Google Sheet', hint: 'Pull a Google Sheets table', description: 'Link / embed a live Google Spreadsheet', accent: '#0f9d58' },
];
