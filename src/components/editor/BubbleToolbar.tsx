import React, { useState } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';

interface BubbleToolbarProps {
  editor: any;
}

const ACCENT = 'var(--accent-cyan)';

const toolbarButtonStyle = (active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '28px',
  height: '28px',
  padding: '0 6px',
  background: active ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
  border: active ? `1px solid ${ACCENT}` : '1px solid transparent',
  color: active ? ACCENT : '#fff',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  lineHeight: 1,
  ...extra,
});

const Divider: React.FC = () => (
  <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px' }} />
);

interface ToolbarButtonProps {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  extra?: React.CSSProperties;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ title, active = false, onClick, children, extra }) => (
  <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} style={toolbarButtonStyle(active, extra)}>
    {children}
  </button>
);

export const BubbleToolbar: React.FC<BubbleToolbarProps> = ({ editor }) => {
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  if (!editor) return null;

  const applyLink = () => {
    const href = linkUrl.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setIsLinkInputOpen(false);
    setLinkUrl('');
  };

  const openLinkEditor = () => {
    setLinkUrl(editor.getAttributes('link').href || '');
    setIsLinkInputOpen(true);
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed, from, to }) => from !== to && !ed.isActive('codeBlock')}
      options={{ placement: 'top', offset: 10 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        background: 'rgba(10, 15, 30, 0.96)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0, 242, 254, 0.4)',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 15px rgba(0, 242, 254, 0.2)',
        borderRadius: '10px',
        padding: '5px 8px',
        zIndex: 99999,
      }}
    >
      {isLinkInputOpen ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Paste URL or /slug..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') setIsLinkInputOpen(false);
            }}
            autoFocus
            style={{
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(0, 242, 254, 0.4)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '0.8rem',
              width: '200px',
              outline: 'none',
            }}
          />
          <ToolbarButton title="Apply link" onClick={applyLink} extra={{ background: ACCENT, color: '#050810', fontWeight: 700 }}>
            ✓
          </ToolbarButton>
          <ToolbarButton title="Remove link" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
            ⛓️‍💥
          </ToolbarButton>
        </div>
      ) : (
        <>
          <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} extra={{ fontWeight: 700 }}>
            B
          </ToolbarButton>
          <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} extra={{ fontStyle: 'italic' }}>
            I
          </ToolbarButton>
          <ToolbarButton
            title="Strikethrough"
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            extra={{ textDecoration: 'line-through' }}
          >
            S
          </ToolbarButton>
          <ToolbarButton
            title="Inline code"
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            extra={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
          >
            {'</>'}
          </ToolbarButton>

          <Divider />

          {[1, 2, 3].map((level) => (
            <ToolbarButton
              key={level}
              title={`Heading ${level}`}
              active={editor.isActive('heading', { level })}
              onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
              extra={{ fontWeight: 700 }}
            >
              H{level}
            </ToolbarButton>
          ))}

          <Divider />

          <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •≡
          </ToolbarButton>
          <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1≡
          </ToolbarButton>
          <ToolbarButton title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </ToolbarButton>
          <ToolbarButton title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} extra={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
            {'{ }'}
          </ToolbarButton>

          <Divider />

          <ToolbarButton title="Insert link" active={editor.isActive('link')} onClick={openLinkEditor}>
            🔗
          </ToolbarButton>
          {editor.isActive('link') && (
            <ToolbarButton title="Open link in new tab" onClick={() => window.open(editor.getAttributes('link').href, '_blank', 'noopener,noreferrer')}>
              ↗
            </ToolbarButton>
          )}
        </>
      )}
    </BubbleMenu>
  );
};
