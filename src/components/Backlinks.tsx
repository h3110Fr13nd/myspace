import React from 'react';
import '../styles/backlinks.css';

export interface Backlink {
  id: string;
  title: string;
  path?: string;
  excerpt?: string;
  slug?: string;
  /** Named relationships from that note to this one, e.g. ["cites", "extends"]. */
  relations?: string[];
}

/**
 * Relationship names stay out of the way: a small chip with the count, and
 * the full list unfolding inside the card on hover or keyboard focus.
 */
export const Backlinks: React.FC<{ documentId?: string; backlinks?: Backlink[] }> = ({ documentId, backlinks = [] }) => {
  if (!backlinks || backlinks.length === 0) return null;
  return (
    <nav className="backlinks-panel" aria-label="Linked references">
      <h3 className="backlinks-panel__heading">Linked references ({backlinks.length})</h3>
      <div className="backlinks-panel__list">
        {backlinks.map((link) => {
          const relations = link.relations ?? [];
          const described = relations.length ? `${link.title} — ${relations.join(', ')} this note` : undefined;
          return (
            <a
              key={link.id}
              href={link.path || `/?doc=${encodeURIComponent(link.id)}`}
              className="backlinks-panel__link"
              aria-label={described}
            >
              <span className="backlinks-panel__title-row">
                <strong>{link.title}</strong>
                {relations.length > 0 && (
                  <span className="backlinks-panel__rel-chip" aria-hidden="true">
                    {relations.length === 1 ? relations[0] : `${relations[0]} +${relations.length - 1}`}
                  </span>
                )}
              </span>
              {relations.length > 0 && (
                <span className="backlinks-panel__rel-tip" aria-hidden="true">
                  {relations.map((r) => (
                    <span key={r} className="backlinks-panel__rel-name">
                      {r}
                    </span>
                  ))}
                  <span className="backlinks-panel__rel-target">→ this note</span>
                </span>
              )}
              {link.excerpt && <span>{link.excerpt}</span>}
            </a>
          );
        })}
      </div>
    </nav>
  );
};
