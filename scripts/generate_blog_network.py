import os
import json

BASE_DIR = "content/user_researcher"

ARTICLES = [
    # 01 Agentic AI
    {
        "folder": "01_agentic_ai",
        "slug": "agentic-ai-edge-cloud-architecture",
        "title": "Agentic AI Across Edge and Cloud Architecture",
        "category": "Agentic AI",
        "tags": ["agentic-ai", "edge-computing", "cloud-orchestration", "llm-agents"],
        "summary": "Exploring the paradigm shift towards autonomous agentic AI designs distributed across edge and cloud topologies.",
        "wikilinks": ["multi-agent-fog-scheduling", "autonomous-agent-coordination", "edge-computing-scheduling-taxonomy"],
        "body": """
# Agentic AI Across Edge and Cloud Architecture

The integration of **Agentic AI** across distributed edge-cloud continua represents a paradigm shift from passive inference pipelines to autonomous, goal-oriented multi-agent collaboration. Traditional mobile edge computing (MEC) offloading models rely on centralized schedulers; agentic architectures empower individual nodes with cognitive reasoning capabilities <Citation id="1" authors="Agentic AI Consortium" year="2026" title="Towards Agentic AI Design" />.

<Callout type="important" title="Key Architectural Principle">
Agentic AI nodes operate as semi-autonomous entities that continuously negotiate task delegation, resource partitioning, and policy evaluation without constant cloud master roundtrips.
</Callout>

## Mathematical System Model

We model the multi-agent edge-cloud environment as a Markov Decision Process (MDP) tuple \(\mathcal{M} = \langle \mathcal{S}, \mathcal{A}, \mathcal{P}, \mathcal{R}, \gamma \rangle\):

\\[
\max_{\pi} \mathbb{E} \left[ \\sum_{t=0}^{\\infty} \\gamma^t \\mathcal{R}(s_t, a_t) \\right]
\\]

Where state \(s_t \\in \\mathcal{S}\) represents node energy levels, network bandwidth, and local queue backlogs. Actions \(a_t \\in \\mathcal{A}\) denote local execution, peer-edge offloading, or cloud delegation.

## Interconnected Concepts
- See [[multi-agent-fog-scheduling]] for distributed fog coordination algorithms.
- See [[autonomous-agent-coordination]] for consensus protocols.
- Refer to [[edge-computing-scheduling-taxonomy]] for taxonomy placement.
"""
    },
    {
        "folder": "01_agentic_ai",
        "slug": "multi-agent-fog-scheduling",
        "title": "Multi-Agent Task Scheduling in Cloud-Fog Computing Platforms",
        "category": "Agentic AI",
        "tags": ["multi-agent", "fog-computing", "task-scheduling", "q-learning"],
        "summary": "Multi-agent reinforcement learning strategies for dynamic task scheduling across heterogeneous cloud-fog nodes.",
        "wikilinks": ["agentic-ai-edge-cloud-architecture", "autonomous-agent-coordination", "collaborative-drl-mobile-edge"],
        "body": """
# Multi-Agent Task Scheduling in Cloud-Fog Computing Platforms

Fog computing extends cloud capabilities closer to data sources. In a heterogeneous fog platform, scheduling dependent tasks with strict latency deadlines requires multi-agent cooperative learning <Citation id="2" authors="Fog Task Group" year="2026" title="Multi-Agent Fog Models" />.

<Callout type="note" title="Multi-Agent Negotiation">
Each fog broker acts as an autonomous RL agent maintaining a local Q-table or neural policy network. Agents communicate state representations via lightweight gossip protocols.
</Callout>

## Algorithmic Formulation

For a task graph \(G = (V, E)\), the total completion time (makespan) is defined as:

\\[
T_{\\text{makespan}} = \\max_{v_i \\in V} \\left\\{ T_{\\text{exec}}(v_i) + T_{\\text{comm}}(v_i, v_j) \\right\\}
\\]

## Related Research Links
- See [[agentic-ai-edge-cloud-architecture]] for top-level agent designs.
- Explore [[collaborative-drl-mobile-edge]] for DRL offloading methods.
- Check [[heuristic-vs-metaheuristic-edge-schedulers]] for baseline comparison.
"""
    },
    {
        "folder": "01_agentic_ai",
        "slug": "autonomous-agent-coordination",
        "title": "Autonomous Agent Coordination & Consensus in Edge Topologies",
        "category": "Agentic AI",
        "tags": ["consensus", "byzantine-fault-tolerance", "edge-nodes"],
        "summary": "Consensus protocols and state synchronization methods for edge-based agentic intelligence.",
        "wikilinks": ["agentic-ai-edge-cloud-architecture", "multi-agent-fog-scheduling", "security-privacy-edge-offloading"],
        "body": """
# Autonomous Agent Coordination & Consensus in Edge Topologies

When distributed agents manage critical infrastructure, consensus must be achieved in sub-millisecond intervals under dynamic network partition risks.

<Callout type="warning" title="Network Partition Risk">
Edge links are prone to intermittent disconnections. Consensus algorithms must tolerate network partitions while maintaining state consistency.
</Callout>

## Consensus Delay Equation

\\[
D_{\\text{consensus}} = 2 \\cdot T_{\\text{prop}} + T_{\\text{verify}} + O(\\log N)
\\]

## Cross References
- Read [[security-privacy-edge-offloading]] for security constraints.
- See [[agentic-ai-edge-cloud-architecture]] for background on agentic nodes.
"""
    },
    {
        "folder": "01_agentic_ai",
        "slug": "agent-workflow-orchestration",
        "title": "Agentic Workflow Orchestration for Heterogeneous Tasks",
        "category": "Agentic AI",
        "tags": ["workflow", "orchestration", "dag", "task-dependencies"],
        "summary": "Orchestrating complex Directed Acyclic Graph (DAG) workflows using multi-agent negotiation.",
        "wikilinks": ["multi-agent-fog-scheduling", "dependency-graph-drl-offloading", "cost-effective-tight-deadline-scheduling"],
        "body": """
# Agentic Workflow Orchestration for Heterogeneous Tasks

Complex workflows (such as video analytics or industrial telemetry) consist of inter-dependent tasks structured as Directed Acyclic Graphs (DAGs).

<Callout type="tip" title="DAG Dependency Resolution">
Predecessor task outputs must be transmitted over high-bandwidth links before successor tasks can execute on downstream edge nodes.
</Callout>

## Related Notes
- Link to [[dependency-graph-drl-offloading]] for DRL-driven DAG offloading.
- Link to [[cost-effective-tight-deadline-scheduling]] for deadline-constrained DAGs.
"""
    },

    # 02 DRL Offloading
    {
        "folder": "02_drl_offloading",
        "slug": "dependency-graph-drl-offloading",
        "title": "Dependency-Aware Graph Task Offloading via DRL",
        "category": "DRL Offloading",
        "tags": ["drl", "dag", "mobile-edge-computing", "deep-q-network"],
        "summary": "Deep Reinforcement Learning frameworks for dependency-aware DAG task offloading in mobile edge computing.",
        "wikilinks": ["reinforcement-learning-edge-optimization", "collaborative-drl-mobile-edge", "state-action-spaces-mec"],
        "body": """
# Dependency-Aware Graph Task Offloading via DRL

Mobile Edge Computing (MEC) enables resource-constrained mobile devices to offload computation-heavy DAG tasks to nearby edge servers.

<Callout type="important" title="Dependency-Aware Offloading">
Ignoring task dependencies leads to deadlock and idle CPU cycles. Graph Neural Networks (GNNs) combined with DRL capture structural DAG topologies.
</Callout>

## Optimization Objective

\\[
\\min_{\\mathbf{a}} \\sum_{i=1}^{N} \\left( \\alpha T_i(\\mathbf{a}) + \\beta E_i(\\mathbf{a}) \\right)
\\]

Where \(T_i\) is task latency and \(E_i\) is device energy consumption.

## Related Content
- See [[reinforcement-learning-edge-optimization]] for algorithmic details.
- See [[collaborative-drl-mobile-edge]] for collaborative multi-node DRL.
- See [[q-learning-vs-actor-critic-edge]] for performance trade-offs.
"""
    },
    {
        "folder": "02_drl_offloading",
        "slug": "reinforcement-learning-edge-optimization",
        "title": "Reinforcement Learning Frameworks for Edge Optimization",
        "category": "DRL Offloading",
        "tags": ["reinforcement-learning", "dqn", "ppo", "resource-allocation"],
        "summary": "A comprehensive review of Deep Q-Networks (DQN) and Proximal Policy Optimization (PPO) applied to MEC resource allocation.",
        "wikilinks": ["dependency-graph-drl-offloading", "q-learning-vs-actor-critic-edge", "state-action-spaces-mec"],
        "body": """
# Reinforcement Learning Frameworks for Edge Optimization

Reinforcement learning provides model-free adaptive decision making for non-stationary wireless environments.

<Callout type="note" title="Continuous vs Discrete Action Spaces">
DQN handles discrete offloading decisions (e.g. node selection), while PPO/DDPG controls continuous variables such as transmit power and bandwidth allocation.
</Callout>

## Key Links
- Refer to [[dependency-graph-drl-offloading]] for DAG offloading.
- Refer to [[q-learning-vs-actor-critic-edge]] for comparative analysis.
"""
    },
    {
        "folder": "02_drl_offloading",
        "slug": "collaborative-drl-mobile-edge",
        "title": "Collaborative DRL for Multi-User Mobile Edge Systems",
        "category": "DRL Offloading",
        "tags": ["collaborative-learning", "federated-drl", "mec"],
        "summary": "Collaborative Deep Reinforcement Learning for joint computation offloading and radio resource allocation.",
        "wikilinks": ["dependency-graph-drl-offloading", "reinforcement-learning-edge-optimization", "profit-maximized-collaborative-offloading"],
        "body": """
# Collaborative DRL for Multi-User Mobile Edge Systems

When multiple mobile users share edge server resources, competition for CPU cycles and radio channels requires collaborative learning algorithms.

## Links
- Compare with [[profit-maximized-collaborative-offloading]].
- See [[state-action-spaces-mec]].
"""
    },
    {
        "folder": "02_drl_offloading",
        "slug": "state-action-spaces-mec",
        "title": "Formulating State and Action Spaces in Mobile Edge Computing",
        "category": "DRL Offloading",
        "tags": ["mdp", "state-space", "action-space", "mec-modeling"],
        "summary": "Best practices for designing state, action, and reward representations for MEC DRL agents.",
        "wikilinks": ["reinforcement-learning-edge-optimization", "dependency-graph-drl-offloading"],
        "body": """
# Formulating State and Action Spaces in Mobile Edge Computing

Designing effective reward functions is critical to prevent DRL policy divergence or local optima stagnation.

\\[
R_t = - \\left( \\omega_t T_{\\text{total}} + \\omega_e E_{\\text{total}} + \\text{Penalty}_{\\text{deadline}} \\right)
\\]

## Related Notes
- See [[reinforcement-learning-edge-optimization]].
"""
    },
    {
        "folder": "02_drl_offloading",
        "slug": "q-learning-vs-actor-critic-edge",
        "title": "Q-Learning vs. Actor-Critic Methods in Edge Schedulers",
        "category": "DRL Offloading",
        "tags": ["q-learning", "actor-critic", "a2c", "ppo", "benchmarks"],
        "summary": "Comparative benchmark evaluation between value-based Q-learning and policy-gradient Actor-Critic methods in edge scheduling.",
        "wikilinks": ["reinforcement-learning-edge-optimization", "dependency-graph-drl-offloading"],
        "body": """
# Q-Learning vs. Actor-Critic Methods in Edge Schedulers

Evaluation of value-based vs policy-gradient algorithms under varying network churn.

## Links
- Related to [[reinforcement-learning-edge-optimization]].
"""
    },

    # 03 Digital Twins
    {
        "folder": "03_digital_twins",
        "slug": "digital-twin-6g-iov-offloading",
        "title": "Digital Twin Empowered Task Offloading in 6G Internet of Vehicles",
        "category": "Digital Twins",
        "tags": ["digital-twin", "6g", "iov", "vehicular-edge"],
        "summary": "Leveraging Digital Twins to predict vehicular trajectories and optimize computation offloading in 6G IoV networks.",
        "wikilinks": ["mobility-aware-twin-migration", "realtime-synchronization-edge-twins", "predictive-migration-drl"],
        "body": """
# Digital Twin Empowered Task Offloading in 6G Internet of Vehicles

In 6G Internet of Vehicles (IoV), high mobility causes rapid topology changes. Digital Twins (DTs) mirrored at edge base stations maintain real-time virtual state replicas of physical vehicles.

<Callout type="important" title="Digital Twin Synchronization">
Digital Twins predict vehicle positions and channel states, enabling proactive offloading before handovers occur.
</Callout>

\\[
\\text{DT}_{\\text{error}} = \\| S_{\\text{physical}}(t) - S_{\\text{twin}}(t) \\|^2
\\]

## Related Research Links
- See [[mobility-aware-twin-migration]] for twin migration algorithms.
- See [[realtime-synchronization-edge-twins]] for sync latency bounds.
"""
    },
    {
        "folder": "03_digital_twins",
        "slug": "mobility-aware-twin-migration",
        "title": "Mobility-Aware Digital Twin Migrations in Edge Computing",
        "category": "Digital Twins",
        "tags": ["digital-twin-migration", "drl", "mobility-management"],
        "summary": "Deep Reinforcement Learning strategies for mobility-aware Digital Twin migration across edge micro-datacenters.",
        "wikilinks": ["digital-twin-6g-iov-offloading", "predictive-migration-drl", "realtime-synchronization-edge-twins"],
        "body": """
# Mobility-Aware Digital Twin Migrations in Edge Computing

As users move across cell coverage areas, their Digital Twins must migrate between edge servers to maintain low-latency interactions.

<Callout type="warning" title="Migration Overhead">
Migrating DT state consumes backhaul bandwidth. The scheduler must balance migration latency against backhaul congestion.
</Callout>

## Links
- Related to [[digital-twin-6g-iov-offloading]].
- See [[predictive-migration-drl]] for predictive algorithms.
"""
    },
    {
        "folder": "03_digital_twins",
        "slug": "realtime-synchronization-edge-twins",
        "title": "Real-Time Synchronization Bounds for Edge Digital Twins",
        "category": "Digital Twins",
        "tags": ["synchronization", "latency-bounds", "edge-twins"],
        "summary": "Mathematical bounds for state synchronization latency between physical edge entities and their digital twins.",
        "wikilinks": ["digital-twin-6g-iov-offloading", "mobility-aware-twin-migration"],
        "body": """
# Real-Time Synchronization Bounds for Edge Digital Twins

Derivation of synchronization refresh rates necessary to preserve twin fidelity.

## Related Notes
- See [[digital-twin-6g-iov-offloading]].
"""
    },
    {
        "folder": "03_digital_twins",
        "slug": "predictive-migration-drl",
        "title": "Predictive State Migration via Deep Reinforcement Learning",
        "category": "Digital Twins",
        "tags": ["predictive-migration", "drl", "edge-state"],
        "summary": "Proactive state migration using LSTM-DRL neural network architectures in mobile edge networks.",
        "wikilinks": ["mobility-aware-twin-migration", "digital-twin-6g-iov-offloading"],
        "body": """
# Predictive State Migration via Deep Reinforcement Learning

Using LSTM networks to forecast mobility vectors and trigger background DT state replication.

## Related Notes
- See [[mobility-aware-twin-migration]].
"""
    },

    # 04 Serverless IIoT
    {
        "folder": "04_serverless_iiot",
        "slug": "serverless-edge-iiot-workflows",
        "title": "Workflow Scheduling in Serverless Edge Computing for IIoT",
        "category": "Serverless IIoT",
        "tags": ["serverless", "iiot", "industrial-internet-of-things", "faas"],
        "summary": "Learning-based workflow scheduling in serverless edge environments for Industrial IoT applications.",
        "wikilinks": ["industrial-iot-deadline-scheduling", "cold-start-mitigation-edge-functions", "event-driven-iiot-orchestration"],
        "body": """
# Workflow Scheduling in Serverless Edge Computing for IIoT

Function-as-a-Service (FaaS) event-driven architectures enable fine-grained serverless scaling for Industrial IoT (IIoT) sensors.

<Callout type="tip" title="Serverless Granularity">
Serverless functions execute in isolated micro-VMs or WebAssembly (Wasm) runtimes, charging execution fees per millisecond.
</Callout>

## Links
- Read [[industrial-iot-deadline-scheduling]] for deadline controls.
- Read [[cold-start-mitigation-edge-functions]] for cold start reduction.
"""
    },
    {
        "folder": "04_serverless_iiot",
        "slug": "industrial-iot-deadline-scheduling",
        "title": "Strict Deadline Scheduling for Critical IIoT Sensor Streams",
        "category": "Serverless IIoT",
        "tags": ["iiot", "hard-deadlines", "realtime-systems"],
        "summary": "Hard deadline guarantee mechanisms for industrial telemetry processing pipelines.",
        "wikilinks": ["serverless-edge-iiot-workflows", "cost-effective-tight-deadline-scheduling"],
        "body": """
# Strict Deadline Scheduling for Critical IIoT Sensor Streams

Industrial automation requires deterministic latency bounds (\(< 5\\text{ms}\)).

## Cross References
- Compare with [[cost-effective-tight-deadline-scheduling]].
"""
    },
    {
        "folder": "04_serverless_iiot",
        "slug": "cold-start-mitigation-edge-functions",
        "title": "Mitigating Cold Starts in Serverless Edge Functions",
        "category": "Serverless IIoT",
        "tags": ["cold-start", "serverless", "wasm", "micro-vm"],
        "summary": "Warm pool management and WebAssembly sandbox optimization for sub-millisecond edge function invocation.",
        "wikilinks": ["serverless-edge-iiot-workflows"],
        "body": """
# Mitigating Cold Starts in Serverless Edge Functions

Warm-container pre-warming techniques tailored for industrial event bursts.
"""
    },
    {
        "folder": "04_serverless_iiot",
        "slug": "event-driven-iiot-orchestration",
        "title": "Event-Driven Orchestration in Smart Manufacturing",
        "category": "Serverless IIoT",
        "tags": ["event-driven", "smart-factory", "mqtt", "kafka"],
        "summary": "Integrating MQTT/Kafka event buses with serverless edge execution pipelines.",
        "wikilinks": ["serverless-edge-iiot-workflows"],
        "body": """
# Event-Driven Orchestration in Smart Manufacturing

Integrating Pub/Sub messaging with lightweight serverless functions.
"""
    },

    # 05 PHY IRS Offloading
    {
        "folder": "05_phy_irs_offloading",
        "slug": "intelligent-reflecting-surfaces-mec",
        "title": "Intelligent Reflecting Surface (IRS) Assisted Edge Offloading",
        "category": "PHY & IRS Offloading",
        "tags": ["irs", "ris", "phy-layer", "beamforming"],
        "summary": "Joint phase-shift and computation offloading optimization in IRS-assisted mobile edge computing.",
        "wikilinks": ["latency-reliability-irs-offloading", "beamforming-phase-shift-optimization", "hybrid-redundancy-reliable-edge"],
        "body": """
# Intelligent Reflecting Surface (IRS) Assisted Edge Offloading

Intelligent Reflecting Surfaces (IRS / RIS) reconfigure wireless propagation environments using passive phase-shifter arrays.

<Callout type="important" title="IRS Channel Enhancement">
IRS overcomes line-of-sight blockage between mobile devices and edge base stations, boosting offloading data rates.
</Callout>

\\[
y = \\left( \\mathbf{h}_d^H + \\mathbf{h}_r^H \\mathbf{\\Theta} \\mathbf{G} \\right) \\mathbf{x} + n
\\]

Where \(\\mathbf{\\Theta} = \\text{diag}(e^{j \\theta_1}, \\dots, e^{j \\theta_M})\) is the IRS phase shift matrix.

## Links
- See [[latency-reliability-irs-offloading]].
- See [[beamforming-phase-shift-optimization]].
"""
    },
    {
        "folder": "05_phy_irs_offloading",
        "slug": "latency-reliability-irs-offloading",
        "title": "Latency and Reliability Aware Edge Offloading via IRS",
        "category": "PHY & IRS Offloading",
        "tags": ["irs", "latency", "reliability", "urllc"],
        "summary": "Ultra-Reliable Low-Latency Communication (URLLC) offloading enabled by intelligent reflecting surfaces.",
        "wikilinks": ["intelligent-reflecting-surfaces-mec", "hybrid-redundancy-reliable-edge"],
        "body": """
# Latency and Reliability Aware Edge Offloading via IRS

Achieving 99.999% transmission reliability through IRS spatial diversity.
"""
    },
    {
        "folder": "05_phy_irs_offloading",
        "slug": "beamforming-phase-shift-optimization",
        "title": "Joint Beamforming & Phase Shift Optimization Algorithms",
        "category": "PHY & IRS Offloading",
        "tags": ["beamforming", "phase-shift", "convex-optimization"],
        "summary": "Semidefinite Relaxation (SDR) techniques for joint active base station beamforming and passive IRS phase optimization.",
        "wikilinks": ["intelligent-reflecting-surfaces-mec"],
        "body": """
# Joint Beamforming & Phase Shift Optimization Algorithms

Convex optimization approaches for non-convex IRS phase constraints.
"""
    },
    {
        "folder": "05_phy_irs_offloading",
        "slug": "hybrid-redundancy-reliable-edge",
        "title": "Hybrid Redundancy for Reliable Task Offloading",
        "category": "PHY & IRS Offloading",
        "tags": ["hybrid-redundancy", "reliability", "edge-computing"],
        "summary": "Duplicate task offloading across collaborative edge nodes to guarantee ultra-reliable execution under channel fading.",
        "wikilinks": ["intelligent-reflecting-surfaces-mec", "latency-reliability-irs-offloading"],
        "body": """
# Hybrid Redundancy for Reliable Task Offloading

K-out-of-N task duplication strategies across cooperative edge servers.
"""
    },

    # 06 Multiobjective Scheduling
    {
        "folder": "06_multiobjective_scheduling",
        "slug": "energy-efficient-heterogeneous-scheduling",
        "title": "Energy-Efficient Task Scheduling in Heterogeneous Systems",
        "category": "Multiobjective Scheduling",
        "tags": ["energy-efficiency", "heterogeneous-edge", "multiobjective"],
        "summary": "Multiobjective genetic algorithm (NSGA-II) optimization for energy-latency trade-offs in heterogeneous edge clusters.",
        "wikilinks": ["pareto-optimal-resource-allocation", "cost-effective-tight-deadline-scheduling", "profit-maximized-collaborative-offloading"],
        "body": """
# Energy-Efficient Task Scheduling in Heterogeneous Systems

Heterogeneous edge systems consist of CPUs, GPUs, NPUs, and FPGAs. Scheduling tasks requires multiobjective Pareto optimization.

<Callout type="note" title="Energy-Latency Pareto Front">
Minimizing latency increases clock frequency, which non-linearly accelerates energy consumption (\(P \\propto f^3\)).
</Callout>

## Links
- Read [[pareto-optimal-resource-allocation]].
- Read [[cost-effective-tight-deadline-scheduling]].
"""
    },
    {
        "folder": "06_multiobjective_scheduling",
        "slug": "pareto-optimal-resource-allocation",
        "title": "Pareto-Optimal Resource Allocation in Edge Networks",
        "category": "Multiobjective Scheduling",
        "tags": ["pareto-optimal", "nsga-ii", "tradeoffs"],
        "summary": "Constructing non-dominated Pareto frontiers for latency, energy, cost, and memory footprints.",
        "wikilinks": ["energy-efficient-heterogeneous-scheduling"],
        "body": """
# Pareto-Optimal Resource Allocation in Edge Networks

Multi-objective decision making using NSGA-III and MOEA/D.
"""
    },
    {
        "folder": "06_multiobjective_scheduling",
        "slug": "cost-effective-tight-deadline-scheduling",
        "title": "Cost-Effective Scheduling for Dependent Tasks with Tight Deadlines",
        "category": "Multiobjective Scheduling",
        "tags": ["cost-optimization", "tight-deadlines", "mec-scheduling"],
        "summary": "Heuristic algorithms for cloud-edge monetary cost minimization subject to hard application deadlines.",
        "wikilinks": ["energy-efficient-heterogeneous-scheduling", "industrial-iot-deadline-scheduling"],
        "body": """
# Cost-Effective Scheduling for Dependent Tasks with Tight Deadlines

Minimizing cloud rental costs while offloading time-critical DAG tasks to local edge nodes.
"""
    },
    {
        "folder": "06_multiobjective_scheduling",
        "slug": "profit-maximized-collaborative-offloading",
        "title": "Profit-Maximized Collaborative Offloading in Distributed Systems",
        "category": "Multiobjective Scheduling",
        "tags": ["profit-maximization", "collaborative-edge", "game-theory"],
        "summary": "Stackelberg game models for pricing and profit-maximization among distributed cloud and edge service providers.",
        "wikilinks": ["collaborative-drl-mobile-edge", "energy-efficient-heterogeneous-scheduling"],
        "body": """
# Profit-Maximized Collaborative Offloading in Distributed Systems

Economic Stackelberg game pricing models between infrastructure owners and mobile clients.
"""
    },
    {
        "folder": "06_multiobjective_scheduling",
        "slug": "heuristic-vs-metaheuristic-edge-schedulers",
        "title": "Heuristic vs. Metaheuristic Schedulers in MEC: A Benchmark",
        "category": "Multiobjective Scheduling",
        "tags": ["heuristics", "metaheuristics", "pso", "pft"],
        "summary": "Comparing HEFT, Particle Swarm Optimization (PSO), and Genetic Algorithms for edge workflow execution.",
        "wikilinks": ["energy-efficient-heterogeneous-scheduling"],
        "body": """
# Heuristic vs. Metaheuristic Schedulers in MEC: A Benchmark

Benchmark comparison of HEFT, CPOP, PSO, and NSGA-II algorithms.
"""
    },

    # 07 Taxonomy & Reviews
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "edge-computing-scheduling-taxonomy",
        "title": "Resource Scheduling in Edge Computing: Taxonomy & Open Issues",
        "category": "Taxonomy & Reviews",
        "tags": ["taxonomy", "literature-review", "open-issues", "edge-computing"],
        "summary": "Comprehensive taxonomy classification of edge resource scheduling, architectural patterns, and open research challenges.",
        "wikilinks": ["open-issues-future-edge-research", "6g-edge-intelligence-roadmap", "benchmark-datasets-edge-scheduling"],
        "body": """
# Resource Scheduling in Edge Computing: Taxonomy & Open Issues

A comprehensive structural taxonomy categorizing edge resource allocation by architecture, optimization goal, and algorithm class.

<Callout type="important" title="Taxonomy Dimensions">
1. Infrastructure: Single-edge, Multi-edge, Cloud-Edge-Fog Hybrid.
2. Objectives: Latency, Energy, Cost, Security, Reliability.
3. Techniques: Heuristics, DRL, Game Theory, Convex Optimization.
</Callout>

## Related Review Notes
- Read [[open-issues-future-edge-research]].
- Read [[6g-edge-intelligence-roadmap]].
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "open-issues-future-edge-research",
        "title": "Open Issues and Future Directions in Edge Computing",
        "category": "Taxonomy & Reviews",
        "tags": ["future-directions", "open-issues", "edge-ai"],
        "summary": "Critical analysis of unsolved challenges in edge AI, dynamic topology adaptation, and security governance.",
        "wikilinks": ["edge-computing-scheduling-taxonomy", "security-privacy-edge-offloading"],
        "body": """
# Open Issues and Future Directions in Edge Computing

Unresolved challenges in quantum edge optimization, zero-trust security, and green energy harvesting.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "sensor-fusion-edge-analytics",
        "title": "Sensor Fusion & Stream Analytics at the Network Edge",
        "category": "Taxonomy & Reviews",
        "tags": ["sensor-fusion", "edge-analytics", "iot"],
        "summary": "Architectures for real-time multi-modal sensor data fusion on edge gateways.",
        "wikilinks": ["edge-computing-scheduling-taxonomy"],
        "body": """
# Sensor Fusion & Stream Analytics at the Network Edge

Multi-modal sensor data processing at resource-constrained edge gateways.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "heterogeneous-fog-edge-survey",
        "title": "Survey of Heterogeneous Fog & Edge Hardware Accelerators",
        "category": "Taxonomy & Reviews",
        "tags": ["hardware-accelerators", "npu", "fpga", "edge-hardware"],
        "summary": "Surveying NPU, TPU, and FPGA acceleration integration into edge micro-servers.",
        "wikilinks": ["edge-computing-scheduling-taxonomy"],
        "body": """
# Survey of Heterogeneous Fog & Edge Hardware Accelerators

Analysis of low-power NPU/TPU hardware accelerators for edge AI inference.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "6g-edge-intelligence-roadmap",
        "title": "Roadmap to 6G Edge Intelligence & Sub-Millisecond Compute",
        "category": "Taxonomy & Reviews",
        "tags": ["6g", "edge-intelligence", "roadmap"],
        "summary": "Key technological enablers for sub-millisecond edge intelligence in 6G networks.",
        "wikilinks": ["edge-computing-scheduling-taxonomy", "digital-twin-6g-iov-offloading"],
        "body": """
# Roadmap to 6G Edge Intelligence & Sub-Millisecond Compute

Integrating Terahertz (THz) communications, IRS, and agentic AI in 6G networks.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "benchmark-datasets-edge-scheduling",
        "title": "Benchmark Datasets & Simulators for Edge Scheduling",
        "category": "Taxonomy & Reviews",
        "tags": ["benchmarks", "simulators", "edgecloudsim", "pureedge"],
        "summary": "Overview of standard simulation platforms (EdgeCloudSim, iFogSim, PureEdgeSim) and workload trace datasets.",
        "wikilinks": ["edge-computing-scheduling-taxonomy"],
        "body": """
# Benchmark Datasets & Simulators for Edge Scheduling

Evaluating EdgeCloudSim, iFogSim2, PureEdgeSim, and Alibaba cluster trace datasets.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "security-privacy-edge-offloading",
        "title": "Security, Privacy & OpenFGA ReBAC in Edge Offloading",
        "category": "Taxonomy & Reviews",
        "tags": ["security", "privacy", "rebac", "openfga"],
        "summary": "Enforcing fine-grained Zanzibar authorization policies on offloaded computation tasks at the network edge.",
        "wikilinks": ["edge-computing-scheduling-taxonomy", "autonomous-agent-coordination"],
        "body": """
# Security, Privacy & OpenFGA ReBAC in Edge Offloading

Applying fine-grained Relationship-Based Access Control (ReBAC) to verify offloaded task execution rights on edge nodes.
"""
    },
    {
        "folder": "07_taxonomy_and_reviews",
        "slug": "quantum-inspired-edge-optimization",
        "title": "Quantum-Inspired Optimization for Next-Gen Edge Networks",
        "category": "Taxonomy & Reviews",
        "tags": ["quantum-computing", "quantum-annealing", "edge-optimization"],
        "summary": "Applying Quantum Approximate Optimization Algorithms (QAOA) and simulated annealing to NP-hard edge scheduling problems.",
        "wikilinks": ["edge-computing-scheduling-taxonomy"],
        "body": """
# Quantum-Inspired Optimization for Next-Gen Edge Networks

Exploring Simulated Quantum Annealing (SQA) for complex multi-user offloading problems.
"""
    }
]

def main():
    print(f"Generating {len(ARTICLES)} interconnected research Markdown/MDX articles under {BASE_DIR}...")
    
    for art in ARTICLES:
        folder_path = os.path.join(BASE_DIR, art["folder"])
        os.makedirs(folder_path, exist_ok=True)
        
        file_path = os.path.join(folder_path, f"{art['slug']}.md")
        
        tags_str = json.dumps(art["tags"])
        wikilinks_str = json.dumps(art["wikilinks"])
        
        content = f"""---
title: "{art['title']}"
date: "2026-08-11"
author: "user_researcher"
category: "{art['category']}"
tags: {tags_str}
summary: "{art['summary']}"
wikilinks: {wikilinks_str}
---

{art['body'].strip()}
"""
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        print(f"✓ Created: {file_path}")

    print(f"\nSuccessfully generated all {len(ARTICLES)} Markdown articles for user_researcher!")

if __name__ == "__main__":
    main()
