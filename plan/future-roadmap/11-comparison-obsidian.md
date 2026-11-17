# Comparison: Our FOSS Workspace vs. Obsidian

This document provides a high-level comparison between our Postgres-backed, Markdown-first FOSS workspace and **Obsidian**. 
*Note: This is strictly a comparative analysis, not an implementation plan.*

## 1. Core Architecture & Philosophy

| Feature | Our FOSS Workspace | Obsidian |
| :--- | :--- | :--- |
| **Data Storage** | PostgreSQL + SSR Web Application | Local Filesystem (.md files) + Electron App |
| **Target Medium**| Web-first, accessible from any browser | Desktop/Mobile native app first |
| **Access Control** | OpenFGA (ReBAC) for multi-user sharing | Local filesystem permissions (single user) |
| **Ecosystem** | Pre-bundled features, code-level plugins | Massive community plugin ecosystem (Dataview, Excalidraw, etc.) |

## 2. Strengths & Advantages (Ours)

- **Native Web Publishing**: Our system is built to be a fast, SEO-friendly website from day one (using Astro). Obsidian requires paid services (Obsidian Publish) or third-party workarounds (Quartz) to publish to the web.
- **Multi-User & Granular Permissions**: Designed for teams and public sharing with enterprise-grade ReBAC (OpenFGA). Obsidian is inherently a single-user local tool.
- **Server-Side Processing**: We can leverage backend databases (Postgres) for fast querying, dynamic OpenGraph image generation, and secure API integrations (like Google Drive).
- **Zero Sync Conflicts**: A centralized database avoids the file-sync conflict issues common when using Git or cloud drives to sync Obsidian vaults across devices.

## 3. Gaps & Shortcomings (Compared to Obsidian)

- **Local-First Speed & Offline Access**: Obsidian is entirely offline and local, meaning near-zero latency for opening, searching, and editing files. Our web app requires a network connection.
- **The Graph View**: Obsidian’s iconic local/global force-directed graph view is highly optimized and interactive. We currently lack a visual knowledge graph.
- **Plugin Ecosystem**: Obsidian has thousands of community plugins extending its functionality. Our system relies on hard-coded features or bespoke development.
- **Hover Previews & SPA Feel**: Obsidian lets you hover over links to preview them instantly, and opens files in customizable split panes. We currently use full page reloads and lack hover popovers.
- **Dataview**: The Obsidian Dataview plugin allows users to write SQL-like queries inside their notes to dynamically aggregate data. We don't have this inline query engine yet.
- **Block Transclusion**: Obsidian can embed specific paragraphs (`![[note#^block]]`). We only support embedding full files.

## 4. Conclusion & Potential Roadmap

Our system essentially aims to be a **multi-user, web-native, strictly-permissioned** evolution of the Obsidian/Quartz philosophy. To close the gap with Obsidian's best features, we should focus on:
1. **Adding a Graph View**: Using D3.js or similar to visualize note relationships.
2. **Implementing Client-Side Routing (SPA)**: To make the web app feel as fast and seamless as a local desktop app.
3. **Wikilink Hover Previews**: To replicate the fluid exploration of a local knowledge graph.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔍 Comparative Analysis | **Track**: Architectural Benchmarking

- [x] Web-first multi-user publishing model validation
- [x] Markdown + JSON Canvas specification parity
- [x] OpenFGA fine-grained multi-user sharing compared to single-user local vaults
- [x] Visual Knowledge Graph parity (SVG & Canvas engines implemented)
- [ ] Local-first offline-first encrypted sync client
