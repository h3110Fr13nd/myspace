#!/usr/bin/env python3
"""
create_feature_showcase.py
Generates a comprehensive showcase canvas demonstrating every supported feature:
1. Canvas inside Canvas (nested canvas resource nodes with drill-downs)
2. Real Paper resources with interactive ReadToggle & metadata badges
3. Standalone Markdown & LaTeX Mathematical formulas (KaTeX inline and display)
4. Group container with child count badge and spatial containment
5. Group container with background image and backgroundStyle (cover)
6. External Web Link nodes with domain favicon pills
7. Workspace Document / Vault file node with subpath
8. Directional cubic bezier edges with semantic relation labels and custom color tokens
"""

import json
from pathlib import Path

def create_showcase():
    nodes = [
        # --- ROW 0: Overview & Mathematical Foundations ---
        {
            "id": "header-showcase",
            "type": "text",
            "x": 40,
            "y": 40,
            "width": 640,
            "height": 240,
            "color": "5",
            "text": """# 🌟 Universal Spatial Canvas Showcase
### Multi-Resource Knowledge Graph & Visual Studio

This canvas demonstrates all polymorphic node types, nested structures, and interactive capabilities:
- **Nested Canvases** (Canvas-in-Canvas hierarchy)
- **Interactive Research Papers** with `ReadToggle` and metadata chips
- **KaTeX Mathematical Derivations** with inline & block formulas
- **Spatial Group Containers** (nested items + background image cover)
- **External Web Links** and **Local Vault File Subpaths**"""
        },
        {
            "id": "math-foundation-note",
            "type": "text",
            "x": 720,
            "y": 40,
            "width": 580,
            "height": 240,
            "color": "6",
            "text": """### 📐 DRL Objective & Latency-Energy Tradeoff
Mathematical formulation for multi-tier edge-cloud offloading:

$$\\min_{\\mathbf{x}} \\sum_{i=1}^{N} \\left( \\alpha \\cdot T_i^{\\text{latency}}(\\mathbf{x}) + (1-\\alpha) \\cdot E_i^{\\text{energy}}(\\mathbf{x}) \\right)$$

$$\\text{subject to: } \\quad \\sum_{j \\in \\text{tiers}} x_{ij} = 1, \\quad \\text{Memory}(i) \\le M_{\\text{limit}}$$

Where $\\mathbf{x} \\in \\{0, 1\\}^{N \\times M}$ defines the binary assignment matrix."""
        },
        {
            "id": "external-spec-link",
            "type": "link",
            "x": 1340,
            "y": 40,
            "width": 380,
            "height": 240,
            "color": "3",
            "url": "https://jsoncanvas.org/spec/1.0/",
            "label": "JSON Canvas v1.0 Official Specification"
        },

        # --- ROW 1: Canvas Inside Canvas (Sub-Canvas Nodes) ---
        {
            "id": "canvas-master-root",
            "type": "resource",
            "x": 40,
            "y": 340,
            "width": 480,
            "height": 260,
            "color": "5",
            "resourceId": "canvas:master-research-walkthrough",
            "resourceType": "canvas",
            "label": "Master Walkthrough (Root Canvas)",
            "text": "Top-level orchestration graph connecting foundational surveys across all 6 research tracks."
        },
        {
            "id": "canvas-track-2-node",
            "type": "resource",
            "x": 580,
            "y": 340,
            "width": 540,
            "height": 260,
            "color": "2",
            "resourceId": "canvas:track-2-drl-workflow-scheduling",
            "resourceType": "canvas",
            "label": "Track 2: DRL & Workflow Scheduling (Sub-Canvas)",
            "text": "Deep Reinforcement Learning (PPO, SAC, DDPG) for scientific DAG workflows in fog/cloud."
        },
        {
            "id": "canvas-track-3-node",
            "type": "resource",
            "x": 1180,
            "y": 340,
            "width": 540,
            "height": 260,
            "color": "6",
            "resourceId": "canvas:track-3-agentic-ai-llm-orchestration",
            "resourceType": "canvas",
            "label": "Track 3: Agentic AI & Edge SLMs (Sub-Canvas)",
            "text": "Autonomous multi-agent orchestration, Small Language Models (SLMs), and contextual memory."
        },

        # --- ROW 2: Group 1 - Edge SLMs & Autonomous Agents ---
        {
            "id": "group-agentic-ai",
            "type": "group",
            "x": 40,
            "y": 660,
            "width": 820,
            "height": 380,
            "label": "Edge SLM & Autonomous Agent Cluster (2 Studies)",
            "color": "5"
        },
        {
            "id": "paper-node-47",
            "type": "resource",
            "x": 60,
            "y": 710,
            "width": 380,
            "height": 300,
            "color": "5",
            "resourceId": "paper:paper-47-tinyllm-evaluation-and-optimization-of-small-",
            "resourceType": "paper",
            "label": "P47: TinyLLM: Small Language Models on Edge",
            "text": "Quantized SLM execution, context window caching, and inference profiling on resource-constrained micro-edges."
        },
        {
            "id": "paper-node-50",
            "type": "resource",
            "x": 460,
            "y": 710,
            "width": 380,
            "height": 300,
            "color": "5",
            "resourceId": "paper:paper-50-agentic-llm-assisted-edge-ai-for-cpsiot-appli",
            "resourceType": "paper",
            "label": "P50: Agentic LLM Edge AI for CPS/IoT",
            "text": "Cooperative multi-agent prompt decomposition and tool calling for cyber-physical IoT systems."
        },

        # --- ROW 2: Group 2 - Collaborative Offloading (Stylized with Background Image Cover) ---
        {
            "id": "group-offloading-styled",
            "type": "group",
            "x": 900,
            "y": 660,
            "width": 820,
            "height": 380,
            "label": "Collaborative Computing & Cost Scheduling (Stylized Background)",
            "color": "2",
            "background": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1200",
            "backgroundStyle": "cover"
        },
        {
            "id": "paper-node-06",
            "type": "resource",
            "x": 920,
            "y": 710,
            "width": 380,
            "height": 300,
            "color": "2",
            "resourceId": "paper:paper-06-collaborative-deep-neural-network-inference-v",
            "resourceType": "paper",
            "label": "P06: Collaborative DNN Inference in Vehicular Edge",
            "text": "Distributed partitioning, latency optimization, and collaborative inference across edge brokers."
        },
        {
            "id": "paper-node-20",
            "type": "resource",
            "x": 1320,
            "y": 710,
            "width": 380,
            "height": 300,
            "color": "2",
            "resourceId": "paper:paper-20-energy-and-cost-aware-workflow-scheduling-in-",
            "resourceType": "paper",
            "label": "P20: Energy and Cost-Aware Workflow Scheduling",
            "text": "Multi-objective heuristics and DVFS energy-efficient scheduling in scientific cloud datacenters."
        },

        # --- ROW 3: Vault File Subpaths & Interactive Summary ---
        {
            "id": "vault-file-node",
            "type": "file",
            "x": 40,
            "y": 1100,
            "width": 460,
            "height": 200,
            "color": "4",
            "file": "content/public_vault/research/overview.md",
            "subpath": "#methodology-and-taxonomies",
            "label": "Local Vault Document with Heading Subpath"
        },
        {
            "id": "summary-takeaways-node",
            "type": "text",
            "x": 540,
            "y": 1100,
            "width": 720,
            "height": 200,
            "color": "1",
            "text": """### 💡 Key Canvas Architecture Capabilities Verified
- **Bidirectional Sync**: Visual canvas edits immediately update PostgreSQL and host `.canvas` files.
- **Sub-Canvases**: Nested canvas cards function as first-class drill-downs with live node/edge counters.
- **ReBAC-Enriched Cards**: Paper nodes dynamically resolve publication metadata, abstracts, and read statuses.
- **Standard Gestures**: Spacebar hand pan, right-click pan, 2-finger scroll, marquee select (`Shift+Drag`), and 20px grid snapping."""
        },
        {
            "id": "external-github-link",
            "type": "link",
            "x": 1300,
            "y": 1100,
            "width": 420,
            "height": 200,
            "color": "5",
            "url": "https://github.com/obsidianmd/json-canvas",
            "label": "Obsidian JSON Canvas Open Source Repository"
        }
    ]

    edges = [
        # Root to Sub-Canvases
        {
            "id": "edge-root-to-track2",
            "fromNode": "canvas-master-root",
            "fromSide": "right",
            "toNode": "canvas-track-2-node",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "orchestrates DAG scheduling",
            "color": "2"
        },
        {
            "id": "edge-track2-to-track3",
            "fromNode": "canvas-track-2-node",
            "fromSide": "right",
            "toNode": "canvas-track-3-node",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "upgrades heuristics to agents",
            "color": "6"
        },
        # Sub-Canvases to Specific Paper Clusters
        {
            "id": "edge-track3-to-paper47",
            "fromNode": "canvas-track-3-node",
            "fromSide": "bottom",
            "toNode": "paper-node-47",
            "toSide": "top",
            "toEnd": "arrow",
            "label": "deploys quantized SLMs",
            "color": "5"
        },
        {
            "id": "edge-paper47-to-paper50",
            "fromNode": "paper-node-47",
            "fromSide": "right",
            "toNode": "paper-node-50",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "collaborates in multi-agent IoT",
            "color": "5"
        },
        {
            "id": "edge-track2-to-paper06",
            "fromNode": "canvas-track-2-node",
            "fromSide": "bottom",
            "toNode": "paper-node-06",
            "toSide": "top",
            "toEnd": "arrow",
            "label": "benchmarks partitioning",
            "color": "2"
        },
        {
            "id": "edge-paper06-to-paper20",
            "fromNode": "paper-node-06",
            "fromSide": "right",
            "toNode": "paper-node-20",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "optimizes energy & cost",
            "color": "2"
        },
        # Cross-connections to Math & Spec Link
        {
            "id": "edge-header-to-math",
            "fromNode": "header-showcase",
            "fromSide": "right",
            "toNode": "math-foundation-note",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "formalizes formulation",
            "color": "6"
        },
        {
            "id": "edge-math-to-link",
            "fromNode": "math-foundation-note",
            "fromSide": "right",
            "toNode": "external-spec-link",
            "toSide": "left",
            "toEnd": "arrow",
            "label": "implements standard",
            "color": "3"
        },
        # Bottom level cross references
        {
            "id": "edge-group-to-vaultfile",
            "fromNode": "paper-node-47",
            "fromSide": "bottom",
            "toNode": "vault-file-node",
            "toSide": "top",
            "toEnd": "arrow",
            "label": "references section",
            "color": "4"
        },
        {
            "id": "edge-paper20-to-summary",
            "fromNode": "paper-node-20",
            "fromSide": "bottom",
            "toNode": "summary-takeaways-node",
            "toSide": "top",
            "toEnd": "arrow",
            "label": "validates pipeline",
            "color": "1"
        }
    ]

    data = {
        "title": "🌟 Universal Spatial Canvas: Full Feature & Resource Showcase",
        "nodes": nodes,
        "edges": edges
    }

    out_path = Path("content/public_vault/canvas/feature-showcase.canvas")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Generated {out_path} with {len(nodes)} nodes and {len(edges)} edges.")

if __name__ == "__main__":
    create_showcase()
