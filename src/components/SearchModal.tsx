import React, { useEffect, useId, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { RESOURCE_TYPE_CATALOG } from '../lib/registry/resourceRegistry';
import { openCreateResourceModal, type CreateResourceType } from '../lib/createResourceEvents';
import { Button, IconButton } from './ui/Button';
import { ResourceTypeIcon } from './ui/ResourceTypeIcon';
import { authHref } from '../lib/authRedirect';
import { FOCUS_WORKSPACE_SEARCH_EVENT } from '../lib/workspaceSearchEvents';

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  highlightedTitle?: string;
  url?: string;
  path: string;
  category: string;
  summary: string;
  tags: string[];
}

interface SearchModalProps {
  currentUser?: string;
  returnTo?: string;
  isAuthPage?: boolean;
}

interface CreateCommand {
  id: string;
  type: CreateResourceType;
  mode: 'create' | 'import';
  label: string;
  hint: string;
}

const CREATE_COMMANDS: CreateCommand[] = RESOURCE_TYPE_CATALOG.map((entry) => ({
  id: entry.type,
  type: entry.type as CreateResourceType,
  mode: entry.mode,
  label: entry.label,
  hint: entry.hint,
}));

export const SearchModal: React.FC<SearchModalProps> = ({ currentUser, returnTo = '/', isAuthPage = false }) => {
  const instanceId = useId().replace(/:/g, '');
  const resultsId = `search-results-popup-${instanceId}`;
  const resultsListId = `search-results-${instanceId}`;
  const commandsListId = `search-commands-${instanceId}`;
  const isAuthenticated = Boolean(currentUser && currentUser !== 'user:anonymous');
  const canCreateFromSearch = isAuthenticated || !isAuthPage;
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retrySearch, setRetrySearch] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearchReady, setIsSearchReady] = useState(false);
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl K');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // The global bridge owns / and Ctrl/Cmd+K so only one handler runs on a page.
  useEffect(() => {
    setIsSearchReady(true);
    setShortcutLabel(/Mac|iPhone|iPad/.test(window.navigator.platform) ? '⌘K' : 'Ctrl K');
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleFocusRequest = () => {
      if (!containerRef.current?.getClientRects().length) return;
      setIsOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
      window.__workspaceSearchFocusPending = false;
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener(FOCUS_WORKSPACE_SEARCH_EVENT, handleFocusRequest);
    window.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleOutsideClick);
    if (window.__workspaceSearchFocusPending) handleFocusRequest();
    return () => {
      window.removeEventListener(FOCUS_WORKSPACE_SEARCH_EVENT, handleFocusRequest);
      window.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const clientIndexRef = useRef<SearchResultItem[]>([]);
  const indexLoadedRef = useRef(false);

  // Warm the optional client index only when the user starts searching. Opening
  // the field or choosing a create command should not build a 500-item index.
  useEffect(() => {
    const query = queryText.trim();
    const isResourceSearch = query.length >= 2 && (!query.startsWith('>') || (isAuthPage && !isAuthenticated));
    if (isOpen && isResourceSearch && !indexLoadedRef.current) {
      indexLoadedRef.current = true;
      fetch('/api/v1/content/index.json', { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() : []))
        .then((items) => {
          clientIndexRef.current = items.map((i: any) => ({
            id: i.id,
            type: i.type,
            title: i.title,
            url: i.url,
            path: i.slug,
            category: i.category,
            summary: i.summary,
            tags: i.tags || [],
          }));
        })
        .catch(() => {});
    }
  }, [isOpen, queryText]);

  // Instant In-Memory + Debounced Meilisearch Hybrid Search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    setSearchError(false);
    setResults([]);

    // Command palette mode: query prefixed with ">"
    if (queryText.trim().startsWith('>') && canCreateFromSearch) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    if (!queryText || queryText.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const q = queryText.toLowerCase().trim();

    // 1. Instantaneous in-memory client search (< 1ms) with precision ranking
    if (clientIndexRef.current.length > 0) {
      const scoredMatches: { item: SearchResultItem; score: number }[] = [];

      for (const item of clientIndexRef.current) {
        const titleLower = item.title.toLowerCase();
        const summaryLower = item.summary.toLowerCase();
        const categoryLower = item.category.toLowerCase();
        const tagsLower = item.tags.map((t) => t.toLowerCase());

        let score = 0;
        if (titleLower === q) score += 100;
        else if (titleLower.includes(q)) score += 50;

        if (summaryLower.includes(q)) score += 30;
        if (tagsLower.some((t) => t.includes(q))) score += 20;
        if (categoryLower.includes(q)) score += 10;

        if (score > 0) {
          scoredMatches.push({ item, score });
        }
      }

      scoredMatches.sort((a, b) => b.score - a.score);
      const instantMatches = scoredMatches.slice(0, 15).map((m) => m.item);

      if (instantMatches.length > 0) {
        setResults(instantMatches);
      }
    }

    setIsLoading(true);

    // 2. Deep server-side Meilisearch query
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(queryText)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Search unavailable');
        const data = await res.json();
        if (!Array.isArray(data.results)) throw new Error('Invalid search response');
        if (controller.signal.aborted) return;
        setResults(data.results);
        setSelectedIndex(0);
      } catch (err) {
        if (!controller.signal.aborted) {
          setResults([]);
          setSelectedIndex(0);
          setSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 150);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryText, canCreateFromSearch, retrySearch]);

  const handleItemClick = (item: SearchResultItem) => {
    setIsOpen(false);
    window.location.href = item.url || `/?doc=${encodeURIComponent(item.id)}`;
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const count = isCommandMode ? filteredCommands.length : results.length;
      setSelectedIndex((prev) => (count > 0 ? (prev + 1) % count : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const count = isCommandMode ? filteredCommands.length : results.length;
      setSelectedIndex((prev) => (count > 0 ? (prev - 1 + count) % count : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isOpen || searchError) return;
      if (isCommandMode) {
        if (filteredCommands.length > 0 && selectedIndex >= 0 && selectedIndex < filteredCommands.length) {
          handleCommandSelect(filteredCommands[selectedIndex]);
        }
      } else if (results.length > 0 && selectedIndex >= 0 && selectedIndex < results.length) {
        handleItemClick(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const isCommandMode = queryText.trim().startsWith('>') && canCreateFromSearch;
  const hasPopup = isOpen && (isCommandMode || queryText.trim().length >= 2 || results.length > 0);
  const commandFilter = queryText.replace(/^>\s*/, '').trim().toLowerCase();
  const filteredCommands = isAuthenticated
    ? CREATE_COMMANDS.filter(
        (cmd) => cmd.label.toLowerCase().includes(commandFilter) || cmd.type.includes(commandFilter)
      )
    : [];

  const handleCommandSelect = (cmd: CreateCommand) => {
    setIsOpen(false);
    setQueryText('');
    openCreateResourceModal({ type: cmd.type, mode: cmd.mode });
  };

  const handleCreateNoteFromSearch = () => {
    const title = queryText.trim();
    setIsOpen(false);
    setQueryText('');
    openCreateResourceModal({ type: 'document', mode: 'create', title });
  };

  const handleOpenCommands = () => {
    setQueryText('>');
    setSelectedIndex(0);
    setIsOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const activeOptionId = isCommandMode
    ? `create-command-${instanceId}-${selectedIndex}`
    : `search-result-${instanceId}-${selectedIndex}`;
  const activeOptionExists = isCommandMode
    ? isAuthenticated && selectedIndex < filteredCommands.length
    : selectedIndex < results.length;

  return (
    <div ref={containerRef} className="search-modal">
      {/* NAVBAR SEARCH INPUT FIELD */}
      <div
        className={`search-input-shell${isOpen ? ' search-input-shell--open' : ''}`}
      >
        <Search size={16} className="search-input-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={canCreateFromSearch ? 'Search resources or create and import' : 'Search resources'}
          aria-keyshortcuts={shortcutLabel === '⌘K' ? '/ Meta+K' : '/ Control+K'}
          aria-haspopup={isCommandMode && !isAuthenticated ? undefined : 'listbox'}
          aria-autocomplete="list"
          aria-expanded={hasPopup}
          aria-controls={hasPopup
            ? isCommandMode
              ? isAuthenticated ? commandsListId : undefined
              : results.length > 0 ? resultsListId : undefined
            : undefined}
          aria-activedescendant={hasPopup && activeOptionExists ? activeOptionId : undefined}
          data-search-ready={isSearchReady}
          data-testid="search-input"
          value={queryText}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleInputKeyDown}
          onChange={(e) => {
            setQueryText(e.target.value);
            setSelectedIndex(0);
            setIsOpen(true);
          }}
          placeholder="Search resources"
          className="search-input-shell__input"
        />
        {canCreateFromSearch && (
          <IconButton
            label="Create or import"
            className="search-create-action"
            aria-haspopup={isAuthenticated ? 'listbox' : undefined}
            aria-expanded={isCommandMode && isOpen}
            aria-controls={isCommandMode && isOpen && isAuthenticated ? commandsListId : undefined}
            onClick={handleOpenCommands}
          >
            <Plus size={16} aria-hidden="true" />
          </IconButton>
        )}
        <kbd className="search-shortcut-hint">
          {shortcutLabel}
        </kbd>
      </div>

      {/* DROPDOWN SEARCH RESULTS POPUP CONTAINER */}
      {hasPopup && (
        <div
          id={resultsId}
          className="search-results-popup custom-scrollbar"
        >
          {/* Header */}
          <div className="search-results-popup__header">
            <span className="search-results-popup__status">
              {isCommandMode
                ? isAuthenticated ? `Create or import (${filteredCommands.length})` : 'Sign in to create or import'
                : isLoading ? 'Searching resources…' : searchError ? 'Search could not be completed' : `Found ${results.length} resources`}
            </span>
            <span className="search-results-popup__hint">
              {isCommandMode
                ? isAuthenticated ? 'Enter to create' : 'Sign in to continue'
                : searchError ? 'Tab to Try again' : results.length > 0 ? 'Use ↑ ↓ to navigate, Enter to open' : 'Try a different search'}
            </span>
          </div>

          {/* Command Palette (Creation Mode) */}
          {isCommandMode && (
            !isAuthenticated ? (
              <div className="ui-row ui-justify-between ui-align-center" role="status">
                <span className="ui-field__hint">Sign in to add resources to your workspace.</span>
                <a href={authHref('/login', returnTo)} className="ui-button ui-button--primary ui-button--sm">Sign in</a>
              </div>
            ) : (
            <div id={commandsListId} className="search-results-list" role="listbox" aria-label="Create or import commands">
              {filteredCommands.length === 0 ? (
                <div className="search-command-empty">
                  No creation commands match <code>"{commandFilter}"</code>
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <div
                    key={cmd.id}
                    id={`create-command-${instanceId}-${idx}`}
                    data-testid="create-command"
                    data-command-id={cmd.id}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    onClick={() => handleCommandSelect(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className="search-command-option"
                    data-selected={idx === selectedIndex}
                  >
                    <ResourceTypeIcon type={cmd.type} size={16} />
                    <span className="search-command-option__label">{cmd.label}</span>
                    <span className="search-command-option__hint">
                      {cmd.hint}
                    </span>
                  </div>
                ))
              )}
            </div>
            )
          )}

          {/* Results List */}
          {!isCommandMode && (searchError ? (
            <div className="ui-empty" role="alert">
              <div className="ui-empty__title">Search is unavailable</div>
              <p>Try again to search for these words.</p>
              <Button type="button" size="sm" onClick={() => setRetrySearch((value) => value + 1)}>Try again</Button>
            </div>
          ) : results.length === 0 && !isLoading ? (
            <div className="ui-empty" role="status">
              <div className="ui-empty__title">No matches</div>
              <p>
                {isAuthenticated
                  ? `Try fewer words, or create a note titled “${queryText.trim()}”.`
                  : isAuthPage
                    ? 'Try fewer words.'
                    : `Try fewer words. Sign in to create a note titled “${queryText.trim()}”.`}
              </p>
              {isAuthenticated ? (
                <Button type="button" size="sm" variant="primary" onClick={handleCreateNoteFromSearch}>
                  Create note
                </Button>
              ) : !isAuthPage && (
                <a href={authHref('/login', returnTo)} className="ui-button ui-button--primary ui-button--sm">Sign in</a>
              )}
            </div>
          ) : (
            <div id={resultsListId} className="search-results-list" role="listbox" aria-label="Search results">
              {results.map((item, idx) => (
                <div
                  key={item.id}
                  id={`search-result-${instanceId}-${idx}`}
                  data-testid="search-result"
                  data-resource-id={item.id}
                  role="option"
                  aria-selected={idx === selectedIndex}
                  onClick={() => handleItemClick(item)}
                  className="search-result-option"
                  data-selected={idx === selectedIndex}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="search-result-option__heading">
                    <ResourceTypeIcon type={item.type} size={16} />
                    <span 
                      className="search-result-option__title"
                      dangerouslySetInnerHTML={{ __html: item.highlightedTitle || item.title }}
                    />
                    <span className="search-result-option__category">
                      {item.category}
                    </span>
                  </div>

                  {item.summary && (
                    <p 
                      className="search-result-option__summary"
                      dangerouslySetInnerHTML={{ __html: item.summary }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
