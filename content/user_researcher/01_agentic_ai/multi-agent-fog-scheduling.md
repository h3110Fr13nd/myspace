---
title: "Multi-Agent Task Scheduling in Cloud-Fog Computing Platforms"
date: "2026-08-11"
author: "user_researcher"
category: "Agentic AI"
tags: ["multi-agent", "fog-computing", "task-scheduling", "q-learning"]
summary: "Multi-agent reinforcement learning strategies for dynamic task scheduling across heterogeneous cloud-fog nodes."
wikilinks: ["agentic-ai-edge-cloud-architecture", "autonomous-agent-coordination", "collaborative-drl-mobile-edge"]
---

# Multi-Agent Task Scheduling in Cloud-Fog Computing Platforms

Fog computing extends cloud capabilities closer to data sources. In a heterogeneous fog platform, scheduling dependent tasks with strict latency deadlines requires multi-agent cooperative learning <Citation id="2" authors="Fog Task Group" year="2026" title="Multi-Agent Fog Models" />.

<Callout type="note" title="Multi-Agent Negotiation">
Each fog broker acts as an autonomous RL agent maintaining a local Q-table or neural policy network. Agents communicate state representations via lightweight gossip protocols.
</Callout>

## Algorithmic Formulation

For a task graph \(G = (V, E)\), the total completion time (makespan) is defined as:

\[
T_{\text{makespan}} = \max_{v_i \in V} \left\{ T_{\text{exec}}(v_i) + T_{\text{comm}}(v_i, v_j) \right\}
\]

## Related Research Links
- See [[agentic-ai-edge-cloud-architecture]] for top-level agent designs.
- Explore [[collaborative-drl-mobile-edge]] for DRL offloading methods.
- Check [[heuristic-vs-metaheuristic-edge-schedulers]] for baseline comparison.
