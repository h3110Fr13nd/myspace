/**
 * Benchmark harness surfaces (dev-only pages under /bench). Not product UI.
 *
 *  - `TiledBench`: the streamed graph, fed by the real tile API.
 *  - `ClassicBench`: the existing force-directed view on N synthetic nodes, so
 *    its client cost can be measured at sizes the server could never serve.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { TiledGraphView, type GraphMetaResponse } from '../graph/tiled/TiledGraphView';
import { TiledGraphModal } from '../graph/tiled/TiledGraphModal';
import { CanvasGraphView } from '../CanvasGraphView';
import type { GraphLink, GraphNode } from '../graph/constants';
import { graphEdges, synthWorkspace, KIND_NAMES } from '../../../bench/lib/synth';

export const TiledBench: React.FC<{ modal?: boolean }> = ({ modal = false }) => {
  const [meta, setMeta] = useState<GraphMetaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/v1/graph/meta')
      .then((r) => r.json())
      .then((m: GraphMetaResponse) => (m.layers?.length ? setMeta(m) : setError('no tile layers built')))
      .catch(() => setError('meta unavailable'));
  }, []);
  if (error) return <p data-bench-error>{error}</p>;
  if (!meta) return <p>loading…</p>;
  if (modal) return <TiledGraphModal open onClose={() => {}} meta={meta} />;
  return (
    <div className="bench-stage" data-bench-ready>
      <TiledGraphView meta={meta} />
    </div>
  );
};

export const ClassicBench: React.FC<{ n: number }> = ({ n }) => {
  const { nodes, links } = useMemo(() => {
    const ws = synthWorkspace(n);
    const e = graphEdges(ws);
    const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
      id: ws.id(i),
      title: ws.title(i),
      type: KIND_NAMES[ws.kind[i]] as GraphNode['type'],
    }));
    const links: GraphLink[] = Array.from({ length: e.count }, (_, k) => ({
      source: ws.id(e.src[k]),
      target: ws.id(e.dst[k]),
    }));
    return { nodes, links };
  }, [n]);
  return (
    <div className="bench-stage bench-stage--classic" data-bench-ready>
      <CanvasGraphView nodes={nodes} links={links} activeNodeId={nodes[1]?.id} onNodeClick={() => {}} />
    </div>
  );
};
