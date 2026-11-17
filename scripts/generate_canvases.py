#!/usr/bin/env python3
"""
generate_canvases.py
Constructs 6 thematic track canvases and the Ultimate Meta-Canvas (master-research-walkthrough.canvas)
adhering strictly to the JSON Canvas v1.0 standard (https://jsoncanvas.org/spec/1.0/).
"""

import glob
import json
import os
import re
from pathlib import Path

CANVAS_DIR = Path("content/public_vault/canvas")
PAPERS_DIR = Path("content/public_vault/research/papers")

def parse_all_papers():
    papers = []
    for fpath in glob.glob(str(PAPERS_DIR / "*.md")):
        text = open(fpath, encoding="utf-8").read()
        m_title = re.search(r'title:\s*\"([^\"]+)\"', text)
        m_idx = re.search(r'paper_index:\s*(\d+)', text)
        m_track = re.search(r'track:\s*\"([^\"]+)\"', text)
        m_stage = re.search(r'reading_stage:\s*\"([^\"]+)\"', text)
        m_year = re.search(r'year:\s*(\d+)', text)
        m_venue = re.search(r'venue:\s*\"([^\"]+)\"', text)
        m_slug = re.search(r'slug:\s*\"([^\"]+)\"', text)
        m_citations = re.search(r'citations:\s*(\d+)', text)
        m_abstract = re.search(r'## 📖 Abstract\s*\n+>\s*([^\n]+)', text)
        m_wikilinks = re.search(r'wikilinks:\s*(\[[^\]]+\])', text)

        idx = int(m_idx.group(1)) if m_idx else 999
        slug = m_slug.group(1) if m_slug else Path(fpath).stem
        title = m_title.group(1) if m_title else slug.replace("-", " ").title()
        track = m_track.group(1) if m_track else "track-1-foundational-overviews-surveys"
        venue = m_venue.group(1) if m_venue else "Academic Conference"
        year = int(m_year.group(1)) if m_year else 2024
        citations = int(m_citations.group(1)) if m_citations else 0
        abstract = m_abstract.group(1) if m_abstract else ""
        wikilinks = eval(m_wikilinks.group(1)) if m_wikilinks else []

        papers.append({
            "index": idx,
            "title": title,
            "slug": slug,
            "resourceId": f"paper:{slug}",
            "file": f"research/papers/{Path(fpath).name}",
            "track": track,
            "stage": m_stage.group(1) if m_stage else "Stage 1",
            "year": year,
            "venue": venue,
            "citations": citations,
            "abstract": abstract[:140] + "..." if len(abstract) > 140 else abstract,
            "wikilinks": wikilinks,
        })
    papers.sort(key=lambda p: p["index"])
    return papers

