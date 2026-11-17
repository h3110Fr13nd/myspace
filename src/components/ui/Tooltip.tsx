import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { computePosition, autoUpdate, offset, shift, flip, type Placement } from '@floating-ui/dom';

export interface TooltipProps {
  content: React.ReactNode;
  side?: Placement;
  /** Delay before showing, in ms. */
  delay?: number;
  disabled?: boolean;
  children: React.ReactNode;
}

/** Lightweight floating tooltip built on @floating-ui/dom (already a dependency). */
export const Tooltip: React.FC<TooltipProps> = ({ content, side = 'top', delay = 300, disabled, children }) => {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top?: number; left?: number; transform?: string }>({});
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const cleanup = autoUpdate(
      trigger,
      tooltip,
      () => {
        computePosition(trigger, tooltip, {
          placement: side,
          middleware: [offset(6), shift({ padding: 8 }), flip()],
        }).then(({ x, y, placement }) => {
          const style: { top?: number; left?: number; transform?: string } = { top: 0, left: 0 };
          if (placement.startsWith('bottom')) style.transform = `translate(${x}px, ${y + 6}px)`;
          else if (placement.startsWith('top')) style.transform = `translate(${x}px, ${y - 6}px)`;
          else style.transform = `translate(${x}px, ${y}px)`;
          setCoords(style);
        });
      },
      { animationFrame: true }
    );
    return cleanup;
  }, [visible, side, content]);

  const show = () => {
    if (disabled) return;
    timeoutRef.current = window.setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  return (
    <>
      <span ref={triggerRef} style={{ display: 'inline-flex' }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {visible && typeof document !== 'undefined'
        ? createPortal(
            <div ref={tooltipRef} className="ui-tooltip" style={coords}>
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  );
};