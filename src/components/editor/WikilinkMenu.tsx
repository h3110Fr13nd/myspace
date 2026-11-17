import React, { useCallback, useRef } from 'react';
import { useFloatingCaret } from './menu/useFloatingCaret';
import { useMenuKeyboard } from './menu/useMenuKeyboard';
import { insertWikilink, type WikilinkCandidate, type WikilinkMode } from '../../lib/editor/wikilink';

interface WikilinkMenuProps {
  editor: any;
  isOpen: boolean;
  mode: WikilinkMode;
  query: string;
  candidates: WikilinkCandidate[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
  loading?: boolean;
}

export const WikilinkMenu: React.FC<WikilinkMenuProps> = ({
  editor,
  isOpen,
  mode,
  query,
  candidates,
  selectedIndex,
  onSelectIndex,
  onClose,
  loading = false,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visible = candidates.slice(0, 8);
  const safeIndex = visible.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), visible.length - 1);

  const selectActive = useCallback(() => {
    const candidate = visible[safeIndex];
    if (candidate) insertWikilink(editor, candidate, mode);
  }, [visible, safeIndex, editor, mode]);

  useFloatingCaret(editor, isOpen, menuRef, query);
  useMenuKeyboard({
    isOpen,
    itemCount: visible.length,
    activeIndex: safeIndex,
    onIndexChange: onSelectIndex,
    onSelect: selectActive,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="ui-card"
      style={{
        position: 'fixed',
        zIndex: 999999,
        width: '340px',
        maxHeight: '300px',
        overflowY: 'auto',
        background: 'rgba(8, 12, 26, 0.98)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(99, 102, 241, 0.4)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 25px rgba(99, 102, 241, 0.2)',
        borderRadius: '12px',
        padding: '6px',
        animation: 'fadeIn 0.1s ease',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          fontSize: '0.7rem',
          color: 'var(--accent-primary)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          display: 'flex',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '4px',
        }}
      >
        <span>{mode === 'embed' ? '⧉ Embed (Transclude)' : '🔗 Link to Note'}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>↑↓ · ↵</span>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
          {loading ? 'Searching…' : query ? `No notes match “${query}”` : 'No notes found'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {visible.map((candidate, idx) => {
            const isSelected = idx === safeIndex;
            return (
              <button
                key={candidate.id}
                ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onClick={() => {
                  insertWikilink(editor, candidate, mode);
                  onClose();
                }}
                onMouseEnter={() => onSelectIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '8px 10px',
                  background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                  border: isSelected ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid transparent',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ fontSize: '1rem' }}>{candidate.icon || '📄'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {candidate.title}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {candidate.category || candidate.slug}
                    </div>
                  </div>
                </div>
                {candidate.type && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      background: 'rgba(255,255,255,0.06)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {candidate.type}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
