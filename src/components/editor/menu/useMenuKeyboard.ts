import { useEffect } from 'react';

export interface MenuKeyboardOptions {
  isOpen: boolean;
  itemCount: number;
  activeIndex: number;
  onIndexChange: (index: number) => void;
  onSelect: () => void;
  onClose?: () => void;
}

/**
 * Capture-phase keyboard navigation shared by caret-triggered menus.
 * Up/Down wrap around, Enter selects, Escape closes.
 */
export function useMenuKeyboard({
  isOpen,
  itemCount,
  activeIndex,
  onIndexChange,
  onSelect,
  onClose,
}: MenuKeyboardOptions): void {
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          if (itemCount === 0) return;
          e.preventDefault();
          e.stopPropagation();
          onIndexChange((activeIndex + 1) % itemCount);
          break;
        case 'ArrowUp':
          if (itemCount === 0) return;
          e.preventDefault();
          e.stopPropagation();
          onIndexChange((activeIndex - 1 + itemCount) % itemCount);
          break;
        case 'Enter':
          if (itemCount === 0) return;
          e.preventDefault();
          e.stopPropagation();
          onSelect();
          onClose?.();
          break;
        case 'Escape':
          if (onClose) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, itemCount, activeIndex, onIndexChange, onSelect, onClose]);
}
