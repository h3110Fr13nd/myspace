import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Badge, EmptyState, LoadingState, Tabs, Flex, Stack } from '../ui';
import { Search, Package, Table, PenTool, LayoutGrid, Notebook, Workflow } from 'lucide-react';

export interface PickedResource {
  id: string;
  type: string;
  title: string;
  category?: string;
  summary?: string;
  metadata?: any;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (resource: PickedResource) => void;
}

const TABS = ['all', 'sheet', 'excalidraw', 'canvas', 'jupyter', 'mermaid', 'paper', 'document'] as const;
type TabValue = (typeof TABS)[number];

const TAB_LABELS: Record<TabValue, string> = {
  all: 'All',
  sheet: 'Sheet',
  excalidraw: 'Excalidraw',
  canvas: 'Canvas',
  jupyter: 'Jupyter',
  mermaid: 'Mermaid',
  paper: 'Paper',
  document: 'Doc',
};

export const ResourcePickerModal: React.FC<Props> = ({ isOpen, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [results, setResults] = useState<PickedResource[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // Run initial search for popular/default items
      fetchResources('ai');
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  const fetchResources = async (searchTerm: string) => {
    setLoading(true);
    try {
      const q = searchTerm.trim() || 'ai';
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.warn('[ResourcePicker] Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (val.trim().length >= 2) {
      fetchResources(val);
    }
  };

  const filteredResults = results.filter((r) => {
    if (activeTab === 'all') return true;
    return (
      r.type?.toLowerCase() === activeTab.toLowerCase() ||
      r.id?.toLowerCase().startsWith(`${activeTab.toLowerCase()}:`)
    );
  });

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <div className="ui-row ui-gap-2">
          <Package size={20} className="ui-shrink0 ui-icon-accent" />
          <span>Insert Resource as Canvas Node</span>
        </div>
      }
      footer={
        <Flex justify="between" gap={3} className="ui-full">
          <span className="ui-field__hint">Select an item to place it onto the canvas center.</span>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </Flex>
      }
    >
      <Stack gap={3}>
        {/* Modal Header & Search Bar */}
        <div className="ui-row ui-gap-2">
          <Search size={18} className="ui-shrink0 ui-icon-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search sheets, excalidraw sketches, canvases, papers, notebooks..."
            className="ui-input ui-grow"
          />
        </div>

        {/* Filter Tabs */}
        <Tabs
          aria-label="Filter resource types"
          items={TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
          value={activeTab}
          onChange={setActiveTab}
        />

        {/* Quick Create Strip: Instant node creation for Sheet, Excalidraw, Sub-Canvas, etc. */}
        <Flex wrap gap={2} className="ui-full ui-quick-create-strip">
          <span className="ui-shrink0 ui-quick-create-label">+ Create New:</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect({
                id: `sheet:sheet_${Date.now()}`,
                type: 'sheet',
                title: `Sheet ${new Date().toLocaleDateString()}`,
                summary: 'Interactive tabular data sheet',
              });
              onClose();
            }}
          >
            <Table size={14} /> Sheet
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect({
                id: `excalidraw:sketch_${Date.now()}`,
                type: 'excalidraw',
                title: `Sketch ${new Date().toLocaleDateString()}`,
                summary: 'Hand-drawn Excalidraw sketch',
              });
              onClose();
            }}
          >
            <PenTool size={14} /> Excalidraw
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect({
                id: `canvas:sub_${Date.now()}`,
                type: 'canvas',
                title: `Sub-Canvas ${new Date().toLocaleDateString()}`,
                summary: 'Recursive nested spatial canvas board',
              });
              onClose();
            }}
          >
            <LayoutGrid size={14} /> Sub-Canvas
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect({
                id: `jupyter:nb_${Date.now()}`,
                type: 'jupyter',
                title: `Notebook ${new Date().toLocaleDateString()}`,
                summary: 'Jupyter notebook with runnable cells',
              });
              onClose();
            }}
          >
            <Notebook size={14} /> Notebook
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect({
                id: `mermaid:dia_${Date.now()}`,
                type: 'mermaid',
                title: `Diagram ${new Date().toLocaleDateString()}`,
                summary: 'Mermaid flowchart & architecture diagram',
              });
              onClose();
            }}
          >
            <Workflow size={14} /> Diagram
          </Button>
        </Flex>

        {/* Results List */}
        {loading ? (
          <LoadingState label="Searching workspace resources..." />
        ) : filteredResults.length === 0 ? (
          <EmptyState
            icon={<Package size={28} />}
            title="No resources matched your search."
            description="Try searching by title, category, author, or keyword."
          />
        ) : (
          <Stack gap={2}>
            {filteredResults.map((item) => {
              const isCanvas = item.type === 'canvas' || item.id.startsWith('canvas:');
              const isPaper = item.type === 'paper' || item.id.startsWith('paper:');

              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                  className="ui-col ui-align-start ui-gap-1 ui-full ui-resource-item"
                >
                  <div className="ui-row ui-justify-between ui-gap-2 ui-full">
                    <Badge tone={isCanvas ? 'info' : isPaper ? 'neutral' : 'default'}>
                      {isCanvas ? 'Canvas Track' : isPaper ? 'Research Paper' : item.type}
                    </Badge>
                    <code className="ui-field__hint">{item.id}</code>
                  </div>

                  <h4 className="ui-resource-item__title">{item.title}</h4>

                  {item.summary && (
                    <p className="ui-resource-item__summary" dangerouslySetInnerHTML={{ __html: item.summary }} />
                  )}
                </button>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
};