---
title: Streaming a Million-Node Graph
slug: showcase-streaming-tiles
category: showcase
summary: Precomputed positions, a tile pyramid and a renderer that only draws what is on screen.
tags: [showcase, graph, performance]
is_public: true
tier: public
relationships: [answers:showcase-open-questions]
---

Opening the graph of a million-resource workspace used to cost **18 s of server CPU and 2.2 GB** per request. Now it is a **0.85 ms** tile read.

```text
resources ──► builder (worker) ──► pre-gzipped tiles
                                        │  GET /api/v1/graph/tiles/{z}/{x}/{y}
                                        ▼
                         tile worker ──► WebGL2 / Canvas2D
```

## How

- **Positions are data.** Layout runs once, in the worker; new notes are placed without moving old ones, so cached tiles stay valid.
- **A pyramid of bounded tiles.** Every tile holds at most ~1,000 nodes; far zoom levels show clusters and labelled hubs.
- **Only the screen is fetched.** Panning streams neighbouring tiles; a coarser tile stands in until the detailed one fades in.

```ts
// A tile request is a primary-key read plus a byte copy.
const tile = await readTile({ scope, generation, z, x, y });
return new Response(tile.gz, { headers: { 'Content-Encoding': 'gzip' } });
```

> [!example] Measured
> 900k-node graph in the browser: ready in ~1.6 s, 3.8 MB of JS heap, ~250 DOM nodes.

Back to [[showcase-knowledge-graphs|relationships|is used by]] or the [[showcase-start-here|tour]].
