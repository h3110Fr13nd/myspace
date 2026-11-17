/**
 * Universal Extensible Editor Component & Block Registry
 *
 * Allows custom TipTap extensions, block nodes, and slash commands
 * to be dynamically registered, discovered, and inserted without modifying core UI code.
 */

import { CalloutExtension } from '../../components/editor/nodes/CalloutNode';
import { MathExtension } from '../../components/editor/nodes/MathNode';
import { EmbedExtension } from '../../components/editor/nodes/EmbedNode';
import { MDXComponentExtension } from '../../components/editor/nodes/MDXComponentNode';
import { BasesExtension } from '../../components/editor/nodes/BasesNode';
import { CanvasExtension } from '../../components/editor/nodes/CanvasNode';
import { MermaidExtension } from '../../components/editor/nodes/MermaidNode';
import { ExcalidrawExtension } from '../../components/editor/nodes/ExcalidrawNode';
import { JupyterExtension } from '../../components/editor/nodes/JupyterNode';
import { GoogleResourceExtension } from '../../components/editor/nodes/GoogleResourceNode';
import type { SlashCommandItem } from '../../components/editor/SlashCommandMenu';
import { deleteTriggerToken } from '../editor/triggerToken';

export interface EditorBlockDefinition {
  id: string;
  title: string;
  description: string;
  category: 'Components' | 'Structure' | 'Media' | 'Formatting';
  extension?: any;
  action: (editor: any) => void;
}

const editorRegistry = new Map<string, EditorBlockDefinition>();

/**
 * Register a custom editor component block into the authoring workspace.
 */
export function registerEditorBlock(block: EditorBlockDefinition): void {
  editorRegistry.set(block.id, block);
}

// Built-in Component Blocks
const BUILTIN_EDITOR_BLOCKS: EditorBlockDefinition[] = [
  {
    id: 'bases',
    title: 'Bases Dynamic Query',
    description: 'Embed live filtered notes (tables, cards, or lists)',
    category: 'Components',
    extension: BasesExtension,
    action: (ed) => {
      ed.chain().focus().insertBasesBlock().run();
    },
  },
  {
    id: 'canvas',
    title: 'Spatial Canvas Board',
    description: 'Embed an interactive infinite spatial canvas board',
    category: 'Components',
    extension: CanvasExtension,
    action: (ed) => {
      ed.chain().focus().insertCanvasBlock().run();
    },
  },
  {
    id: 'mermaid',
    title: 'Mermaid Diagram',
    description: 'Live glassmorphic flowcharts and sequence graphs',
    category: 'Components',
    extension: MermaidExtension,
    action: (ed) => {
      ed.chain().focus().insertMermaidBlock().run();
    },
  },
  {
    id: 'excalidraw',
    title: 'Excalidraw Sketch',
    description: 'Embed an interactive vector drawing and diagram canvas',
    category: 'Components',
    extension: ExcalidrawExtension,
    action: (ed) => {
      ed.chain().focus().insertExcalidrawBlock().run();
    },
  },
  {
    id: 'jupyter',
    title: 'Jupyter Notebook Cell',
    description: 'Embed an interactive Python / data science notebook cell',
    category: 'Components',
    extension: JupyterExtension,
    action: (ed) => {
      ed.chain().focus().insertJupyterBlock().run();
    },
  },
  {
    id: 'google-sheet',
    title: 'Google Sheet Embed',
    description: 'Embed a live Google Spreadsheet with live data',
    category: 'Components',
    extension: GoogleResourceExtension,
    action: (ed) => {
      ed.chain().focus().insertGoogleResourceBlock({ resourceType: 'spreadsheet', title: 'Google Sheet' }).run();
    },
  },
  {
    id: 'google-doc',
    title: 'Google Doc Embed',
    description: 'Embed a live Google Document preview',
    category: 'Components',
    extension: GoogleResourceExtension,
    action: (ed) => {
      ed.chain().focus().insertGoogleResourceBlock({ resourceType: 'document', title: 'Google Doc' }).run();
    },
  },
  {
    id: 'callout',
    title: 'Callout Alert',
    description: 'Highlighted note, tip, warning, or danger box',
    category: 'Components',
    extension: CalloutExtension,
    action: (ed) => {
      ed.chain().focus().setCallout('info').run();
    },
  },
  {
    id: 'math',
    title: 'KaTeX Math Formula',
    description: 'LaTeX mathematical equations and symbols',
    category: 'Components',
    extension: MathExtension,
    action: (ed) => {
      ed.chain().focus().insertMathBlock().run();
    },
  },
  {
    id: 'embed',
    title: 'Transclude Note / Section',
    description: 'Embed note, section #heading, or block #^blockid',
    category: 'Media',
    extension: EmbedExtension,
    action: (ed) => {
      ed.chain().focus().run();
      // Emits custom trigger event handled by host editor
      window.dispatchEvent(new CustomEvent('editor:open-wikilink-embed'));
    },
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large primary document heading',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small subsection heading',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    title: 'Bullet List',
    description: 'Unordered bulleted point list',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'Sequential ordered list with numbers',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Highlighted quotation box',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code-block',
    title: 'Code Block',
    description: 'Syntax-highlighted multi-line code snippet',
    category: 'Structure',
    action: (ed) => ed.chain().focus().toggleCodeBlock().run(),
  },
];

// Initialize builtin blocks
BUILTIN_EDITOR_BLOCKS.forEach(registerEditorBlock);

/**
 * Returns all active custom TipTap extensions from the registry.
 */
export function getRegisteredEditorExtensions(): any[] {
  const extensions: any[] = [MDXComponentExtension];
  const seen = new Set();
  for (const block of editorRegistry.values()) {
    if (block.extension && !seen.has(block.extension)) {
      seen.add(block.extension);
      extensions.push(block.extension);
    }
  }
  return extensions;
}

/**
 * Deletes the `/query` token that triggered the slash menu, from the slash
 * character up to the current cursor, within the current text block.
 */
export function deleteSlashToken(editor: any): void {
  deleteTriggerToken(editor, '/');
}

/**
 * Returns all registered slash commands formatted for SlashCommandMenu.
 * Actions are wrapped so the triggering `/query` text is removed first.
 */
export function getRegisteredSlashCommands(): SlashCommandItem[] {
  return Array.from(editorRegistry.values()).map((block) => ({
    id: block.id,
    title: block.title,
    description: block.description,
    category: block.category,
    action: (editor: any) => {
      deleteSlashToken(editor);
      block.action(editor);
    },
  }));
}
