import { type RefObject, useEffect } from 'react';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';

/**
 * Anchors a floating element to the current editor caret and keeps it on-screen.
 * Shared by every caret-triggered menu (slash, wikilink, ...).
 */
export function useFloatingCaret(
  editor: any,
  isOpen: boolean,
  ref: RefObject<HTMLElement | null>,
  repositionKey?: unknown
): void {
  useEffect(() => {
    if (!isOpen || !editor || !ref.current) return;

    const updatePosition = () => {
      try {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const anchor = {
          getBoundingClientRect() {
            return {
              width: 0,
              height: coords.bottom - coords.top,
              x: coords.left,
              y: coords.top,
              top: coords.top,
              left: coords.left,
              right: coords.right,
              bottom: coords.bottom,
            };
          },
        };

        computePosition(anchor, ref.current!, {
          placement: 'bottom-start',
          middleware: [offset(8), flip({ fallbackPlacements: ['top-start'] }), shift({ padding: 12 })],
        }).then(({ x, y }) => {
          if (ref.current) {
            ref.current.style.left = `${Math.round(x)}px`;
            ref.current.style.top = `${Math.round(y)}px`;
          }
        });
      } catch {
        // coordsAtPos can throw while the view is mid-transition; ignore.
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, editor, ref, repositionKey]);
}
