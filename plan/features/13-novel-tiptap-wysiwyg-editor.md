# Implementation Plan: Notion-Style WYSIWYG Resource Editor (Novel & TipTap)

Design and integrate a rich, Notion/Novel-inspired WYSIWYG editor across all content and resource types in the workspace.

## Reference Architecture: Novel & TipTap

Inspired by [`steven-tey/novel`](https://github.com/steven-tey/novel) and [`ueberdosis/tiptap`](https://github.com/ueberdosis/tiptap):

```
┌────────────────────────────────────────────────────────────────────────┐
│  Notion/Novel-Style WYSIWYG Editor Component                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [:: Drag Handle]   # Heading 1                                        │
│  [:: Drag Handle]   Paragraph with [[Wikilink Dropdown]] and bold text │
│                                                                        │
│  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ Floating Bubble Menu   │  │ Slash Command Menu (Type '/')        │  │
│  ├────────────────────────┤  ├──────────────────────────────────────┤  │
│  │ B | I | U | ~ | <code >│  │ 📝 Heading 1 / 2 / 3                 │  │
│  │ 🔗 Link | 💡 Highlight │  │ 📋 Task List (Checkboxes)            │  │
│  │ 🎨 Text Color          │  │ 🖼️ Upload Image / Asset              │  │
│  └────────────────────────┘  │ 💡 Callout Block (Note/Warning)      │  │
│                              │ 🧮 KaTeX Math Formula Block          │  │
│                              │ 📄 Embed PDF / Drive Resource        │  │
│                              └──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                         Save Document (Auto / Manual)
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ Bi-directional Markdown + YAML Frontmatter Converter   │
       └────────────────────────────┬───────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       ┌─────────────────────────┐    ┌─────────────────────────┐
       │   PostgreSQL Metadata   │    │  Content File / MinIO   │
       │ (slug, tags, wikilinks) │    │  (Markdown Storage)     │
       └─────────────────────────┘    └─────────────────────────┘
```

---

## Proposed Features & Extensions

### 1. Slash Command Menu (`/`)
- Type `/` on any blank line to invoke a popover menu (like Novel / Notion):
  - **Text & Headings**: H1, H2, H3, Subtitle
  - **Lists**: Bullet List, Numbered List, Task / Checklist (`- [ ]`)
  - **Rich Blocks**: Code Block with Syntax Highlighting, Blockquote, Divider
  - **Math Formulas**: Inline `$math$` and block `$$LaTeX$$` using KaTeX
  - **Callout Blocks**: `> [!note]`, `> [!warning]`, `> [!tip]`, `> [!important]` with custom icons & glassmorphic styles
  - **Media & Embeds**: Drag-and-drop Image upload (via MinIO), PDF Embed, and Google Drive resource viewer embed

### 2. Floating Bubble Toolbar
- Appears smoothly upon selecting any text range:
  - Format buttons: **Bold**, *Italic*, ~~Strikethrough~~, `Inline Code`, ==Highlight==
  - Link insertion dialog with internal wikilink autocompletion
  - Text color & background color palette

### 3. Wikilink Autocomplete (`[[`)
- Typing `[[` inside the editor opens a dropdown of all accessible vault resources and notes.
- Selecting a note inserts a custom `wikilink` node linking directly to that document's slug/ID.

### 4. Bi-Directional Markdown & Frontmatter Engine
- **Load**: Parse raw Markdown + YAML frontmatter into TipTap document nodes (headings, callouts, lists, math, code blocks, images).
- **Export/Save**: Serialize the TipTap AST cleanly back to Obsidian Flavored Markdown (OFM) and YAML frontmatter without loss of custom tags or math syntax.

### 5. Multi-Resource Edit Modes
- Support editing for:
  - **Documents / Research Notes**: Full rich-text Markdown editing.
  - **PDF / Image / Drive Resource Metadata**: Edit title, category, tags, and summary.
  - **Permission & Publish State**: Toggle between `draft` (private), `published` (public), or specific ReBAC viewer roles on save.

---

## Proposed Changes

### [NEW] [src/components/editor/NovelEditor.tsx](file:///home/user/Desktop/dev/blog/template/src/components/editor/NovelEditor.tsx)
- The core React component integrating TipTap extensions:
  - `@tiptap/starter-kit`
  - `@tiptap/extension-placeholder`
  - `@tiptap/extension-character-count`
  - `@tiptap/extension-bubble-menu`
  - `@tiptap/extension-task-list` & `@tiptap/extension-task-item`
  - Custom `SlashCommand` suggestion extension
  - Custom `WikilinkNode` extension
  - Custom `CalloutNode` extension
  - Custom `MathNode` extension

### [NEW] [src/components/editor/SlashCommandMenu.tsx](file:///home/user/Desktop/dev/blog/template/src/components/editor/SlashCommandMenu.tsx)
- Floating command palette rendered with `@floating-ui/dom` supporting keyboard navigation (Arrow keys + Enter).

### [NEW] [src/components/editor/BubbleToolbar.tsx](file:///home/user/Desktop/dev/blog/template/src/components/editor/BubbleToolbar.tsx)
- Contextual selection toolbar with glassmorphism styling.

### [NEW] [src/pages/api/v1/resources/save.ts](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/resources/save.ts)
- Backend endpoint to save updated Markdown content, update PostgreSQL metadata (`tags`, `category`, `summary`, `wikilinks`), and trigger Meilisearch indexing.

### [MODIFY] [src/pages/index.astro](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro)
- Add an "Edit Document" toggle button in the header/meta bar for authorized users (`owner` or `editor` relation in OpenFGA).
- When Edit mode is active, swap the read-only prose container with the `<NovelEditor client:load />`.

---

## Verification Plan

### Automated Tests
- Test Markdown-to-TipTap-to-Markdown roundtrip conversion to ensure no formatting or math expressions are mangled.
- Test `/api/v1/resources/save` endpoint with authentication & ReBAC permission check.

### Manual Verification
- Test slash command `/` invocation and block creation.
- Test `[[` wikilink autocompletion.
- Test inline math rendering `$E=mc^2$`.
- Test saving changes and verifying immediate reflection in Meilisearch search and read view.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Core Implemented | **Feature Track**: WYSIWYG TipTap Authoring Engine

- [x] TipTap rich-text editor instance with StarterKit (`NovelEditor.tsx`)
- [x] Bi-directional Markdown serializer integration (`tiptap-markdown` preserving Markdown)
- [x] Obsidian-Flavored Markdown (OFM) YAML frontmatter generation (`src/pages/api/v1/resources/save.ts`)
- [x] Floating Slash Command menu (`/` trigger for headings, callouts, math, embeds)
- [x] Inline floating bubble toolbar (bold, italic, code, links)
- [x] Live wikilink autocomplete menu (`[[` trigger with debounced candidate fetching)
- [x] Tri-Mode editor toggle (Visual / Split / Raw Source modes)
- [x] Global block drag handle (`tiptap-extension-global-drag-handle`)
- [x] Autosave engine with status indicator pill (`useAutosave.ts`)
