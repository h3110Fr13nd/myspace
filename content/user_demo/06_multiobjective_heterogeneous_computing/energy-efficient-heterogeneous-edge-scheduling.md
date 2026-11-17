---
title: "Energy-Efficient Task Scheduling in Heterogeneous Edge Computing Systems"
date: "2026-08-11"
author: "demo"
category: "Multiobjective Computing"
tags: ["multiobjective", "nsga-ii", "heterogeneous-computing", "energy-efficiency", "dvfs"]
summary: "Multiobjective genetic optimization (NSGA-II & MOEA/D) jointly optimizing Dynamic Voltage and Frequency Scaling (DVFS) and task mapping across heterogeneous CPU/GPU/NPU clusters."
wikilinks: ["pareto-optimal-resource-allocation-edge","cost-effective-tight-deadline-dag-scheduling","profit-maximized-collaborative-cloud-edge-offloading","pdf:a_multi-agent_based_model_for_task_scheduling_in_c"]
---

# Energy-Efficient Task Scheduling in Heterogeneous Edge Computing Systems

Modern edge nodes are highly heterogeneous systems comprising multi-core CPUs, discrete GPUs, custom Neural Processing Units (NPUs), and Field Programmable Gate Arrays (FPGAs). Concurrently, computing nodes support Dynamic Voltage and Frequency Scaling (DVFS), allowing the operating clock frequency \(f\) to be adjusted dynamically. Higher frequencies minimize task execution latency but accelerate energy consumption superlinearly (\(P \propto V^2 f\)) <Citation id="6" authors="M. Patel et al." year="2026" title="Heterogeneous Edge Scheduling" />.

<Callout type="note" title="DVFS Energy-Frequency Scaling Law">
The total power consumption \(P(f)\) of a heterogeneous processor core operating at frequency \(f\) is given by:
\[
P(f) = P_{\text{static}} + C_{\text{eff}} \cdot V_{\text{dd}}^2 \cdot f \approx P_{\text{static}} + k \cdot f^3
\]
where \(k\) is the effective gate capacitance constant.
</Callout>

## Multiobjective Pareto Formulation

We define the dual minimization objective vector \(\mathbf{F}(\mathbf{x})\):

\[
\min_{\mathbf{x}} \mathbf{F}(\mathbf{x}) = \left[ T_{\text{makespan}}(\mathbf{x}), E_{\text{total}}(\mathbf{x}) \right]^T
\]

Subject to:
1. Processor frequency constraints: \(f_{\text{min}} \le f_{i,t} \le f_{\text{max}}\).
2. Memory bounds: \(\sum_{v_j \in \text{active}} M(v_j) \le M_{\text{node}}\).

## Related Articles
- See [[pareto-optimal-resource-allocation-edge]] for Pareto boundary construction.
- See [[cost-effective-tight-deadline-dag-scheduling]] for budget-constrained scheduling.


## Primary Real Paper PDF Reference
- Access real paper stream: [[pdf:a_multi-agent_based_model_for_task_scheduling_in_c|A multi Agent based model for task scheduling PDF]]


## Primary Real Resource References
- Access real paper stream: [[pdf:a_multi-agent_based_model_for_task_scheduling_in_c|A multi Agent based model for task scheduling PDF]]
