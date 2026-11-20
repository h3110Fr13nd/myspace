---
title: Canvas at Scale
slug: showcase-canvas-at-scale
category: showcase
summary: Boards with tens of thousands of cards stay smooth — only what is on screen is mounted.
tags: [showcase, canvas, performance]
is_public: true
tier: public
relationships: [complements:showcase-streaming-tiles]
---

Open the [feature showcase canvas](/?doc=canvas:feature-showcase) and pan around.

| Board | Before | After |
|---|---|---|
| Editor, 10k cards | 283k DOM nodes, input lagged **6 min** | 1.9k DOM nodes |
| Viewer, 50k cards | slowest frames 2.6 s | **33 ms** |

> [!info] The tricks
> - Only cards near the viewport are mounted.
> - Zoomed far out, cards are painted as simple rectangles.
> - While you pan, dense layers slide a snapshot and repaint when you stop.

The same ideas power the graph: see [[showcase-streaming-tiles|streaming tiles|shares techniques with]].
