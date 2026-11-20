import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { GraphView } from './GraphView';
import { CanvasGraphView } from './CanvasGraphView';
import type { GraphViewProps } from './graph/constants';
import type { GraphMetaResponse } from './graph/tiled/TiledGraphView';

// The streamed graph (WebGL renderer, tile worker) is only downloaded when a
// large graph is actually opened, so it costs nothing on ordinary page views.
const TiledGraphModal = React.lazy(() =>
  import('./graph/tiled/TiledGraphModal').then((m) => ({ default: m.TiledGraphModal }))
);

/**
 * Above this many nodes the expanded view streams tiles instead of loading the
 * whole graph into a live force simulation. Below it, the classic view is kept:
 * it is richer (live physics, filters) and cheap at that size.
 */
const TILED_MIN_NODES = 2000;

interface GraphContainerProps {
  nodes: GraphViewProps['nodes'];
  links: GraphViewProps['links'];
  activeNodeId?: string;
  currentUser?: string;
}

type ViewPreference = 'auto' | 'tiled' | 'classic';

function viewPreference(): ViewPreference {
  if (typeof window === 'undefined') return 'auto';
  const p = new URLSearchParams(window.location.search).get('graph');
  return p === 'tiled' || p === 'classic' ? p : 'auto';
}

async function fetchMeta(): Promise<GraphMetaResponse | null> {
  try {
    const res = await fetch('/api/v1/graph/meta', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const meta = (await res.json()) as GraphMetaResponse;
    return Array.isArray(meta.layers) ? meta : null;
  } catch {
    return null;
  }
}

export const GraphContainer: React.FC<GraphContainerProps> = ({ nodes, links, activeNodeId, currentUser }) => {
  const [engine, setEngine] = useState<'canvas' | 'svg'>('canvas');
  const [fullGraph, setFullGraph] = useState<Pick<GraphViewProps, 'nodes' | 'links'> | null>(null);
  const [fullGraphError, setFullGraphError] = useState<string | null>(null);
  const [fullGraphLoading, setFullGraphLoading] = useState(false);
  const fullGraphRequest = useRef<Promise<void> | null>(null);

  const [tiledMeta, setTiledMeta] = useState<GraphMetaResponse | null>(null);
  const [tiledOpen, setTiledOpen] = useState(false);
  const metaRequest = useRef<Promise<GraphMetaResponse | null> | null>(null);

  const loadMeta = useCallback(() => {
    if (!metaRequest.current) {
      metaRequest.current = fetchMeta().then((meta) => {
        setTiledMeta(meta);
        return meta;
      });
    }
    return metaRequest.current;
  }, []);

  // Fetch the (tiny) meta document while the browser is idle, so deciding which
  // view to open on click is instant.
  useEffect(() => {
    const idle =
      (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadMeta());
  }, [loadMeta]);

  const loadFullGraph = useCallback(() => {
    if (fullGraph || fullGraphRequest.current) return fullGraphRequest.current;

    setFullGraphLoading(true);
    setFullGraphError(null);
    const request = fetch('/api/v1/workspace/graph', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (response.status === 413) throw new Error('This graph is too large for the classic view.');
        if (!response.ok) throw new Error('The full workspace graph could not be loaded.');
        const graph = await response.json() as Pick<GraphViewProps, 'nodes' | 'links'>;
        if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
          throw new Error('The workspace graph response was invalid.');
        }
        setFullGraph(graph);
      })
      .catch((error: unknown) => {
        setFullGraphError(error instanceof Error ? error.message : 'The full workspace graph could not be loaded.');
        fullGraphRequest.current = null;
      })
      .finally(() => setFullGraphLoading(false));

    fullGraphRequest.current = request;
    return request;
  }, [fullGraph]);

  /** Open the streamed view instead of the classic one when the graph is large. */
  const expandOverride = useCallback(async () => {
    const preference = viewPreference();
    if (preference === 'classic') return false;
    const meta = tiledMeta ?? (await loadMeta());
    if (!meta || meta.layers.length === 0) return false;
    if (preference !== 'tiled' && meta.nodes < TILED_MIN_NODES) return false;
    setTiledOpen(true);
    return true;
  }, [loadMeta, tiledMeta]);

  const refreshMeta = useCallback(() => {
    metaRequest.current = null;
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const saved = localStorage.getItem('preferred_graph_engine');
    if (saved === 'svg' || saved === 'canvas') {
      setEngine(saved);
    }
  }, []);

  const shared = {
    nodes: fullGraph?.nodes ?? nodes,
    links: fullGraph?.links ?? links,
    activeNodeId,
    currentUser,
    onExpand: loadFullGraph,
    onExpandOverride: expandOverride,
    fullGraphLoading,
    fullGraphError,
  };

  return (
    <section aria-label="Workspace graph" className="workspace-graph-panel">
      {engine === 'canvas' ? <CanvasGraphView {...shared} /> : <GraphView {...shared} />}
      {tiledOpen && tiledMeta && (
        <Suspense fallback={null}>
          <TiledGraphModal
            open={tiledOpen}
            onClose={() => setTiledOpen(false)}
            meta={tiledMeta}
            activeNodeId={activeNodeId}
            onStaleMeta={refreshMeta}
          />
        </Suspense>
      )}
    </section>
  );
};
