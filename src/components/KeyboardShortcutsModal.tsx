import React, { useEffect, useState } from 'react';
import { Modal, Stack } from './ui';
import { Keyboard } from 'lucide-react';

const SHORTCUTS: Array<{
  keyGroups: string[][];
  label: string;
  description: string;
  requiresElement?: string;
}> = [
  {
    keyGroups: [['/'], ['Ctrl/⌘', 'K']],
    label: 'Search workspace',
    description: 'Find resources or create something new',
  },
  {
    keyGroups: [['M']],
    label: 'Reader mode',
    description: 'Show or hide the side panels on a note page',
    requiresElement: 'reader-mode-toggle',
  },
  {
    keyGroups: [['[']],
    label: 'Resource explorer',
    description: 'Collapse or expand the resource explorer',
    requiresElement: 'sidebar-left-toggle',
  },
  { keyGroups: [['T']], label: 'Theme', description: 'Switch between light and dark themes' },
  { keyGroups: [['?']], label: 'Shortcut guide', description: 'Open or close this guide' },
  { keyGroups: [['Esc']], label: 'Close', description: 'Dismiss the open dialog or menu' },
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="keyboard-shortcuts__key">{children}</kbd>
);

export const KeyboardShortcutsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [availableElements, setAvailableElements] = useState<string[]>([]);

  useEffect(() => {
    const updateAvailableElements = () => {
      setAvailableElements(
        SHORTCUTS.flatMap((shortcut) =>
          shortcut.requiresElement && document.getElementById(shortcut.requiresElement)
            ? [shortcut.requiresElement]
            : []
        )
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Leave native form controls and editable content to their own keys.
      const target = e.target;
      if (
        target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')
        || target instanceof HTMLElement && target.isContentEditable
      ) {
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!isOpen) updateAvailableElements();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      } else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !isOpen) {
        // Toggle theme shortcut (the control may live in either rail)
        document.querySelector<HTMLElement>('[data-action="theme"]')?.click();
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !isOpen) {
        // Toggle reader mode shortcut
        const btn = document.getElementById('reader-mode-toggle');
        if (btn) btn.click();
      }
    };

    const handleCustomOpen = () => {
      updateAvailableElements();
      setIsOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-keyboard-shortcuts', handleCustomOpen);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-keyboard-shortcuts', handleCustomOpen);
    };
  }, [isOpen]);

  return (
    <Modal
      open={isOpen}
      onClose={() => setIsOpen(false)}
      size="md"
      title={
        <div className="ui-row ui-gap-2">
          <Keyboard size={20} className="ui-shrink0 ui-icon-accent" />
          <div>
            <div>Keyboard Shortcuts</div>
            <div className="ui-field__hint">Quick ways to search and control your workspace</div>
          </div>
        </div>
      }
    >
      <Stack gap={2}>
        {SHORTCUTS.filter((shortcut) => !shortcut.requiresElement || availableElements.includes(shortcut.requiresElement)).map((s) => (
          <div key={s.label} className="keyboard-shortcuts__item">
            <div className="ui-col ui-gap-1">
              <span className="ui-field__label">{s.label}</span>
              <span className="ui-field__hint">{s.description}</span>
            </div>
            <div className="keyboard-shortcuts__keys">
              {s.keyGroups.map((group, groupIndex) => (
                <React.Fragment key={groupIndex}>
                  {groupIndex > 0 && <span className="keyboard-shortcuts__or">or</span>}
                  {group.map((key, keyIndex) => (
                    <React.Fragment key={key}>
                      {keyIndex > 0 && <span className="keyboard-shortcuts__plus" aria-hidden="true">+</span>}
                      <Kbd>{key}</Kbd>
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </Stack>

      <div className="ui-col ui-align-center ui-mt-4">
        <span className="ui-field__hint ui-text-center">
          Press <Kbd>?</Kbd> outside form fields to open this guide. Press <Kbd>Esc</Kbd> to close.
        </span>
      </div>
    </Modal>
  );
};
