# 01 - WYSIWYG Authoring & Markdown Editor

**Module**: 01 WYSIWYG Authoring & Markdown Editor  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Overview & Editor Requirements

To provide a modern authoring experience, the platform integrates a **WYSIWYG Markdown & MDX Editor** (TipTap / Milkdown / BlockNote). Users can write articles, documentation, and canvas nodes visually while maintaining raw Markdown AST compatibility.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Rich WYSIWYG Editor Component                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Toolbar: Heading | Bold | Italic | Code | Image Upload | [[Wikilink]]       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Visual Document Canvas                                                     │
│  - Live Heading AST Nodes                                                   │
│  - Automatic [[Wikilink]] Autocomplete Popover                              │
│  - Inline Image Drag & Drop (Direct MinIO Upload)                           │
│  - Frontmatter Metadata Panel (Title, Visibility, Tags, Publish State)     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Authoring Capabilities

1. **Live Wikilink Autocomplete (`[[` trigger)**: Typing `[[` opens an autocomplete modal listing all accessible documents in the workspace graph.
2. **MinIO Image Upload Integration**: Dragging an image into the editor automatically uploads the asset to MinIO (`/api/v1/assets/upload`) and embeds the private S3 stream URL.
3. **Publishing State Controls**: Authors can toggle document visibility:
   - **Draft**: Visible only to owner.
   - **Published (Public)**: Visible to all workspace users.
   - **Restricted (Group / User)**: Inherits OpenFGA allow/deny permissions.
