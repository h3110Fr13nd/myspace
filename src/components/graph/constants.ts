import * as d3 from 'd3';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  type?: 'document' | 'canvas' | 'sheet' | 'form' | 'pdf' | 'folder' | 'image' | 'paper' | 'author' | 'venue' | 'institution' | 'methodology' | 'track';
  val?: number;
  /** Pretty canonical application path (e.g. /my-note-ab12cd34ef). */
  path?: string;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  activeNodeId?: string;
  currentUser?: string;
  onNodeClick?: (nodeId: string) => void;
  onExpand?: () => void;
  fullGraphLoading?: boolean;
  fullGraphError?: string | null;
}

export const ENTITY_META: Record<string, { label: string; icon: string; color: string; defaultRadius: number }> = {
  paper: { label: 'Paper', icon: '📄', color: '#06b6d4', defaultRadius: 5 },
  author: { label: 'Author', icon: '👤', color: '#f59e0b', defaultRadius: 4.5 },
  venue: { label: 'Venue', icon: '🏛️', color: '#f43f5e', defaultRadius: 5 },
  institution: { label: 'Institution', icon: '🎓', color: '#a855f7', defaultRadius: 4.5 },
  methodology: { label: 'Algorithm', icon: '⚙️', color: '#10b981', defaultRadius: 5 },
  track: { label: 'Track', icon: '🛣️', color: '#3b82f6', defaultRadius: 6.5 },
  folder: { label: 'Folder', icon: '📁', color: '#00f2fe', defaultRadius: 7.5 },
  space: { label: 'Space', icon: '🪐', color: '#8b5cf6', defaultRadius: 6 },
  document: { label: 'Document', icon: '📝', color: '#818cf8', defaultRadius: 4 },
  canvas: { label: 'Canvas', icon: '🎨', color: '#c084fc', defaultRadius: 4.5 },
  sheet: { label: 'Sheet', icon: '📊', color: '#34d399', defaultRadius: 4.5 },
  google_sheet: { label: 'Google Sheet', icon: '📈', color: '#0f9d58', defaultRadius: 4.5 },
  google_doc: { label: 'Google Doc', icon: '📘', color: '#4285f4', defaultRadius: 4.5 },
  form: { label: 'Form', icon: '📋', color: '#6366f1', defaultRadius: 4.5 },
  pdf: { label: 'PDF', icon: '📕', color: '#fb7185', defaultRadius: 4.5 },
  image: { label: 'Image', icon: '🖼️', color: '#38bdf8', defaultRadius: 4 },
};

export const DEFAULT_PHYSICS = {
  repulsion: -200,
  gravity: 0.05,
  linkDistance: 70,
  collisionPadding: 4,
  zoomBreakpoint: 1.0,
};

export function normalizeEntityType(d: GraphNode): string {
  if (d.type === 'folder' || d.id.startsWith('folder:')) return 'folder';
  return d.type || 'document';
}

export function getNodeRadius(d: GraphNode, activeNodeId?: string, degree: number = 0): number {
  const norm = normalizeEntityType(d);
  const baseR = ENTITY_META[norm]?.defaultRadius || 4.5;
  if (d.id === activeNodeId) {
    return Math.max(8.5, baseR + 2.5 + Math.min(4, Math.sqrt(degree) * 0.8));
  }
  if (degree <= 0) return baseR;
  return baseR + Math.min(5.5, Math.sqrt(degree) * 1.0);
}

export function getNodeColor(d: GraphNode, activeNodeId?: string): string {
  if (d.id === activeNodeId) return '#00f2fe';
  const norm = normalizeEntityType(d);
  return ENTITY_META[norm]?.color || 'var(--accent-primary)';
}

export function getNodeLabel(d: GraphNode, readIds: Set<string>): string {
  const norm = normalizeEntityType(d);
  const icon = ENTITY_META[norm]?.icon ? `${ENTITY_META[norm].icon} ` : '';
  const isRead = readIds.has(d.id);
  const readBadge = isRead ? ' ✓' : '';
  const cleanTitle = d.title.length > 22 ? d.title.substring(0, 20) + '…' : d.title;
  return `${icon}${cleanTitle}${readBadge}`;
}

