---
title: What is FOSS Workspace?
slug: what-is-foss-workspace
category: product
summary: An open-source, privacy-first knowledge base and collaboration platform built around your vault of knowledge.
tags: [product, overview, open-source]
is_public: true
tier: public
---

# What is FOSS Workspace?

FOSS Workspace is an open-source, self-hostable knowledge platform designed around the idea that your knowledge is yours.

## Core Concepts

**Vaults** are the top-level containers for your knowledge. Each user has their own vault — a personal space that can be shared granularly with others.

**Documents, Blogs, PDFs, Media, Canvases, Sheets, Forms** are all first-class resources. Every resource is an individually addressable, permission-controlled entity.

**Folders** help you organize spatially. They are UI containers that also carry inherited permissions — sharing a folder shares everything inside it.

**Tags** are permission anchors. Tagging a document with `#public-blog` and granting `viewer` to `user:*` on that tag makes it publicly visible — no matter which folder it lives in.

## The Three Permission Layers

Access to any resource is evaluated across three composable layers:

1. **Folder hierarchy** — Access granted on a folder flows down to all contents.
2. **Tags** — Access granted on a tag flows laterally to every resource tagged with it.
3. **Direct grants** — Explicit per-resource bindings override everything (except denies).

Any of these can explicitly **deny** access, and a deny always wins.

## Open Source

FOSS Workspace is MIT licensed. Fork it, self-host it, or contribute back.
