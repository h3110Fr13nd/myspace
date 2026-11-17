import React from 'react';
import '../styles/backlinks.css';

export interface Backlink {
  id: string;
  title: string;
  path?: string;
  excerpt?: string;
  slug?: string;
}

export const Backlinks: React.FC<{ documentId?: string; backlinks?: Backlink[] }> = ({ documentId, backlinks = [] }) => {
  if (!backlinks || backlinks.length === 0) return null;
  return (
    <nav className="backlinks-panel" aria-label="Linked references">
      <h3 className="backlinks-panel__heading">Linked references ({backlinks.length})</h3>
      <div className="backlinks-panel__list">
        {backlinks.map((link) => (
          <a key={link.id} href={link.path || `/?doc=${encodeURIComponent(link.id)}`} className="backlinks-panel__link">
            <strong>{link.title}</strong>
            {link.excerpt && <span>{link.excerpt}</span>}
          </a>
        ))}
      </div>
    </nav>
  );
};
