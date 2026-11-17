import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button';

export type DrawerSide = 'left' | 'right';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  /** CSS width value for the panel, e.g. '320px' or 'min(380px, 92vw)'. */
  width?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hasBackdrop?: boolean;
}

/** Floating side panel with backdrop + Escape close. */
export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  side = 'right',
  width = 'min(360px, 92vw)',
  header,
  footer,
  children,
  className,
  hasBackdrop = true,
}) => {
  const panelRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const getFocusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => element.getClientRects().length > 0);

    const frame = window.requestAnimationFrame(() => {
      (getFocusable()[0] ?? panelRef.current)?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {hasBackdrop && <div className="ui-drawer-backdrop" onMouseDown={onClose} />}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={[`ui-drawer ui-drawer--${side}`, className ?? ''].filter(Boolean).join(' ')}
        style={{ width, ['--ui-drawer-from' as string]: side === 'left' ? '-24px' : '24px' }}
      >
        {(header !== undefined) && (
          <div className="ui-drawer__header">
            <div className="ui-modal__title">{header}</div>
            <IconButton label="Close panel" ghost onClick={onClose}><X size={18} /></IconButton>
          </div>
        )}
        <div className="ui-drawer__body">{children}</div>
        {footer !== undefined && <div className="ui-drawer__footer">{footer}</div>}
      </aside>
    </>,
    document.body
  );
};
