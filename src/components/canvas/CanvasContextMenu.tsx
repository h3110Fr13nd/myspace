import React, { useEffect, useRef, useState } from 'react';
import type { CanvasColorCode } from './types';
import { COLOR_MAP } from './types';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  action?: () => void;
  subItems?: ContextMenuItem[];
}

interface CanvasContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubMenuId, setActiveSubMenuId] = useState<string | null>(null);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });

  // Boundary clipping protection: ensure menu stays within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 12;
    let nextX = x;
    let nextY = y;

    if (nextX + rect.width > window.innerWidth - padding) {
      nextX = Math.max(padding, window.innerWidth - rect.width - padding);
    }
    if (nextY + rect.height > window.innerHeight - padding) {
      nextY = Math.max(padding, window.innerHeight - rect.height - padding);
    }

    setAdjustedPos({ left: nextX, top: nextY });
  }, [x, y]);

  // Click outside & Escape dismissal
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      style={{
        position: 'fixed',
        left: `${adjustedPos.left}px`,
        top: `${adjustedPos.top}px`,
        zIndex: 999999,
        minWidth: '220px',
        maxWidth: '280px',
        background: 'rgba(15, 23, 42, 0.96)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '10px',
        padding: '6px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 242, 254, 0.15)',
        color: '#f8fafc',
        fontSize: '0.82rem',
        userSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        if (item.divider) {
          return (
            <div
              key={item.id}
              style={{
                height: '1px',
                background: 'rgba(255, 255, 255, 0.08)',
                margin: '5px 4px',
              }}
            />
          );
        }

        const hasSub = Boolean(item.subItems && item.subItems.length > 0);
        const isSubOpen = activeSubMenuId === item.id;

        return (
          <div
            key={item.id}
            onMouseEnter={() => setActiveSubMenuId(hasSub ? item.id : null)}
            style={{ position: 'relative' }}
          >
            <button
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (!hasSub && item.action) {
                  item.action();
                  onClose();
                }
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '6px',
                background: isSubOpen ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                border: 'none',
                color: item.disabled
                  ? 'var(--text-muted, #64748b)'
                  : item.danger
                    ? '#f43f5e'
                    : '#f8fafc',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                fontSize: '0.8rem',
                transition: 'background 0.12s ease, color 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  e.currentTarget.style.background = item.danger
                    ? 'rgba(244, 63, 94, 0.18)'
                    : 'rgba(0, 242, 254, 0.14)';
                }
              }}
              onMouseLeave={(e) => {
                if (!item.disabled && !isSubOpen) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                {item.icon && <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{item.icon}</span>}
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {item.shortcut && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted, #94a3b8)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {item.shortcut}
                  </span>
                )}
                {hasSub && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #94a3b8)' }}>▶</span>
                )}
              </div>
            </button>

            {/* Sub-menu flyout */}
            {hasSub && isSubOpen && item.subItems && (
              <div
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: '-4px',
                  marginLeft: '4px',
                  minWidth: '200px',
                  background: 'rgba(15, 23, 42, 0.98)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '10px',
                  padding: '6px',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 242, 254, 0.15)',
                  zIndex: 1000000,
                }}
              >
                {item.subItems.map((sub) => {
                  if (sub.divider) {
                    return (
                      <div
                        key={sub.id}
                        style={{
                          height: '1px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          margin: '5px 4px',
                        }}
                      />
                    );
                  }
                  return (
                    <button
                      key={sub.id}
                      disabled={sub.disabled}
                      onClick={() => {
                        if (sub.disabled) return;
                        if (sub.action) {
                          sub.action();
                          onClose();
                        }
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: 'transparent',
                        border: 'none',
                        color: sub.disabled
                          ? 'var(--text-muted, #64748b)'
                          : sub.danger
                            ? '#f43f5e'
                            : '#f8fafc',
                        cursor: sub.disabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        fontSize: '0.8rem',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!sub.disabled) {
                          e.currentTarget.style.background = sub.danger
                            ? 'rgba(244, 63, 94, 0.18)'
                            : 'rgba(0, 242, 254, 0.14)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!sub.disabled) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {sub.icon && (
                          <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{sub.icon}</span>
                        )}
                        <span>{sub.label}</span>
                      </div>
                      {sub.shortcut && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-muted, #94a3b8)',
                            fontFamily: 'monospace',
                          }}
                        >
                          {sub.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
