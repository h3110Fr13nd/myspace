---
title: Knowledge Graphs with Named Relationships
slug: showcase-knowledge-graphs
category: showcase
summary: Links say that two notes are related; relationships say how. Several can join the same pair.
tags: [showcase, graph, relationships]
is_public: true
tier: public
relationships: [extends:showcase-start-here]
---

A plain wikilink says *these two notes are related*. A **relationship** says *how*.

## Two ways to declare one

**Inline**, with a third pipe — first the note, then what to show, then the relationship:

```markdown
The pyramid design [[showcase-streaming-tiles|builds on tiles|depends on]] and
[[showcase-streaming-tiles||is measured by]] the same note.
```

**In frontmatter**, for links that should not appear in the prose:

```yaml
relationships: [extends:showcase-start-here, cites:some-paper]
```

> [!note] Several relationships per pair
> This note both [[showcase-streaming-tiles|motivates|motivates]] and [[showcase-streaming-tiles||is implemented by]] the tiles note. In the graph, the two edges fan out as separate curves instead of overlapping.

## A little theory

For $n$ notes the number of possible undirected pairs is

$$
\binom{n}{2} = \frac{n(n-1)}{2},
$$

and with $k$ relationship types there are $k \cdot n(n-1)$ possible directed, named edges — which is why the graph view streams tiles instead of loading everything. See [[showcase-open-questions|open questions|raises]].
