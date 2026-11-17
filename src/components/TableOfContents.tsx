import React, { useEffect, useState } from 'react';
import '../styles/table-of-contents.css';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export const TableOfContents: React.FC = () => {
  const [headings, setHeadings] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    // Find all headings inside main article content
    const articleEl = document.querySelector('.prose-content') || document.querySelector('article');
    if (!articleEl) return;

    const headingElements = articleEl.querySelectorAll('h1, h2, h3');
    const items: TocItem[] = [];

    headingElements.forEach((el, index) => {
      let id = el.id;
      if (!id) {
        id = `toc-heading-${index}-${el.textContent?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
        el.id = id;
      }
      const text = el.textContent || '';
      const level = parseInt(el.tagName.replace('H', ''), 10);
      items.push({ id, text, level });
    });

    setHeadings(items);

    // IntersectionObserver to highlight active heading on scroll
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -60% 0px' }
    );

    headingElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <div className="contents-panel">
      <div className="contents-panel__heading">On this page</div>
      <nav className="custom-scrollbar contents-panel__nav" aria-label="On this page">
        <ul className="contents-panel__list">
          {headings.map((item) => {
            const isActive = activeId === item.id;
            return (
              <li
                key={item.id}
                className={`contents-panel__level-${item.level}`}
              >
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    const el = document.getElementById(item.id);
                    if (el) {
                      if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
                      el.focus({ preventScroll: true });
                      el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
                      el.classList.remove('hash-target-highlight');
                      void el.offsetWidth;
                      el.classList.add('hash-target-highlight');
                      setActiveId(item.id);
                      history.pushState(null, '', `#${item.id}`);
                    }
                  }}
                  className="contents-panel__link"
                  aria-current={isActive ? 'location' : undefined}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
};
