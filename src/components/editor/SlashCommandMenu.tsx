import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Blocks,
  Code,
  FileText,
  Heading,
  Lightbulb,
  Link,
  List,
  ListOrdered,
  Notebook,
  Pencil,
  Quote,
  Sigma,
  Table,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useFloatingCaret } from './menu/useFloatingCaret';
import { useMenuKeyboard } from './menu/useMenuKeyboard';
import { Button } from '../ui/Button';

const COMMAND_ICONS: Record<string, LucideIcon> = {
  bases: Table,
  canvas: Blocks,
  mermaid: Workflow,
  excalidraw: Pencil,
  jupyter: Notebook,
  'google-sheet': Table,
  'google-doc': FileText,
  callout: Lightbulb,
  math: Sigma,
  embed: Link,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  'bullet-list': List,
  'numbered-list': ListOrdered,
  blockquote: Quote,
  'code-block': Code,
};

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  category: 'Components' | 'Structure' | 'Media' | 'Formatting';
  action: (editor: any) => void;
}

interface SlashCommandMenuProps {
  editor: any;
  isOpen: boolean;
  onClose: () => void;
  query: string;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  commands: SlashCommandItem[];
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  editor,
  isOpen,
  onClose,
  query,
  selectedIndex,
  onSelectIndex,
  commands,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const filteredCommands = useMemo(() => {
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  const safeIndex =
    filteredCommands.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), filteredCommands.length - 1);
  const selectedCommandId = filteredCommands[safeIndex]?.id;

  const runActiveCommand = useCallback(() => {
    const cmd = filteredCommands[safeIndex];
    if (cmd) cmd.action(editor);
  }, [filteredCommands, safeIndex, editor]);

  useFloatingCaret(editor, isOpen, menuRef, query);
  useMenuKeyboard({
    isOpen,
    itemCount: filteredCommands.length,
    activeIndex: safeIndex,
    onIndexChange: onSelectIndex,
    onSelect: runActiveCommand,
    onClose,
  });

  useEffect(() => {
    if (isOpen) {
      menuRef.current
        ?.querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, selectedCommandId]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="ui-card editor-command-menu"
      role="group"
      aria-label="Slash commands"
    >
      <div className="editor-command-menu__header">
        <span>Slash commands</span>
        <span className="editor-command-menu__hint">Use ↑ and ↓ to move, Enter to select, Esc to close</span>
      </div>

      {filteredCommands.length === 0 ? (
        <div className="editor-command-menu__empty" role="status">
          No matching commands. Try another search, or press Esc to close.
        </div>
      ) : (
        <div className="editor-command-menu__items">
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === safeIndex;
            return (
              <Button
                key={cmd.id}
                type="button"
                variant="ghost"
                size="sm"
                className={`editor-command-menu__item${isSelected ? ' is-selected' : ''}`}
                data-selected={isSelected}
                onClick={() => {
                  cmd.action(editor);
                  onClose();
                }}
                onMouseEnter={() => onSelectIndex(idx)}
              >
                <span className="editor-command-menu__icon" aria-hidden="true">
                  {React.createElement(COMMAND_ICONS[cmd.id] ?? Blocks, { size: 18, strokeWidth: 1.8 })}
                </span>
                <span className="editor-command-menu__copy">
                  <span className="editor-command-menu__item-heading">
                    <span className="editor-command-menu__title">{cmd.title}</span>
                    <span className="editor-command-menu__category">
                      {cmd.category}
                    </span>
                  </span>
                  <span className="editor-command-menu__description">{cmd.description}</span>
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
};
