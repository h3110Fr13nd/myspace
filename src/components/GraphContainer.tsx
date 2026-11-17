import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GraphView } from './GraphView';
import { CanvasGraphView } from './CanvasGraphView';
import type { GraphViewProps } from './graph/constants';

interface GraphContainerProps {
  nodes: GraphViewProps['nodes'];
  links: GraphViewProps['links'];
  activeNodeId?: string;
  currentUser?: string;
}

export const GraphContainer: React.FC<GraphContainerProps> = ({ nodes, links, activeNodeId, currentUser }) => {
  const [engine, setEngine] = useState<'canvas' | 'svg'>('canvas');
  const [fullGraph, setFullGraph] = useState<Pick<GraphViewProps, 'nodes' | 'links'> | null>(null);
  const [fullGraphError, setFullGraphError] = useState<string | null>(null);
  const [fullGraphLoading, setFullGraphLoading] = useState(false);
  const fullGraphRequest = useRef<Promise<void> | null>(null);

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

  useEffect(() => {
    const saved = localStorage.getItem('preferred_graph_engine');
    if (saved === 'svg' || saved === 'canvas') {
      setEngine(saved);
    }
  }, []);

  return (
    <section aria-label="Workspace graph" className="workspace-graph-panel">
      {engine === 'canvas' ? (
        <CanvasGraphView
          nodes={fullGraph?.nodes ?? nodes}
          links={fullGraph?.links ?? links}
          activeNodeId={activeNodeId}
          currentUser={currentUser}
          onExpand={loadFullGraph}
          fullGraphLoading={fullGraphLoading}
          fullGraphError={fullGraphError}
        />
      ) : (
        <GraphView
          nodes={fullGraph?.nodes ?? nodes}
          links={fullGraph?.links ?? links}
          activeNodeId={activeNodeId}
          currentUser={currentUser}
          onExpand={loadFullGraph}
          fullGraphLoading={fullGraphLoading}
          fullGraphError={fullGraphError}
        />
      )}
    </section>
  );
};

