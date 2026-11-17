import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: ModalSize;
  showClose?: boolean;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const sizeClass: Record<ModalSize, string> = {
  sm: 'ui-modal--sm',
  md: 'ui-modal--md',
  lg: 'ui-modal--lg',
  full: 'ui-modal--full',
};

/** Shared modal primitive: portal, backdrop, Escape, focus trap, scroll lock. */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  size = 'md',
  showClose = true,
  closeOnBackdrop = true,
  footer,
  children,
  className,
  bodyClassName,
  initialFocusRef,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const stopPropagation = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCloseRef.current();
    if (e.key === 'Tab' && panelRef.current) {
      const nodes = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    const raf = requestAnimationFrame(() => {
      const initialFocus = initialFocusRef?.current
        ?? panelRef.current?.querySelector<HTMLElement>('[autofocus]');
      (initialFocus ?? panelRef.current)?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(raf);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, handleKeyDown, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={['ui-modal', sizeClass[size], className ?? ''].filter(Boolean).join(' ')}
        onMouseDown={stopPropagation}
      >
        {(title !== undefined || showClose) && (
          <div className="ui-modal__header">
            <div className="ui-modal__title">{title}</div>
            {showClose && <IconButton label="Close dialog" ghost onClick={onClose}><X size={18} /></IconButton>}
          </div>
        )}
        <div className={['ui-modal__body', bodyClassName ?? ''].filter(Boolean).join(' ')}>{children}</div>
        {footer !== undefined && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
