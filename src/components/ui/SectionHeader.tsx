import React from 'react';

export interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Standard section/panel header: title + subtitle on the left, actions on the right. */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, actions, className }) => (
  <div className={`ui-section-header ${className ?? ''}`}>
    <div>
      <div className="ui-section-header__title">{title}</div>
      {subtitle !== undefined && <div className="ui-section-header__subtitle">{subtitle}</div>}
    </div>
    {actions && <div className="ui-row ui-gap-2 ui-shrink0">{actions}</div>}
  </div>
);