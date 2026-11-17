import csv
import os
import re
from pathlib import Path

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")

TRACK_MAP = [
    ("track-1-foundational-overviews-surveys", "Track 1: Foundational Overviews & Surveys", "Stage 1 (Foundations & Surveys)", [
        "survey", "overview", "taxonomy", "review", "trends and challenges", "roadmap", "architecture taxonomy"
    ]),
    ("track-2-drl-workflow-scheduling", "Track 2: DRL & Workflow Scheduling", "Stage 2 (Algorithmic Fundamentals & Workflow Scheduling)", [
        "reinforcement learning", "drl", "workflow scheduling", "q-network", "deep q-learning", "sarsa", "dag", "memetic"
    ]),
    ("track-3-agentic-ai-llm-orchestration", "Track 3: Agentic AI & LLM Orchestration", "Stage 3 (Agentic AI & Autonomous Edge)", [
        "agentic", "agent", "llm", "large language model", "generative ai", "diffusion", "multi-agent"
    ]),
    ("track-4-digital-twins-iov-iiot", "Track 4: Digital Twins & Industrial IoT", "Stage 4 (Industrial Applications & Digital Twins)", [
        "digital twin", "iov", "vehicle", "iiot", "industrial internet", "serverless", "smart factory"
    ]),
    ("track-5-computation-offloading-resource-allocation", "Track 5: Computation Offloading & Resource Allocation", "Stage 2 (Algorithmic Fundamentals & Workflow Scheduling)", [
        "offloading", "resource allocation", "task offloading", "resource provisioning", "task scheduling"
    ]),
    ("track-6-hardware-irs-beamforming", "Track 6: PHY Layer, IRS & Beamforming", "Stage 5 (Network Frontiers & Advanced Orchestration)", [
        "reflecting surface", "irs", "beamforming", "physical layer", "antenna", "mimo"
    ]),
    ("track-7-next-gen-network-quantum-6g", "Track 7: Next-Generation Network Intelligence (6G & Quantum)", "Stage 5 (Network Frontiers & Advanced Orchestration)", [
        "6g", "quantum", "o-ran", "terahertz", "qaoa", "annealing"
    ])
]

def determine_track(title: str, abstract: str):
    combined = (title + " " + abstract).lower()
    for slug, name, stage, keywords in TRACK_MAP:
        for kw in keywords:
            if kw in combined:
                return slug, name, stage
    return "track-5-computation-offloading-resource-allocation", "Track 5: Computation Offloading & Resource Allocation", "Stage 2 (Algorithmic Fundamentals & Workflow Scheduling)"

def extract_methodologies(title: str, abstract: str):
    combined = (title + " " + abstract).lower()
    methods = []
    candidates = [
        ("methodology-deep-q-learning", "Deep Q-Learning (DQL / DQN / DDQN)", ["deep q-learning", "dqn", "ddqn", "q-learning", "dql"]),
        ("methodology-ppo-actor-critic", "Proximal Policy Optimization (PPO)", ["ppo", "proximal policy optimization", "actor-critic"]),
        ("methodology-transformers-attention", "Transformers & Self-Attention", ["transformer", "self-attention", "attention mechanism"]),
        ("methodology-genetic-memetic-algorithms", "Genetic & Memetic Algorithms", ["genetic algorithm", "memetic algorithm", "nsga", "nsga-ii"]),
        ("methodology-quantum-optimization", "Quantum Optimization (QAOA & QA)", ["quantum annealing", "qaoa", "quantum computing"]),
        ("methodology-swarm-intelligence", "Swarm Intelligence (PSO / GWO / Pufferfish)", ["pso", "particle swarm", "pufferfish", "drawer algorithm", "sine cosine", "archery", "firefly"]),
        ("methodology-gated-recurrent-unit", "Gated Recurrent Unit (GRU / RNN)", ["gru", "gated recurrent unit", "lstm", "recurrent neural network"]),
        ("methodology-graph-neural-networks", "Graph Neural Networks (GNN)", ["graph neural network", "gnn", "graph convolutional"]),
        ("methodology-diffusion-models", "Diffusion Models & Generative AI", ["diffusion", "generative ai", "world models"]),
        ("methodology-heuristics-metaheuristics", "Nature-Inspired Metaheuristics", ["metaheuristic", "heuristic", "optimization algorithm"])
    ]
    for slug, name, kw_list in candidates:
        if any(kw in combined for kw in kw_list):
            methods.append((slug, name))
    if not methods:
        methods.append(("methodology-heuristics-metaheuristics", "Nature-Inspired Metaheuristics"))
    return methods

