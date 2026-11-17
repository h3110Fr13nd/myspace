import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { computePosition, offset, flip, shift } from '@floating-ui/dom';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button } from './ui/Button';
import { FileText, Image, Layers, Table, ExternalLink } from 'lucide-react';

interface PreviewData {
  id: string;
  type: string;
  title: string;
  category: string;
  tags: string[];
  htmlBody: string;
}

const typeIconMap: Record<string, React.ReactNode> = {
  pdf: <FileText size={18} />,
  image: <Image size={18} />,
  canvas: <Layers size={18} />,
  sheet: <Table size={18} />,
};

export const WikilinkPreview: React.FC = () => {
  const [activePreview, setActivePreview] = useState<{
    data: PreviewData;
    targetEl: HTMLElement;
    anchor?: string;
  } | null>(null);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, PreviewData>>(new Map());

  const cancelTimers = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.wikilink-item') as HTMLAnchorElement | null;
      if (!target) return;

      const href = target.getAttribute('href');
      if (!href) return;

      const urlParams = new URLSearchParams(href.replace('/?', ''));
      const docParam = urlParams.get('doc');
      if (!docParam) return;

      // Check for anchor hash
      const hashIndex = docParam.indexOf('#');
      const cleanDoc = hashIndex !== -1 ? docParam.slice(0, hashIndex) : docParam;
      const anchor = hashIndex !== -1 ? docParam.slice(hashIndex + 1) : undefined;

      cancelTimers();

      // 280ms hover delay timer
      hoverTimerRef.current = setTimeout(async () => {
        // Check in-memory cache
        if (cacheRef.current.has(cleanDoc)) {
          setActivePreview({ data: cacheRef.current.get(cleanDoc)!, targetEl: target, anchor });
          return;
        }

        try {
          const res = await fetch(`/api/v1/preview?doc=${encodeURIComponent(cleanDoc)}`);
          if (res.ok) {
            const data: PreviewData = await res.json();
            cacheRef.current.set(cleanDoc, data);
            setActivePreview({ data, targetEl: target, anchor });
          }
        } catch (err) {
          // ignore network error
        }
      }, 280);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.wikilink-item');
      if (target) {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
          setActivePreview(null);
          setPosition(null);
        }, 200);
      }
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      cancelTimers();
    };
  }, []);

  // Compute smart collision-aware position using @floating-ui/dom
  useEffect(() => {
    if (!activePreview || !popoverRef.current) return;

    computePosition(activePreview.targetEl, popoverRef.current, {
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
        shift({ padding: 12 }),
      ],
    }).then(({ x, y }) => {
      setPosition({ x, y });

      // Auto-scroll and highlight target anchor/block if present
      if (activePreview.anchor && popoverRef.current) {
        const rawAnchor = activePreview.anchor;
        const cleanAnchor = rawAnchor.replace(/^\^/, '');
        const slugAnchor = cleanAnchor
          .toLowerCase()
          .replace(/<[^>]+>/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');

        const candidates = [
          `#${CSS.escape(rawAnchor)}`,
          `#${CSS.escape(cleanAnchor)}`,
          `#block-${CSS.escape(cleanAnchor)}`,
          `[data-block-id="${CSS.escape(cleanAnchor)}"]`,
          `#${CSS.escape(slugAnchor)}`,
          `[name="${CSS.escape(rawAnchor)}"]`,
          `[name="${CSS.escape(cleanAnchor)}"]`,
        ];

        let anchorEl: HTMLElement | null = null;
        for (const selector of candidates) {
          try {
            anchorEl = popoverRef.current.querySelector(selector) as HTMLElement | null;
            if (anchorEl) break;
          } catch {
            // Ignore invalid selector syntax
          }
        }

        if (anchorEl) {
          anchorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          anchorEl.classList.remove('hash-target-highlight');
          // Trigger reflow to restart CSS animation if already present
          void anchorEl.offsetWidth;
          anchorEl.classList.add('hash-target-highlight');
        }
      }
    });
  }, [activePreview]);

  if (!activePreview || typeof document === 'undefined') return null;

  const { data } = activePreview;
  const Icon = typeIconMap[data.type] || <FileText size={18} />;

const portalContent = (
    <div
      ref={popoverRef}
      onMouseEnter={cancelTimers}
      onMouseLeave={() => {
        closeTimerRef.current = setTimeout(() => {
          setActivePreview(null);
          setPosition(null);
        }, 150);
      }}
      className="ui-viewer--popover"
      style={{
        position: 'fixed',
        top: position ? `${position.y}px` : '-9999px',
        left: position ? `${position.x}px` : '-9999px',
        width: '520px',
        maxWidth: '92vw',
        maxHeight: '440px',
        zIndex: 999999,
        opacity: position ? 1 : 0,
        transition: 'opacity 0.12s ease-out',
      }}
    >
      <ResourceViewerFrame
        meta={{
        icon: Icon,
        title: data.title,
        subtitleLabel: data.category,
        subtitleValue: data.tags.length > 0 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {data.tags.slice(0, 3).map(t => `#${t}`).join(' ')}
          </span>
        ),
        badge: (
          <Button
            size="sm"
            onClick={() => {
              const anchorPart = activePreview.anchor
                ? (activePreview.anchor.startsWith('^') ? `#${activePreview.anchor}` : `#${activePreview.anchor}`)
                : '';
              setActivePreview(null);
              window.location.href = `/?doc=${encodeURIComponent(data.id)}${anchorPart}`;
            }}
          >
            <ExternalLink size={12} /> Open Note
          </Button>
        ),
      }}
      embedded
      mode="embedded"
      viewportToolbar={
        <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', flexWrap: 'wrap' }}>
          {data.tags.slice(0, 5).map((tag, i) => (
            <span key={i} style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', background: 'var(--control-bg)', border: '1px solid var(--control-border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-cyan)' }}>
              #{tag}
            </span>
          ))}
        </div>
      }
      >
      <div
        className="prose-content ui-viewer__stage ui-viewer__stage--scroll"
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
          lineHeight: '1.6',
          padding: 'var(--space-3)',
          maxHeight: '360px',
        }}
        dangerouslySetInnerHTML={{ __html: data.htmlBody }}
      />
      </ResourceViewerFrame>
    </div>
  );

  return ReactDOM.createPortal(portalContent, document.body);
};

export default WikilinkPreview;