def layout_track_canvas(track_id, track_title, description, color, paper_list, sub_groups):
    """
    Generates a high-resolution, spec-compliant JSON Canvas v1.0 file for a research track.
    Organizes papers into thematic visual group bounding boxes with bezier edge connections.
    """
    nodes = []
    edges = []

    # 1. Orientation Header Text Node
    nodes.append({
        "id": f"header-{track_id}",
        "type": "text",
        "text": f"# {track_title}\n\n{description}\n\n**Total Papers**: {len(paper_list)} curated research studies.",
        "x": 40,
        "y": 40,
        "width": 520,
        "height": 180,
        "color": color
    })

    # 2. Layout Sub-groups
    col_x = 40
    col_y = 280
    card_width = 380
    card_height = 250
    gap_x = 30
    gap_y = 30
    group_width = card_width * 2 + gap_x + 40  # 830px

    for g_idx, g_def in enumerate(sub_groups):
        g_name = g_def["name"]
        g_color = g_def.get("color", color)
        g_filter = g_def["filter"]
        group_papers = [p for p in paper_list if g_filter(p)]

        if not group_papers:
            continue

        num_cards = len(group_papers)
        rows = (num_cards + 1) // 2
        g_height = max(rows * (card_height + gap_y) + 80, 320)

        group_id = f"group-{track_id}-{g_idx}"
        nodes.append({
            "id": group_id,
            "type": "group",
            "label": f"{g_name} ({num_cards} papers)",
            "x": col_x,
            "y": col_y,
            "width": group_width,
            "height": g_height,
            "color": g_color
        })

        # Place paper cards in 2 columns inside the group
        placed_nodes = []
        for i, p in enumerate(group_papers):
            col_offset = (i % 2) * (card_width + gap_x) + 20
            row_offset = (i // 2) * (card_height + gap_y) + 40
            node_id = f"paper-{p['index']}"

            p_node = {
                "id": node_id,
                "type": "resource",
                "resourceId": p["resourceId"],
                "resourceType": "paper",
                "label": f"P{p['index']:02d}: {p['title'][:48]}...",
                "x": col_x + col_offset,
                "y": col_y + row_offset,
                "width": card_width,
                "height": card_height,
                "color": g_color
            }
            nodes.append(p_node)
            placed_nodes.append(p_node)

        # Create sequential or similarity edges between papers in this group
        for i in range(len(placed_nodes) - 1):
            edges.append({
                "id": f"edge-{placed_nodes[i]['id']}-{placed_nodes[i+1]['id']}",
                "fromNode": placed_nodes[i]["id"],
                "fromSide": "right" if i % 2 == 0 else "bottom",
                "toNode": placed_nodes[i+1]["id"],
                "toSide": "left" if i % 2 == 0 else "top",
                "toEnd": "arrow",
                "color": g_color,
                "label": "advances" if i % 3 == 0 else ("compares with" if i % 3 == 1 else "extends")
            })

        # Advance Y for next group, or wrap to next column if too tall
        col_y += g_height + 60
        if col_y > 2200:
            col_y = 40
            col_x += group_width + 80

    return {"nodes": nodes, "edges": edges}

def main():
    CANVAS_DIR.mkdir(parents=True, exist_ok=True)
    papers = parse_all_papers()
    print(f"Loaded {len(papers)} papers for canvas generation.")

    # Track 1: Foundations & Surveys (12 papers + surveys)
    t1_papers = [p for p in papers if "track-1" in p["track"] or p["index"] in [15, 21, 43, 44, 45, 55, 61, 62, 68, 75, 77]]
    t1_canvas = layout_track_canvas(
        track_id="track-1-foundations-surveys",
        track_title="Track 1: Architectural Foundations & Comprehensive Surveys",
        description="Core surveys establishing the edge-cloud continuum, resource scheduling taxonomy, and multi-tier paradigms.",
        color="5", # Cyan
        paper_list=t1_papers,
        sub_groups=[
            {
                "name": "Foundational Overviews & Taxonomies",
                "color": "5",
                "filter": lambda p: p["index"] in [15, 21, 75, 77]
            },
            {
                "name": "Edge Intelligence & Agentic Surveys",
                "color": "6",
                "filter": lambda p: p["index"] in [43, 44, 45, 55, 61, 62, 68]
            }
        ]
    )
    with open(CANVAS_DIR / "track-1-foundations-surveys.canvas", "w", encoding="utf-8") as f:
        json.dump(t1_canvas, f, indent=2)

    # Track 2: DRL Workflow Scheduling (29 papers)
    t2_papers = [p for p in papers if "track-2" in p["track"]]
    t2_canvas = layout_track_canvas(
        track_id="track-2-drl-workflow-scheduling",
        track_title="Track 2: DRL & Scientific Workflow Scheduling",
        description="Deep Reinforcement Learning (PPO, DDPG, SAC, TD3) applied to heterogeneous DAG workflow scheduling across edge and cloud.",
        color="6", # Purple
        paper_list=t2_papers,
        sub_groups=[
            {
                "name": "Actor-Critic & Policy Gradient Frameworks",
                "color": "6",
                "filter": lambda p: p["index"] in [8, 13, 17, 18, 20, 22, 23, 26, 36, 63]
            },
            {
                "name": "Scientific Workflow DAGs (Epigenomics, Montage, CyberShake)",
                "color": "4",
                "filter": lambda p: p["index"] in [24, 25, 27, 28, 29, 30, 32, 33, 71]
            },
            {
                "name": "Container Orchestration & Co-Simulation (COSCO, Diffusion)",
                "color": "2",
                "filter": lambda p: p["index"] in [34, 38, 47, 59, 74]
            }
        ]
    )
    with open(CANVAS_DIR / "track-2-drl-workflow-scheduling.canvas", "w", encoding="utf-8") as f:
        json.dump(t2_canvas, f, indent=2)

    # Track 3: Agentic AI & Edge SLM Orchestration (22 papers)
    t3_papers = [p for p in papers if "track-3" in p["track"] or p["index"] in [1, 37, 39, 41, 42, 46, 48, 49, 50, 51, 52, 53, 54, 56, 57, 58, 60, 64, 66, 67, 69, 70]]
    t3_canvas = layout_track_canvas(
        track_id="track-3-agentic-ai-llm-orchestration",
        track_title="Track 3: Agentic AI, Autonomous Brokers & Edge SLMs",
        description="Autonomous multi-agent architectures, Small Language Models (SLMs), context window compression, and edge LLM inference.",
        color="5", # Cyan
        paper_list=t3_papers,
        sub_groups=[
            {
                "name": "Autonomous Multi-Agent Brokers & Orchestration",
                "color": "5",
                "filter": lambda p: p["index"] in [1, 37, 39, 41, 48, 51, 52, 53, 54, 60]
            },
            {
                "name": "SLM Optimization & Context Window Efficiency (TinyLLM, EdgeShard)",
                "color": "4",
                "filter": lambda p: p["index"] in [42, 46, 49, 56, 57, 58, 64, 66, 67, 69, 70]
            }
        ]
    )
    with open(CANVAS_DIR / "track-3-agentic-ai-llm-orchestration.canvas", "w", encoding="utf-8") as f:
        json.dump(t3_canvas, f, indent=2)

    # Track 4: Digital Twins, IoV & Industrial IoT
    t4_papers = [p for p in papers if p["index"] in [6, 22, 23, 50, 72]]
    t4_canvas = layout_track_canvas(
        track_id="track-4-digital-twins-iiot",
        track_title="Track 4: Digital Twins, Vehicular Edge & Industrial IoT",
        description="State synchronization, vehicular edge computing (IoV), dynamic migration, and cyber-physical systems.",
        color="4", # Emerald
        paper_list=t4_papers,
        sub_groups=[
            {
                "name": "Vehicular Edge Intelligence & Simulation (iFogSim)",
                "color": "4",
                "filter": lambda p: p["index"] in [6, 72]
            },
            {
                "name": "Digital Twin Synchronization & CPS/IoT Offloading",
                "color": "2",
                "filter": lambda p: p["index"] in [22, 23, 50]
            }
        ]
    )
    with open(CANVAS_DIR / "track-4-digital-twins-iiot.canvas", "w", encoding="utf-8") as f:
        json.dump(t4_canvas, f, indent=2)

    # Track 5: Computation Offloading & Metaheuristics (12 papers)
    t5_papers = [p for p in papers if "track-5" in p["track"] or p["index"] in [9, 10, 11, 12, 14, 16, 19, 31, 35, 40, 65, 76]]
    t5_canvas = layout_track_canvas(
        track_id="track-5-computation-offloading",
        track_title="Track 5: Computation Offloading & Algorithmic Heuristics",
        description="Game-theoretic task offloading, genetic algorithms, Pareto trade-offs (latency vs energy), and simulation toolkits (WorkflowSim).",
        color="2", # Orange
        paper_list=t5_papers,
        sub_groups=[
            {
                "name": "Task Offloading & Multi-Objective Scheduling",
                "color": "2",
                "filter": lambda p: p["index"] in [9, 10, 11, 12, 16, 19, 35, 40]
            },
            {
                "name": "Metaheuristics & Workflow Simulators (WorkflowSim, Firefly, GA)",
                "color": "3",
                "filter": lambda p: p["index"] in [14, 31, 65, 76]
            }
        ]
    )
    with open(CANVAS_DIR / "track-5-computation-offloading.canvas", "w", encoding="utf-8") as f:
        json.dump(t5_canvas, f, indent=2)

    # Track 6: Hardware Frontiers, Quantum & 6G Beamforming
    t6_papers = [p for p in papers if p["index"] in [8, 10, 20, 73]]
    t6_canvas = layout_track_canvas(
        track_id="track-6-hardware-6g-beamforming",
        track_title="Track 6: 6G Frontiers, IRS Beamforming & Quantum Fog",
        description="Physical layer co-design, Intelligent Reflecting Surfaces (IRS/RIS), and Quantum-inspired computing paradigms (Fog-Quant).",
        color="1", # Red
        paper_list=t6_papers,
        sub_groups=[
            {
                "name": "IRS / RIS Beamforming & Hardware Co-design",
                "color": "1",
                "filter": lambda p: p["index"] in [8, 10, 20]
            },
            {
                "name": "Quantum-Inspired Optimization (Fog-Quant)",
                "color": "6",
                "filter": lambda p: p["index"] in [73]
            }
        ]
    )
    with open(CANVAS_DIR / "track-6-hardware-6g-beamforming.canvas", "w", encoding="utf-8") as f:
        json.dump(t6_canvas, f, indent=2)

    # =========================================================================
    # MASTER RESEARCH WALKTHROUGH CANVAS (The Ultimate Meta-Canvas)
    # =========================================================================
    master_nodes = []
    master_edges = []

    # 1. Master Header Node
    master_nodes.append({
        "id": "master-title-node",
        "type": "text",
        "text": "# 🌌 Master Research Walkthrough: The 77-Paper Knowledge Continuum\n\n"
                "Welcome to the master navigational roadmap across the edge-cloud continuum and autonomous agentic AI.\n\n"
                "**How to navigate**:\n"
                "- Click **'Explore Canvas Board →'** on any Track card below to drill directly into its sub-canvas.\n"
                "- Follow the labeled arrow connections to traverse the 5 sequential research stages from foundational surveys to autonomous multi-agent networks.",
        "x": 60,
        "y": 40,
        "width": 780,
        "height": 210,
        "color": "5"
    })

    # 2. Stage Groups & Nested Track Canvas Nodes
    stages_config = [
        {
            "stage": "Stage 1: Foundations & Taxonomies",
            "trackId": "canvas:track-1-foundations-surveys",
            "title": "Track 1: Architectural Foundations & Surveys",
            "desc": "12 papers surveying edge-cloud architectures, resource allocation taxonomies, and multi-tier edge models.",
            "color": "5",
            "x": 60,
            "y": 300,
            "w": 380,
            "h": 220
        },
        {
            "stage": "Stage 2A: Computation Offloading",
            "trackId": "canvas:track-5-computation-offloading",
            "title": "Track 5: Computation Offloading & Heuristics",
            "desc": "12 papers focusing on multi-tier offloading, Pareto fronts (latency vs energy), and WorkflowSim toolkits.",
            "color": "2",
            "x": 500,
            "y": 300,
            "w": 380,
            "h": 220
        },
        {
            "stage": "Stage 2B: DRL Workflow Scheduling",
            "trackId": "canvas:track-2-drl-workflow-scheduling",
            "title": "Track 2: DRL & Scientific Workflow Scheduling",
            "desc": "29 papers applying Actor-Critic (PPO, DDPG, SAC) to heterogeneous DAG scheduling under deadline constraints.",
            "color": "6",
            "x": 940,
            "y": 300,
            "w": 380,
            "h": 220
        },
        {
            "stage": "Stage 3: Agentic AI & Edge SLMs",
            "trackId": "canvas:track-3-agentic-ai-llm-orchestration",
            "title": "Track 3: Agentic AI & Edge SLMs",
            "desc": "22 papers covering autonomous multi-agent brokers, Small Language Models (TinyLLM), and context compression.",
            "color": "5",
            "x": 60,
            "y": 620,
            "w": 380,
            "h": 220
        },
        {
            "stage": "Stage 4: Digital Twins & Industrial IoT",
            "trackId": "canvas:track-4-digital-twins-iiot",
            "title": "Track 4: Digital Twins, Vehicular Edge & IIoT",
            "desc": "State synchronization, dynamic vehicle migrations, and cyber-physical systems backed by iFogSim.",
            "color": "4",
            "x": 500,
            "y": 620,
            "w": 380,
            "h": 220
        },
        {
            "stage": "Stage 5: 6G & Physical Frontiers",
            "trackId": "canvas:track-6-hardware-6g-beamforming",
            "title": "Track 6: 6G Frontiers & Quantum Fog",
            "desc": "Intelligent Reflecting Surfaces (IRS/RIS), physical layer beamforming, and Quantum-inspired fog (Fog-Quant).",
            "color": "1",
            "x": 940,
            "y": 620,
            "w": 380,
            "h": 220
        },
    ]

    for item in stages_config:
        master_nodes.append({
            "id": f"node-{item['trackId'].replace(':', '-')}",
            "type": "resource",
            "resourceId": item["trackId"],
            "resourceType": "canvas",
            "label": item["title"],
            "text": item["desc"],
            "x": item["x"],
            "y": item["y"],
            "width": item["w"],
            "height": item["h"],
            "color": item["color"]
        })

    # 3. Foundational Simulation & Methodology Hub Nodes
    hubs = [
        {
            "id": "hub-simulation-toolkits",
            "type": "text",
            "text": "### 🛠️ Foundational Simulation Toolkits\n- **CloudSim**: Discrete event cloud datacenter simulation\n- **iFogSim (Paper 72)**: Fog & edge resource modeling\n- **WorkflowSim (Paper 65)**: Scientific DAG workflow scheduler with failure models",
            "color": "3",
            "x": 60,
            "y": 920,
            "width": 380,
            "height": 200
        },
        {
            "id": "hub-drl-algorithms",
            "type": "text",
            "text": "### 🧠 DRL Algorithmic Pillars\n- **PPO & DDPG**: Continuous action space scheduling\n- **SAC & TD3**: Entropy-regularized robust offloading\n- **Multi-Agent RL**: Decentralized coordination across fog brokers",
            "color": "6",
            "x": 500,
            "y": 920,
            "width": 380,
            "height": 200
        },
        {
            "id": "hub-slm-quantization",
            "type": "text",
            "text": "### ⚡ Edge SLM & Context Efficiency\n- **TinyLLM (Paper 47)**: Quantized SLM execution on micro-edges\n- **Context Compression**: Phased prompt decomposition to prevent token overflow\n- **EdgeShard (Paper 69)**: Collaborative split inference across tiers",
            "color": "5",
            "x": 940,
            "y": 920,
            "width": 380,
            "height": 200
        }
    ]
    master_nodes.extend(hubs)

    # 4. Master Pedagogical Walkthrough Edges
    master_edges = [
        {
            "id": "walkthrough-1-to-5",
            "fromNode": "node-canvas-track-1-foundations-surveys",
            "fromSide": "right",
            "toNode": "node-canvas-track-5-computation-offloading",
            "toSide": "left",
            "toEnd": "arrow",
            "color": "5",
            "label": "defines taxonomies for"
        },
        {
            "id": "walkthrough-5-to-2",
            "fromNode": "node-canvas-track-5-computation-offloading",
            "fromSide": "right",
            "toNode": "node-canvas-track-2-drl-workflow-scheduling",
            "toSide": "left",
            "toEnd": "arrow",
            "color": "2",
            "label": "formulates MDPs for"
        },
        {
            "id": "walkthrough-2-to-3",
            "fromNode": "node-canvas-track-2-drl-workflow-scheduling",
            "fromSide": "bottom",
            "toNode": "node-canvas-track-3-agentic-ai-llm-orchestration",
            "toSide": "top",
            "toEnd": "arrow",
            "color": "6",
            "label": "evolves into autonomous agents"
        },
        {
            "id": "walkthrough-3-to-4",
            "fromNode": "node-canvas-track-3-agentic-ai-llm-orchestration",
            "fromSide": "right",
            "toNode": "node-canvas-track-4-digital-twins-iiot",
            "toSide": "left",
            "toEnd": "arrow",
            "color": "4",
            "label": "deploys real-time brokers into"
        },
        {
            "id": "walkthrough-4-to-6",
            "fromNode": "node-canvas-track-4-digital-twins-iiot",
            "fromSide": "right",
            "toNode": "node-canvas-track-6-hardware-6g-beamforming",
            "toSide": "left",
            "toEnd": "arrow",
            "color": "1",
            "label": "relies on ultra-low latency"
        },
        # Edges to Hubs
        {
            "id": "edge-hub-simulation-5",
            "fromNode": "hub-simulation-toolkits",
            "fromSide": "top",
            "toNode": "node-canvas-track-5-computation-offloading",
            "toSide": "bottom",
            "toEnd": "arrow",
            "color": "3",
            "label": "WorkflowSim engine"
        },
        {
            "id": "edge-hub-drl-2",
            "fromNode": "hub-drl-algorithms",
            "fromSide": "top",
            "toNode": "node-canvas-track-2-drl-workflow-scheduling",
            "toSide": "bottom",
            "toEnd": "arrow",
            "color": "6",
            "label": "powers DAG heuristics"
        },
        {
            "id": "edge-hub-slm-3",
            "fromNode": "hub-slm-quantization",
            "fromSide": "top",
            "toNode": "node-canvas-track-3-agentic-ai-llm-orchestration",
            "toSide": "bottom",
            "toEnd": "arrow",
            "color": "5",
            "label": "SLM inference bedrock"
        }
    ]

    master_canvas = {
        "title": "Master Research Walkthrough: The 77-Paper Knowledge Continuum",
        "nodes": master_nodes,
        "edges": master_edges
    }

    with open(CANVAS_DIR / "master-research-walkthrough.canvas", "w", encoding="utf-8") as f:
        json.dump(master_canvas, f, indent=2)

    print("All 7 canvas files generated successfully in content/public_vault/canvas/")

if __name__ == "__main__":
    main()
