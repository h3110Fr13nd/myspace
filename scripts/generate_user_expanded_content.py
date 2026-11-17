import os
import json

BASE_DIR = "content/user_demo"

ARTICLES = [
    # Category 1: 01_agentic_ai_systems (6 articles)
    {
        "folder": "01_agentic_ai_systems",
        "slug": "agentic-ai-edge-cloud-continuum",
        "title": "Autonomous Agentic AI Design Across the Edge-Cloud Continuum",
        "category": "Agentic AI Systems",
        "tags": ["agentic-ai", "edge-cloud-continuum", "autonomous-agents", "llm-inference", "distributed-systems"],
        "summary": "Architectural principles, Markov decision processes, and message passing protocols for distributed agentic AI spanning low-power edge nodes and high-throughput cloud clusters.",
        "wikilinks": ["multi-agent-fog-broker-coordination", "agentic-workflow-dag-orchestration", "zero-trust-agentic-rebac-security", "pdf:agentic_ai_6g_roadmap"],
        "body": """
# Autonomous Agentic AI Design Across the Edge-Cloud Continuum

The shift from monolithic centralized cloud processing to a heterogeneous **Edge-Cloud Continuum** demands intelligent, autonomous decision-making engines embedded at the network fringe. Traditional Mobile Edge Computing (MEC) architectures rely on static rule-based offloading or centralized master controllers. However, modern workloads—ranging from autonomous driving telemetry and real-time video analytics to industrial robotics—require **Agentic AI** frameworks capable of localized reasoning, dynamic self-healing, and decentralized consensus <Citation id="1" authors="V. Kumar et al." year="2026" title="Agentic AI Topologies in 6G Edge Networks" />.

<Callout type="important" title="Core Paradigm Shift">
Agentic AI nodes operate not merely as passive compute workers, but as semi-autonomous cognitive agents capable of negotiating resource allocations, evaluating real-time service-level agreements (SLAs), and dynamically migrating state without cloud master intervention.
</Callout>

## Mathematical Formulation of Distributed Agent Decision Processes

We model the multi-agent edge-cloud environment as a Multi-Agent Markov Decision Process (MAMDP) defined by the tuple:

\\[
\\mathcal{M} = \\left\\langle \\mathcal{N}, \\mathcal{S}, \\{\\mathcal{A}_i\\}_{i \\in \\mathcal{N}}, \\mathcal{P}, \\{\\mathcal{R}_i\\}_{i \\in \\mathcal{N}}, \\gamma \\right\\rangle
\\]

Where:
- \(\\mathcal{N} = \\{1, 2, \\dots, N\\}\) represents the set of autonomous agentic edge nodes.
- \(\\mathcal{S}\) is the global system state space, incorporating local CPU queue backlogs \(Q_i(t)\), wireless channel gains \(h_i(t)\), available memory \(M_i(t)\), and residual battery energy \(E_i(t)\).
- \(\\mathcal{A}_i\) is the action space for agent \(i\), where an action \(a_{i,t} = (x_{i,t}, f_{i,t}, p_{i,t})\) dictates task offloading target \(x_{i,t} \\in \\mathcal{N} \\cup \\{\\text{cloud}\\}\), local CPU operating frequency \(f_{i,t}\), and RF transmission power \(p_{i,t}\).
- \(\\mathcal{P}(s_{t+1} \\mid s_t, \\mathbf{a}_t)\) is the state transition probability matrix.
- \(\\mathcal{R}_i(s_t, \\mathbf{a}_t)\) is the scalar reward function for agent \(i\).

## Primary References & Binary PDF Specifications
- Review full paper PDF: [[pdf:agentic_ai_6g_roadmap|Agentic AI in 6G Edge Architecture Paper PDF]]
- Review legal agreement PDF: [[pdf:q3_contract|Q3 Master Service Agreement PDF]]

## Inter-Connected Knowledge Nodes
- See [[multi-agent-fog-broker-coordination|Distributed Fog Coordination]] for fog-level agent negotiation routines.
- Explore [[agentic-workflow-dag-orchestration|Agentic Workflow DAG Orchestration]] for orchestrating complex multi-stage DAG workflows.
- Consult [[zero-trust-agentic-rebac-security|Zero Trust ReBAC Governance]] for policy verification mechanisms.
"""
    },
    {
        "folder": "01_agentic_ai_systems",
        "slug": "multi-agent-fog-broker-coordination",
        "title": "Multi-Agent Fog Broker Coordination and Consensus Protocols",
        "category": "Agentic AI Systems",
        "tags": ["multi-agent", "fog-computing", "broker-coordination", "gossip-protocol", "consensus"],
        "summary": "Distributed consensus, gossip protocol message exchange, and peer-to-peer task negotiation algorithms for multi-agent fog networks.",
        "wikilinks": ["agentic-ai-edge-cloud-continuum", "byzantine-fault-tolerant-edge-consensus", "agentic-workflow-dag-orchestration", "pdf:agentic_ai_6g_roadmap"],
        "body": """
# Multi-Agent Fog Broker Coordination and Consensus Protocols

In fog computing platforms, intermediate fog brokers sit between sensor networks and cloud datacenters. When thousands of IoT devices submit concurrent jobs, fog brokers must coordinate autonomously to prevent single-point overload.

## Attached PDF Specifications
- Refer to full research report: [[pdf:agentic_ai_6g_roadmap|Agentic AI 6G Architecture Paper PDF]]

## Related Research Articles
- Read [[agentic-ai-edge-cloud-continuum|Agentic AI Across Edge-Cloud Continuum]].
- Read [[byzantine-fault-tolerant-edge-consensus|Byzantine Fault Tolerant Consensus]].
"""
    },
    {
        "folder": "02_drl_edge_scheduling",
        "slug": "dependency-graph-drl-task-offloading",
        "title": "Dependency-Aware Graph Task Offloading via Collaborative DRL",
        "category": "DRL Edge Scheduling",
        "tags": ["drl", "graph-neural-networks", "gnn-drl", "mobile-edge-computing", "task-offloading"],
        "summary": "Combining Graph Convolutional Networks (GCN) with Proximal Policy Optimization (PPO) to learn optimal DAG task offloading strategies in MEC networks.",
        "wikilinks": ["deep-reinforcement-learning-mec-frameworks", "collaborative-federated-drl-multiuser", "pdf:drl_task_offloading_spec"],
        "body": """
# Dependency-Aware Graph Task Offloading via Collaborative DRL

In Mobile Edge Computing (MEC) environments, mobile end-user devices offload computationally intensive applications—such as augmented reality (AR) rendering and real-time object detection—to nearby Multi-Access Edge Computing (MEC) servers.

## Attached PDF Asset
- Stream full technical spec: [[pdf:drl_task_offloading_spec|DRL Task Offloading Technical Spec PDF]]

## Related Links
- See [[deep-reinforcement-learning-mec-frameworks|DRL Edge Optimization Frameworks]].
- See [[collaborative-federated-drl-multiuser|Collaborative Federated DRL]].
"""
    },
    {
        "folder": "03_digital_twin_6g_iov",
        "slug": "digital-twin-empowered-6g-iov-offloading",
        "title": "Digital Twin Empowered Task Offloading in 6G Internet of Vehicles",
        "category": "Digital Twin & 6G IoV",
        "tags": ["digital-twin", "6g", "iov", "vehicular-edge", "v2x-communication"],
        "summary": "Constructing real-time Digital Twin state replicas at roadside units (RSUs) to forecast vehicle trajectories and optimize 6G IoV task offloading.",
        "wikilinks": ["mobility-aware-twin-migration-drl", "realtime-synchronization-bounds-edge-twins", "pdf:digital_twin_iov_whitepaper"],
        "body": """
# Digital Twin Empowered Task Offloading in 6G Internet of Vehicles

In 6G Internet of Vehicles (IoV) networks, autonomous vehicles traveling at high speeds generate massive telemetry streams requiring ultra-reliable low-latency communications.

## Attached Whitepaper PDF
- Stream whitepaper: [[pdf:digital_twin_iov_whitepaper|Digital Twin 6G IoV Whitepaper PDF]]

## Related Research Articles
- Read [[mobility-aware-twin-migration-drl|Mobility-Aware Digital Twin Migration]].
- Read [[realtime-synchronization-bounds-edge-twins|Real-Time Sync Bounds]].
"""
    },
    {
        "folder": "04_serverless_iiot_workflows",
        "slug": "serverless-edge-iiot-faas-workflows",
        "title": "Workflow Scheduling in Serverless Edge Computing for Industrial IoT",
        "category": "Serverless IIoT Workflows",
        "tags": ["serverless", "faas", "iiot", "industrial-iot", "workflow-scheduling", "wasm"],
        "summary": "Function-as-a-Service (FaaS) event-driven architectures, WebAssembly container sandboxing, and reinforcement learning schedulers for industrial IoT telemetry.",
        "wikilinks": ["strict-deadline-scheduling-critical-iiot", "mitigating-cold-starts-wasm-microvms", "pdf:serverless_iiot_benchmark"],
        "body": """
# Workflow Scheduling in Serverless Edge Computing for Industrial IoT

Serverless Edge Computing (FaaS) enables granular, auto-scaling compute execution where micro-functions execute only in response to explicit sensor triggers.

## Attached Benchmark PDF
- Stream benchmark report: [[pdf:serverless_iiot_benchmark|Serverless IIoT Benchmark Report PDF]]

## Related Content
- Read [[strict-deadline-scheduling-critical-iiot|Strict Hard-Deadline Scheduling]].
- Read [[mitigating-cold-starts-wasm-microvms|Mitigating Cold Starts via Wasm]].
"""
    },
    {
        "folder": "05_phy_irs_beamforming",
        "slug": "intelligent-reflecting-surfaces-mec-offloading",
        "title": "Intelligent Reflecting Surface (IRS) Assisted Edge Offloading Optimization",
        "category": "PHY & IRS Beamforming",
        "tags": ["irs", "ris", "phy-layer", "beamforming", "phase-shift-optimization", "urllc"],
        "summary": "Joint optimization of active base station transmit beamforming and passive IRS phase-shift matrices to maximize edge computation offloading rates.",
        "wikilinks": ["latency-reliability-urllc-irs-offloading", "semidefinite-relaxation-sdr-phase-optimization", "pdf:irs_beamforming_paper"],
        "body": """
# Intelligent Reflecting Surface (IRS) Assisted Edge Offloading Optimization

Intelligent Reflecting Surfaces (IRS) dynamically control the phase shift and amplitude of incident electromagnetic waves, customizing the wireless propagation channel.

## Attached Research Paper PDF
- Stream paper: [[pdf:irs_beamforming_paper|IRS Beamforming Optimization Paper PDF]]

## Connected Technical Notes
- Read [[latency-reliability-urllc-irs-offloading|URLLC Offloading via IRS]].
- Read [[semidefinite-relaxation-sdr-phase-optimization|SDR & Fractional Programming]].
"""
    }
]

def main():
    print("Updating articles with embedded PDF wikilinks...")
    for art in ARTICLES:
        folder_path = os.path.join(BASE_DIR, art["folder"])
        os.makedirs(folder_path, exist_ok=True)
        file_path = os.path.join(folder_path, f"{art['slug']}.md")
        
        tags_str = json.dumps(art["tags"])
        wikilinks_str = json.dumps(art["wikilinks"])
        
        content = f"""---
title: "{art['title']}"
date: "2026-08-11"
author: "demo"
category: "{art['category']}"
tags: {tags_str}
summary: "{art['summary']}"
wikilinks: {wikilinks_str}
---

{art['body'].strip()}
"""
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        print(f"✓ Updated: {file_path}")

    print("Successfully updated articles with PDF wikilinks!")

if __name__ == "__main__":
    main()
