import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
import Collaboration from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '../../lib/editor/CollaborationCursor';

import { SlashCommandMenu } from './SlashCommandMenu';
import { BubbleToolbar } from './BubbleToolbar';
import { WikilinkMenu } from './WikilinkMenu';
import { getRandomColor } from '../../lib/editor/collaboration';
import { useCollaboration } from '../../lib/editor/useCollaboration';
import { Button } from '../ui/Button';
import { Input, TextArea } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useAutosave } from '../../lib/editor/useAutosave';
import { readTriggerQuery } from '../../lib/editor/triggerToken';
import { fetchWikilinkCandidates, type WikilinkCandidate } from '../../lib/editor/wikilink';
import { getRegisteredEditorExtensions, getRegisteredSlashCommands } from '../../lib/registry/editorRegistry';

interface NovelEditorProps {
  resourceId: string;
  initialTitle: string;
  initialContent: string;
  initialMetadata?: {
    category?: string;
    tags?: string[];
    summary?: string;
    is_public?: boolean;
    aliases?: string[];
    icon?: string;
  };
  currentUser: string;
  onSaveSuccess?: () => void;
  onCancel?: () => void;
}

export const NovelEditor: React.FC<NovelEditorProps> = ({
  resourceId,
  initialTitle,
  initialContent,
  initialMetadata = {},
  currentUser,
  onSaveSuccess,
  onCancel,
}) => {
  const [docIcon, setDocIcon] = useState(initialMetadata.icon || '🧠');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [title, setTitle] = useState(initialTitle || 'Untitled Research Note');
  const [category, setCategory] = useState(initialMetadata.category || '01_agentic_ai_systems');
  const [tags, setTags] = useState<string[]>(initialMetadata.tags || []);
  const [newTagInput, setNewTagInput] = useState('');
  const [summary, setSummary] = useState(initialMetadata.summary || '');
  const [isPublic, setIsPublic] = useState<boolean>(Boolean(initialMetadata.is_public));
  const [showProperties, setShowProperties] = useState(false);

  // Editor View Mode: 'visual' | 'split' | 'source'
  const [viewMode, setViewMode] = useState<'visual' | 'split' | 'source'>('visual');
  const [rawSourceContent, setRawSourceContent] = useState('');
  // Ref mirror so the long-lived Tiptap onUpdate closure always sees the current mode
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // Ref mirrors for menu-open flags (same stale-closure reason as viewModeRef)
  const showSlashMenuRef = useRef(false);
  const showWikilinkMenuRef = useRef(false);
  // Dirty-tracking for unsaved-changes guard
  const [isDirty, setIsDirtyState] = useState(false);
  const isDirtyRef = useRef(false);
  const setIsDirty = (dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirtyState(dirty);
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const [mdxImports, setMdxImports] = useState<string[]>([]);
  const [newImport, setNewImport] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  // Always points at the latest handleSave so the global keydown listener never goes stale
  const handleSaveRef = useRef<() => void>(() => {});

  // Caret-Anchored Slash Command Menu State
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuQuery, setSlashMenuQuery] = useState('');
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  // Wikilink / Embed Autocomplete State
  const [showWikilinkMenu, setShowWikilinkMenu] = useState(false);
  const [isEmbedMode, setIsEmbedMode] = useState(false);
  const [wikilinkQuery, setWikilinkQuery] = useState('');
  const [wikilinkIndex, setWikilinkIndex] = useState(0);
  const [wikilinkLoading, setWikilinkLoading] = useState(false);
  const [wikilinkCandidates, setWikilinkCandidates] = useState<WikilinkCandidate[]>([]);
  const wikilinkFetchRef = useRef<AbortController | null>(null);
  const wikilinkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monotonic counter bumped on every document mutation (drives autosave).
  const [docVersion, setDocVersion] = useState(0);

  // Keep the onUpdate menu refs in sync with every state change (Escape, onClose, selection, ...)
  useEffect(() => {
    showSlashMenuRef.current = showSlashMenu;
  }, [showSlashMenu]);
  useEffect(() => {
    showWikilinkMenuRef.current = showWikilinkMenu;
  }, [showWikilinkMenu]);

  // Parse existing MDX imports from initial content
  useEffect(() => {
    const importRegex = /^import\s+.*?;?\s*$/gm;
    const imports = initialContent.match(importRegex) || [];
    setMdxImports(imports.map((i) => i.trim()));
  }, []);

  // Convert raw markdown with frontmatter to initial body
  const cleanInitialBody = initialContent
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/^import\s+.*?;?\s*$/gm, '')
    .trim();

  // Setup Adaptive JIT Collaboration (Zero DO cost when solo). The hook owns
  // the manager lifecycle (start on mount, destroy on unmount).
  const userColor = useRef(getRandomColor());
  const { manager, ydoc, state: collabState, toggleLive } = useCollaboration(resourceId, {
    name: currentUser,
    color: userColor.current,
    userId: currentUser,
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'editor-code-block' } },
        // StarterKit v3 bundles Link + UndoRedo; Link is configured separately below,
        // and history must be disabled because Yjs owns the undo stack.
        link: false,
        undoRedo: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'editor-link' },
      }),
      Image.configure({
        HTMLAttributes: { class: 'editor-image' },
      }),
      Markdown,
      GlobalDragHandle.configure({
        dragHandleWidth: 24,
        scrollTreshold: 100,
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      ...(manager.provider
        ? [
            CollaborationCursor.configure({
              provider: manager.provider,
              user: { name: currentUser, color: userColor.current },
            }),
          ]
        : []),
      ...getRegisteredEditorExtensions(),
    ],
    content: ydoc.getXmlFragment('default').length === 0 ? (cleanInitialBody || '<p>Start typing or press <code>/</code> to insert components...</p>') : undefined,
    onUpdate: ({ editor }) => {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from, '\n');
      setIsDirty(true);
      setDocVersion((v) => v + 1);

      // Slash trigger
      if (textBefore.endsWith('/')) {
        setShowSlashMenu(true);
        showSlashMenuRef.current = true;
        setSlashMenuQuery('');
        setSlashMenuIndex(0);
      } else if (showSlashMenuRef.current) {
        const slashIdx = textBefore.lastIndexOf('/');
        if (slashIdx !== -1) {
          setSlashMenuQuery(textBefore.substring(slashIdx + 1));
        } else {
          setShowSlashMenu(false);
          showSlashMenuRef.current = false;
        }
      }

      // Wikilink or Embed trigger [[ or ![[
      if (textBefore.endsWith('[[')) {
        setShowWikilinkMenu(true);
        showWikilinkMenuRef.current = true;
        setIsEmbedMode(textBefore.endsWith('![['));
        setWikilinkQuery('');
        setWikilinkIndex(0);
        fetchWikilinkSuggestions('');
      } else if (showWikilinkMenuRef.current) {
        const query = readTriggerQuery(editor, '[[');
        if (query === null) {
          setShowWikilinkMenu(false);
          showWikilinkMenuRef.current = false;
        } else {
          setWikilinkQuery(query);
          setWikilinkIndex(0);
          scheduleWikilinkFetch(query);
        }
      }

      // Keep the raw-viewport in sync while in split mode (ref avoids stale closure)
      if (viewModeRef.current === 'split') {
        setRawSourceContent(editor.storage.markdown?.getMarkdown() || '');
      }
    },
    // Tiptap's Collaboration extension ignores `content` while the Yjs fragment is empty,
    // so seed the document once the editor (and Yjs binding) is ready.
    onCreate: ({ editor }) => {
      if (editor.isEmpty && cleanInitialBody) {
        editor.commands.setContent(cleanInitialBody);
        setIsDirty(false);
      }
    },
  }, [manager.provider]);

  const fetchWikilinkSuggestions = (q: string) => {
    wikilinkFetchRef.current?.abort();
    const controller = new AbortController();
    wikilinkFetchRef.current = controller;
    setWikilinkLoading(true);
    fetchWikilinkCandidates(q, controller.signal)
      .then((candidates) => {
        if (!controller.signal.aborted) setWikilinkCandidates(candidates);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setWikilinkCandidates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setWikilinkLoading(false);
      });
  };

  const scheduleWikilinkFetch = (q: string) => {
    if (wikilinkDebounceRef.current) clearTimeout(wikilinkDebounceRef.current);
    wikilinkDebounceRef.current = setTimeout(() => fetchWikilinkSuggestions(q), 150);
  };

  // Keyboard navigation & Shortcuts (menu arrows/Enter are owned by the menus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        setShowWikilinkMenu(false);
        setShowIconPicker(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamically registered slash commands
  // NOTE: referenced via `React.useMemo` (not a named import) to avoid a Rolldown
  // bundler bug where the named `useMemo` import is aliased but one reference is
  // left un-renamed, producing "ReferenceError: useMemo is not defined" during SSR.
  const slashCommands = React.useMemo(() => getRegisteredSlashCommands(), []);

  useEffect(() => {
    const handleEmbedTrigger = () => {
      setIsEmbedMode(true);
      setShowWikilinkMenu(true);
      setWikilinkQuery('');
      setWikilinkIndex(0);
      fetchWikilinkSuggestions('');
    };
    window.addEventListener('editor:open-wikilink-embed', handleEmbedTrigger);
    return () => window.removeEventListener('editor:open-wikilink-embed', handleEmbedTrigger);
  }, []);

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const clean = newTagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setNewTagInput('');
      setIsDirty(true);
    }
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((item) => item !== t));
    setIsDirty(true);
  };

  const handleAddImport = () => {
    const clean = newImport.trim();
    if (!clean || mdxImports.includes(clean)) return;
    setMdxImports([...mdxImports, clean]);
    setNewImport('');
    setIsDirty(true);
  };

  // Persists the current document. Throws on failure so callers (manual + autosave)
  // can decide how to surface it. Frontmatter is generated server-side, so only the
  // body is sent (avoids double frontmatter).
  const performSave = async (): Promise<void> => {
    if (!editor) return;
    const rawMarkdown = viewMode === 'source' ? rawSourceContent : (editor.storage.markdown?.getMarkdown() || '');
    const importsText = mdxImports.length > 0 ? mdxImports.join('\n') + '\n\n' : '';

    const res = await fetch('/api/v1/resources/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: resourceId,
        title,
        content: importsText + rawMarkdown,
        category,
        tags,
        summary,
        is_public: isPublic,
        icon: docIcon,
        type: 'mdx',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  };

  // A single serialized snapshot drives autosave. Structural fields + content +
  // the source-mode buffer are all included so nothing silently misses a save.
  const autosaveSnapshot = JSON.stringify({
    v: docVersion,
    title,
    category,
    tags,
    summary,
    isPublic,
    docIcon,
    mdxImports,
    source: viewMode === 'source' ? rawSourceContent : '',
  });

  const autosave = useAutosave({
    snapshot: autosaveSnapshot,
    save: performSave,
    enabled: isDirty,
    onSaved: () => setIsDirty(false),
  });

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      await autosave.flush();
      setSaveStatus('Saved successfully!');
      onSaveSuccess?.();
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  const handleExit = async () => {
    if (isSaving || autosave.isPending) {
      try {
        // Do not navigate away while a request is in flight or a debounced
        // snapshot is queued. flush() drains edits made during that request too.
        await autosave.flush();
        setIsDirty(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed';
        setSaveStatus(`Error: ${message}`);
        return;
      }
    } else if (isDirty && !window.confirm('You have unsaved changes. Leave the editor and discard them?')) {
      return;
    }
    if (onCancel) {
      onCancel();
      return;
    }
    window.location.href = `/?doc=${encodeURIComponent(resourceId)}`;
  };

  if (!editor) return null;

  return (
    <div className="ui-card editor-shell">
      {/* FLOATING CONTEXTUAL MENUS */}
      <BubbleToolbar editor={editor} />

      <SlashCommandMenu
        editor={editor}
        isOpen={showSlashMenu}
        onClose={() => setShowSlashMenu(false)}
        query={slashMenuQuery}
        selectedIndex={slashMenuIndex}
        onSelectIndex={(idx) => setSlashMenuIndex(idx)}
        commands={slashCommands}
      />

      <WikilinkMenu
        editor={editor}
        isOpen={showWikilinkMenu}
        mode={isEmbedMode ? 'embed' : 'link'}
        query={wikilinkQuery}
        candidates={wikilinkCandidates}
        selectedIndex={wikilinkIndex}
        onSelectIndex={setWikilinkIndex}
        onClose={() => {
          setShowWikilinkMenu(false);
          showWikilinkMenuRef.current = false;
        }}
        loading={wikilinkLoading}
      />

      {/* TOP CONTROLS & TRI-MODE SWITCHER BAR */}
      <div className="editor-toolbar">
        <div className="editor-toolbar__views">
          <div className="editor-mode-actions" role="group" aria-label="Editor view">
            {(['visual', 'split', 'source'] as const).map((mode) => (
              <Button key={mode} type="button" size="sm"
                variant={viewMode === mode ? 'primary' : 'secondary'}
                aria-pressed={viewMode === mode}
                onClick={() => {
                  if (mode === viewMode) return;
                  if (viewMode === 'source') {
                    editor.commands.setContent(rawSourceContent);
                  } else if (mode !== 'visual') {
                    setRawSourceContent(editor.storage.markdown?.getMarkdown() || '');
                  }
                  setViewMode(mode);
                }}>
                {mode === 'visual' ? 'Visual' : mode === 'split' ? 'Split' : 'Source'}
              </Button>
            ))}
          </div>
          <Button type="button" size="sm"
            data-testid="editor-properties-toggle"
            onClick={() => setShowProperties(!showProperties)}
            aria-expanded={showProperties}>
            {showProperties ? 'Hide properties' : 'Properties'}
          </Button>
        </div>

        {/* Collaboration and persistence controls */}
        <div className="editor-save-actions">
          <Button
            type="button"
            size="sm"
            variant={collabState.forcedLive ? 'primary' : 'secondary'}
            onClick={toggleLive}
            aria-pressed={collabState.forcedLive}
            title={collabState.forcedLive ? 'Return to automatic live editing when other viewers are present' : 'Keep live editing on even when you are the only viewer'}
          >
            {collabState.forcedLive ? 'Use automatic live editing' : 'Keep live editing on'}
          </Button>

          <span className="editor-save-status" role="status">
            {collabState.mode === 'solo' ? 'Editing solo' : collabState.isConnectedToDO ? `Live editing · ${collabState.activeViewers} viewing` : 'Connecting to live editing…'}
          </span>

          <div className="editor-save-status" role="status" aria-live="polite" aria-atomic="true">
          {saveStatus ? (
            <span className={saveStatus.startsWith('Error') ? 'editor-save-status__error' : 'editor-save-status__success'}>
              {saveStatus}
            </span>
          ) : autosave.status === 'error' ? (
            <Button type="button" variant="danger" size="sm" onClick={handleSave}>
              Retry save
            </Button>
          ) : autosave.status === 'saving' ? (
            <span>Saving…</span>
          ) : autosave.status === 'pending' || isDirty ? (
            <span>Unsaved changes</span>
          ) : autosave.status === 'saved' && autosave.lastSavedAt ? (
            <span className="editor-save-status__success" title="Autosaved">
              Autosaved {autosave.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          </div>

          <Button type="button" size="sm" onClick={handleExit}>
            Exit editor
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={isSaving} aria-keyshortcuts="Control+s Meta+s">
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* NOTION-STYLE DOCUMENT HEADER */}
      <div className="editor-document-heading">
        <Button type="button" className="editor-icon-trigger"
          onClick={() => setShowIconPicker(true)} aria-label="Change note icon"
          aria-haspopup="dialog" aria-expanded={showIconPicker}>
          <span aria-hidden="true">{docIcon}</span>
        </Button>
        <Modal open={showIconPicker} onClose={() => setShowIconPicker(false)} title="Choose a note icon">
          <div className="editor-icon-grid">
            {[
              ['🧠', 'Brain'], ['⚡', 'Lightning'], ['📊', 'Chart'], ['📝', 'Note'],
              ['🗺️', 'Map'], ['💡', 'Idea'], ['🌐', 'Globe'], ['🔬', 'Microscope'],
              ['🚀', 'Rocket'], ['📗', 'Book'],
            ].map(([icon, label]) => (
              <Button key={icon} type="button" aria-label={label} aria-pressed={docIcon === icon}
                variant={docIcon === icon ? 'primary' : 'secondary'}
                onClick={() => { setDocIcon(icon); setIsDirty(true); setShowIconPicker(false); }}>
                <span aria-hidden="true">{icon}</span>
              </Button>
            ))}
          </div>
        </Modal>

        {/* Large Borderless Auto-Expanding Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
          placeholder="Untitled Note..."
          aria-label="Note title"
          className="ui-input editor-title-input"
        />

        {/* PROPERTIES DRAWER */}
        {showProperties && (
          <div className="editor-properties">
            <Input label="Category" value={category}
              onChange={(e) => { setCategory(e.target.value); setIsDirty(true); }}
              placeholder="e.g. Research" />

            <div className="ui-field">
              <label className="editor-public-toggle">
                <input type="checkbox" checked={isPublic}
                  onChange={(e) => { setIsPublic(e.target.checked); setIsDirty(true); }} />
                <span>Make this note public</span>
              </label>
              <span className="ui-field__hint">
                Turning public access off does not remove existing sharing grants.
              </span>
            </div>

            <div className="editor-properties__wide">
              <div className="editor-tag-list" aria-label="Current tags">
                {tags.map((tag) => (
                  <Badge key={tag} tone="info">
                    #{tag}
                    <Button type="button" size="sm" variant="ghost"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => handleRemoveTag(tag)}>Remove</Button>
                  </Badge>
                ))}
              </div>
              <div className="editor-tag-entry">
                <Input label="Add a tag" value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={handleAddTag} placeholder="e.g. research" />
                <Button type="button" size="sm" onClick={handleAddTag}
                  disabled={!newTagInput.trim()}>Add tag</Button>
              </div>
            </div>

            <div className="editor-properties__wide">
              <TextArea label="Summary" value={summary}
                onChange={(e) => { setSummary(e.target.value); setIsDirty(true); }}
                hint="Shown in search results and previews."
                placeholder="Briefly describe this note" rows={2} />
            </div>

            <div className="editor-properties__wide">
              <p className="ui-field__label">MDX imports (advanced)</p>
              <div className="editor-import-list">
                {mdxImports.length === 0 && <span className="ui-field__hint">No imports yet.</span>}
                {mdxImports.map((entry, index) => (
                  <div key={`${entry}-${index}`} className="editor-import-row">
                    <code>{entry}</code>
                    <Button type="button" size="sm" variant="ghost"
                      aria-label={`Remove import ${entry}`}
                      onClick={() => { setMdxImports(mdxImports.filter((_, i) => i !== index)); setIsDirty(true); }}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <div className="editor-tag-entry">
                <Input label="Add MDX import" value={newImport}
                  onChange={(e) => setNewImport(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddImport(); } }}
                  placeholder='import Note from "./Note.mdx";' />
                <Button type="button" size="sm" onClick={handleAddImport}
                  disabled={!newImport.trim() || mdxImports.includes(newImport.trim())}>Add import</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Editor workspace */}
      {viewMode === 'visual' && (
        <div className="prose-content novel-editor-body editor-visual-pane">
          <EditorContent editor={editor} />
        </div>
      )}
      {viewMode === 'split' && (
        <div className="editor-split-view">
          <div className="prose-content novel-editor-body editor-visual-pane">
            <EditorContent editor={editor} />
          </div>
          <section className="editor-source-preview" aria-label="Read-only Markdown source preview">
            <p className="editor-source-preview__label">Source preview (read-only)</p>
            <pre>{rawSourceContent || editor.storage.markdown?.getMarkdown() || '// Empty document'}</pre>
          </section>
        </div>
      )}

      {viewMode === 'source' && (
        <div className="editor-source-view">
          <textarea
            value={rawSourceContent}
            onChange={(e) => {
              setRawSourceContent(e.target.value);
              setIsDirty(true);
            }}
            aria-label="Markdown source"
            className="ui-input editor-source-input"
            spellCheck={false}
          />
        </div>
      )}

      <div className="editor-footer">
        <span>Type <code>/</code> to insert a block.</span>
        <span>Type <code>[[</code> to link a note.</span>
        <span>Press <code>Ctrl/Cmd+S</code> to save.</span>
      </div>
    </div>
  );
};