def main():
    csv_path = "temp/extra/docs/papers/papers_enriched.csv"
    if not os.path.exists(csv_path):
        print(f"Error: {csv_path} not found!")
        return

    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        papers = list(reader)

    print(f"Loaded {len(papers)} papers from {csv_path}")

    base_dir = Path("content/public_vault/research")
    papers_dir = base_dir / "papers"
    authors_dir = base_dir / "authors"
    venues_dir = base_dir / "venues"
    insts_dir = base_dir / "institutions"
    tracks_dir = base_dir / "tracks"
    methods_dir = base_dir / "methodologies"

    for d in [papers_dir, authors_dir, venues_dir, insts_dir, tracks_dir, methods_dir]:
        d.mkdir(parents=True, exist_ok=True)

    authors_index = {}
    venues_index = {}
    insts_index = {}
    tracks_index = {}
    methods_index = {}

    for p in papers:
        idx = int(p.get("Index", 0))
        title = p.get("Title", "").strip()
        doi = p.get("DOI", "").strip()
        publisher = p.get("Publisher", "").strip()
        venue = p.get("Journal_or_Venue", "").strip()
        year = p.get("Year", "").strip()
        pub_date = p.get("Publication_Date", "").strip()
        raw_authors = p.get("Authors", "").strip()
        raw_affils = p.get("Authors_with_Affiliations", "").strip()
        raw_insts = p.get("Institutions_and_Companies", "").strip()
        citations = p.get("Citations_Count", "0").strip()
        fwci = p.get("FWCI_Impact_Rating", "N/A").strip()
        oa_status = p.get("Open_Access_Status", "closed").strip()
        pdf_path = p.get("Downloaded_PDF_Path", "").strip()
        abstract = p.get("Abstract", "").strip()

        paper_slug = f"paper-{idx:02d}-{slugify(title)[:45]}"

        # Authors
        author_names = [a.strip() for a in raw_authors.split(";") if a.strip()]
        if not author_names:
            author_names = [a.strip() for a in raw_authors.split(",") if a.strip()]

        author_wikilinks = []
        for aname in author_names:
            aslug = f"author-{slugify(aname)}"
            author_wikilinks.append(aslug)
            if aslug not in authors_index:
                authors_index[aslug] = {"name": aname, "papers": []}
            authors_index[aslug]["papers"].append({"index": idx, "slug": paper_slug, "title": title, "year": year})

        # Venue
        venue_slug = ""
        if venue and "missing" not in venue.lower() and "unknown" not in venue.lower():
            venue_slug = f"venue-{slugify(venue)[:40]}"
            if venue_slug not in venues_index:
                venues_index[venue_slug] = {"name": venue, "publisher": publisher, "papers": []}
            venues_index[venue_slug]["papers"].append({"index": idx, "slug": paper_slug, "title": title, "year": year})

        # Institutions
        inst_names = [i.strip() for i in raw_insts.split(";") if i.strip() and "unknown" not in i.lower()]
        inst_wikilinks = []
        for iname in inst_names:
            islug = f"inst-{slugify(iname)[:40]}"
            inst_wikilinks.append(islug)
            if islug not in insts_index:
                insts_index[islug] = {"name": iname, "papers": []}
            insts_index[islug]["papers"].append({"index": idx, "slug": paper_slug, "title": title, "year": year})

        # Track
        track_slug, track_name, reading_stage = determine_track(title, abstract)
        if track_slug not in tracks_index:
            tracks_index[track_slug] = {"name": track_name, "stage": reading_stage, "papers": []}
        tracks_index[track_slug]["papers"].append({"index": idx, "slug": paper_slug, "title": title, "year": year})

        # Methodologies
        paper_methods = extract_methodologies(title, abstract)
        method_wikilinks = []
        for mslug, mname in paper_methods:
            method_wikilinks.append(mslug)
            if mslug not in methods_index:
                methods_index[mslug] = {"name": mname, "papers": []}
            methods_index[mslug]["papers"].append({"index": idx, "slug": paper_slug, "title": title, "year": year})

        all_wikilinks = []
        all_wikilinks.extend(author_wikilinks)
        if venue_slug:
            all_wikilinks.append(venue_slug)
        all_wikilinks.extend(inst_wikilinks[:4])
        all_wikilinks.append(track_slug)
        all_wikilinks.extend(method_wikilinks)

        pdf_basename = os.path.basename(pdf_path) if pdf_path else ""
        pdf_clean = pdf_basename.replace(".pdf", "")

        paper_file = papers_dir / f"{paper_slug}.md"
        
        affil_lines = ""
        if raw_affils:
            affil_lines = f"\n**Affiliations**: {raw_affils}\n"

        pdf_embed = ""
        if pdf_clean:
            pdf_embed = f"\n\n### 📕 Embedded Document Viewer\n![[pdf:{pdf_clean}]]\n"

        wikilink_chips = " ".join([f"[[{wl}]]" for wl in all_wikilinks])

        paper_content = f"""---
title: "{title.replace('\"', '\'')}"
type: "document"
category: "research_papers"
paper_index: {idx}
doi: "{doi}"
publisher: "{publisher}"
venue: "{venue.replace('\"', '\'')}"
year: {year if year.isdigit() else 2026}
publication_date: "{pub_date}"
citations: {citations if citations.isdigit() else 0}
fwci: "{fwci}"
open_access_status: "{oa_status}"
track: "{track_slug}"
reading_stage: "{reading_stage}"
slug: "{paper_slug}"
wikilinks: {all_wikilinks}
---

# Paper {idx}: {title}

<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.25rem;">
  <span style="background: rgba(0,242,254,0.15); color: var(--accent-cyan); border: 1px solid var(--accent-cyan); padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">Paper #{idx}</span>
  <span style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid #f59e0b; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">{year}</span>
  <span style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid #10b981; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">Citations: {citations}</span>
  <span style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid #a855f7; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">FWCI: {fwci}</span>
  <span style="background: rgba(244,63,94,0.15); color: #fb7185; border: 1px solid #f43f5e; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">{oa_status.upper()}</span>
</div>

**Authors**: {', '.join([f'[[{slug}|{name}]]' for slug, name in [(f'author-{slugify(a)}', a) for a in author_names]])}  
**Venue**: {f'[[{venue_slug}|{venue}]]' if venue_slug else venue}  
**Publisher**: {publisher}  
**DOI**: [{doi}](https://doi.org/{doi})  
**Research Track**: [[{track_slug}|{track_name}]] ({reading_stage})  
{affil_lines}

---

## 🎯 Core Methodologies & Algorithms
{' '.join([f'- [[{mslug}|{mname}]]' for mslug, mname in paper_methods])}

---

## 📖 Abstract
> {abstract if abstract else "No abstract provided in bibliographic index."}

---

## 🕸️ Knowledge Graph Connections
{wikilink_chips}
{pdf_embed}
"""
        with open(paper_file, "w", encoding="utf-8") as pf:
            pf.write(paper_content)

    print(f"Wrote {len(papers)} paper files in {papers_dir}")

    # Write Authors Notes
    for aslug, ainfo in authors_index.items():
        anote = authors_dir / f"{aslug}.md"
        paper_links = "\n".join([f"- **[[{p['slug']}|Paper {p['index']} ({p['year']}): {p['title']}]]**" for p in ainfo["papers"]])
        content = f"""---
title: "{ainfo['name'].replace('\"', '\'')}"
type: "document"
category: "research_authors"
slug: "{aslug}"
wikilinks: {[p['slug'] for p in ainfo['papers']]}
---

# 👤 {ainfo['name']}

**Author Profile & Co-authorship Hub**

### Authored Research Papers ({len(ainfo['papers'])} in Corpus)
{paper_links}
"""
        with open(anote, "w", encoding="utf-8") as af:
            af.write(content)
    print(f"Wrote {len(authors_index)} author files in {authors_dir}")

    # Write Venues Notes
    for vslug, vinfo in venues_index.items():
        vnote = venues_dir / f"{vslug}.md"
        paper_links = "\n".join([f"- **[[{p['slug']}|Paper {p['index']} ({p['year']}): {p['title']}]]**" for p in vinfo["papers"]])
        content = f"""---
title: "{vinfo['name'].replace('\"', '\'')}"
type: "document"
category: "research_venues"
publisher: "{vinfo['publisher']}"
slug: "{vslug}"
wikilinks: {[p['slug'] for p in vinfo['papers']]}
---

# 🏛️ {vinfo['name']}

**Publisher**: {vinfo['publisher']}

### Published Papers in Collection ({len(vinfo['papers'])})
{paper_links}
"""
        with open(vnote, "w", encoding="utf-8") as vf:
            vf.write(content)
    print(f"Wrote {len(venues_index)} venue files in {venues_dir}")

    # Write Institutions Notes
    for islug, iinfo in insts_index.items():
        inote = insts_dir / f"{islug}.md"
        paper_links = "\n".join([f"- **[[{p['slug']}|Paper {p['index']}: {p['title']}]]**" for p in iinfo["papers"]])
        content = f"""---
title: "{iinfo['name'].replace('\"', '\'')}"
type: "document"
category: "research_institutions"
slug: "{islug}"
wikilinks: {[p['slug'] for p in iinfo['papers']]}
---

# 🎓 {iinfo['name']}

### Affiliated Research Works ({len(iinfo['papers'])})
{paper_links}
"""
        with open(inote, "w", encoding="utf-8") as inf:
            inf.write(content)
    print(f"Wrote {len(insts_index)} institution files in {insts_dir}")

    # Write Tracks Notes
    for tslug, tinfo in tracks_index.items():
        tnote = tracks_dir / f"{tslug}.md"
        paper_links = "\n".join([f"- **[[{p['slug']}|Paper {p['index']} ({p['year']}): {p['title']}]]**" for p in tinfo["papers"]])
        content = f"""---
title: "{tinfo['name']}"
type: "document"
category: "research_tracks"
reading_stage: "{tinfo['stage']}"
slug: "{tslug}"
wikilinks: {[p['slug'] for p in tinfo['papers']]}
---

# 🛣️ {tinfo['name']}

**Reading Stage**: {tinfo['stage']}

### Papers in this Research Track ({len(tinfo['papers'])})
{paper_links}
"""
        with open(tnote, "w", encoding="utf-8") as tf:
            tf.write(content)
    print(f"Wrote {len(tracks_index)} track files in {tracks_dir}")

    # Write Methodologies Notes
    for mslug, minfo in methods_index.items():
        mnote = methods_dir / f"{mslug}.md"
        paper_links = "\n".join([f"- **[[{p['slug']}|Paper {p['index']} ({p['year']}): {p['title']}]]**" for p in minfo["papers"]])
        content = f"""---
title: "{minfo['name']}"
type: "document"
category: "research_methodologies"
slug: "{mslug}"
wikilinks: {[p['slug'] for p in minfo['papers']]}
---

# ⚙️ {minfo['name']}

**Algorithmic Concept & Optimization Engine**

### Papers Utilizing this Method ({len(minfo['papers'])})
{paper_links}
"""
        with open(mnote, "w", encoding="utf-8") as mf:
            mf.write(content)
    print(f"Wrote {len(methods_index)} methodology files in {methods_dir}")

    # Write Master Index
    master_index = base_dir / "index.md"
    track_lines = "\n".join([f"- **[[{tslug}|{tinfo['name']}]]** ({len(tinfo['papers'])} papers)" for tslug, tinfo in tracks_index.items()])
    method_lines = "\n".join([f"- **[[{mslug}|{minfo['name']}]]** ({len(minfo['papers'])} papers)" for mslug, minfo in methods_index.items()])
    
    master_content = f"""---
title: "Academic Research Knowledge Graph — 77 Papers Synthesis Matrix"
type: "document"
category: "research_overview"
slug: "research-overview-index"
wikilinks: {list(tracks_index.keys()) + list(methods_index.keys())}
---

# 📚 Academic Research Knowledge Graph (77 Papers)

Welcome to the unified, interactive research knowledge vault covering Edge-Fog-Cloud Continuum, Agentic AI, DRL Task Offloading, and 6G Quantum Orchestration.

---

## 🛣️ Research Tracks & Reading Roadmaps
{track_lines}

---

## ⚙️ Core Algorithmic Engines & Methodologies
{method_lines}

---

## 📊 High-Impact Recent Additions (Papers 73–77)
- [[paper-73-fog-quant-a-quantum-computing-inspired-f|Paper 73: Fog-Quant: A Quantum Computing Inspired Framework for 6G RAN]] (SUSCOM 2026)
- [[paper-74-nate-and-t-nate-efficient-transformers-fo|Paper 74: NATE and T-NATE: Efficient Transformers for IoT Task Offloading]] (SUSCOM 2026)
- [[paper-75-optimizing-task-offloading-with-metaheuri|Paper 75: Optimizing Task Offloading with Metaheuristic Algorithms Survey]] (SUSCOM 2025)
- [[paper-76-task-offloading-and-archery-pufferfish-op|Paper 76: Task Offloading & Archery Pufferfish Optimization]] (SUSCOM 2026)
- [[paper-77-ai-augmented-edge-and-fog-computing-tren|Paper 77: AI Augmented Edge and Fog Computing: Trends and Challenges]] (JNCA 2023)
"""
    with open(master_index, "w", encoding="utf-8") as mif:
        mif.write(master_content)
    print(f"Wrote master research index at {master_index}")

if __name__ == "__main__":
    main()

