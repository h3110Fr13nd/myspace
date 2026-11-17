# Digital Garden & Zettelkasten Architecture with Zanzibar ACLs

## The Core Paradigm

> **Hierarchy is for organizational containers and permission inheritance.**
> **The Content Graph (wikilinks, backlinks, tags, canvas boards) is for discovery and thought navigation.**

In a true Zettelkasten / Obsidian Digital Garden:
- You don't browse deep folder trees to think — you follow associative trails: `[[note-a]]` $\rightarrow$ `[[note-b]]` $\rightarrow$ `#tag` $\rightarrow$ Graph View.
- Notes are globally addressable by their `slug` or `title` across the entire garden regardless of where they are filed.
- The folder tree is simply the **ACL backbone** for cascading access control in OpenFGA, while **wikilinks & tags form the semantic web**.

---

## 1. Non-Hierarchical Content Web

```
                    ┌─────────────────────────┐
                    │      Interactive        │
                    │   Global Graph View     │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ Post: Scaling │◄─────►│ Post: OpenFGA │◄─────►│ Post: DDPM    │
│     Laws      │       │   Zanzibar    │       │    Theory     │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │ [[wikilink]]          │ [[wikilink]]          │ [[wikilink]]
        ▼                       ▼                       ▼
   Backlinks &             Backlinks &             Backlinks &
  Hover Previews          Hover Previews          Hover Previews
        ▲                       ▲                       ▲
        └───────────────────────┴───────────────────────┘
                                │
                    ┌───────────┴─────────────┐
                    │   Tag Hub: #ai, #math   │
                    │   Horizontal Taxonomy   │
                    └─────────────────────────┘
```

---

## 2. Global Wikilink Resolution (`[[slug]]`)

Authors write standard Obsidian wikilinks:
- `[[scaling-laws]]` $\rightarrow$ Resolves to canonical URL `/s/main-blog/.../scaling-laws`
- `[[scaling-laws|Chinchilla Formulation]]` $\rightarrow$ Resolves with custom display text
- `![[diffusion-models]]` $\rightarrow$ Transcludes the note body inline
- `![[pdf:q3_contract]]` $\rightarrow$ Embeds the PDF viewer with download control

### Resolution Logic:
1. Lookup resource by `slug = target` or `id = target` in PostgreSQL.
2. Check `canViewResource(currentUser, target.id)` in OpenFGA.
3. If allowed $\rightarrow$ Render active link with hover preview (`WikilinkPreview`).
4. If denied $\rightarrow$ Render locked link (`🔒 Restricted Note`) or paywall trigger without leaking excerpt.

---

## 3. Zanzibar-Gated Backlinks

Every post automatically computes bidirectional backlinks:
- Subquery: All resources whose `metadata->'wikilinks'` contains this post's slug.
- Filter: OpenFGA `canViewResource` for each linking note.
- Output: "Mentioned In" sidebar containing only the notes the current reader is authorized to see.

---

## 4. OpenFGA Tag-Based Authorization (Future Roadmap)

To support **tag-based access control (ABAC via ReBAC)**:

```python
type tag
  relations
    define viewer: [user, group#member]
    define denied_viewer: [user, group#member]

type post
  relations
    define tagged: [tag]
    # Post viewer can require viewer from tag or inherit from tag
    define viewer: [user, group#member] or viewer from tagged or viewer from parent
    define denied_viewer: [user, group#member] or denied_viewer from tagged
```

This allows:
- Tagging a note `#confidential` automatically attaches `tagged: tag:confidential`.
- Denying public access on `#draft` automatically hides all draft notes across all folders.

---

## 5. UI Integration Strategy

1. **Header**: Quick Search (Ctrl+K), Space Selector, IAM Console.
2. **Left Sidebar**: 
   - Folders (for administrative tree & ACL visualization).
   - Tag Cloud (for horizontal semantic exploration).
   - Interactive Local Graph View (1-2 hop neighborhood).
3. **Center Main**:
   - Clean readable typography (distill/research styling with KaTeX, Shiki, MDX callouts).
   - Inline wikilinks with instant hover popovers.
   - Interactive transclusions (`![[...]]`).
4. **Right Sidebar**:
   - Table of Contents.
   - Bidirectional Backlinks ("Linked References").
   - Outgoing Graph Links ("Unlinked & Linked Mentions").
