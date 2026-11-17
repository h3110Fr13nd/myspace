import React from 'react';

export interface ResourceViewerMeta {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitleLabel?: React.ReactNode;
  subtitleValue?: React.ReactNode;
  badge?: React.ReactNode;
}

export interface ResourceViewerFrameProps {
  meta: ResourceViewerMeta;
  actions?: React.ReactNode;
  embedded?: boolean;
  mode?: 'embedded' | 'standalone';
  viewportToolbar?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Shared chrome for every resource viewer: icon bubble + title + subtitle,
 * an actions slot, an optional viewport toolbar, and the viewport children.
 * `embedded` collapses padding/margins so the frame can fill a parent node.
 */
export const ResourceViewerFrame = React.forwardRef<HTMLDivElement, ResourceViewerFrameProps>(
  ({ meta, actions, embedded = false, mode = 'standalone', viewportToolbar, className, style, children }, ref) => {
    const isEmbedded = embedded || mode === 'embedded';

    return (
      <div
        ref={ref}
        className={[
          'ui-card',
          'ui-viewer',
          isEmbedded ? 'ui-viewer--embedded' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={style}
      >
        <header className="ui-viewer__header">
          <div className="ui-viewer__meta">
            <span className="ui-viewer__icon">{meta.icon}</span>
            <div className="ui-viewer__titles">
              <div className="ui-viewer__title-row">
                <h3 className="ui-viewer__title">
                  {typeof meta.title === 'string' ? meta.title.replace(/<[^>]*>/g, '').trim() : meta.title}
                </h3>
                {meta.badge != null && <span className="ui-viewer__badge">{meta.badge}</span>}
              </div>
              {(meta.subtitleLabel != null || meta.subtitleValue != null) && (
                <div className="ui-viewer__subtitle">
                  {meta.subtitleLabel != null && <span className="ui-viewer__subtitle-label">{meta.subtitleLabel}</span>}
                  {meta.subtitleValue != null && <span className="ui-viewer__subtitle-value">{meta.subtitleValue}</span>}
                </div>
              )}
            </div>
          </div>
          {actions != null && <div className="ui-viewer__actions">{actions}</div>}
        </header>

        {viewportToolbar != null && <div className="ui-viewer__toolbar">{viewportToolbar}</div>}

        <div className="ui-viewer__viewport">{children}</div>
      </div>
    );
  }
);

ResourceViewerFrame.displayName = 'ResourceViewerFrame';

export default ResourceViewerFrame;