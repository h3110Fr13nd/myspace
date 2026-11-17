import React from 'react';

export type BadgeTone = 'default' | 'success' | 'danger' | 'info' | 'warn' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

const toneClass: Record<BadgeTone, string> = {
  default: '',
  success: 'ui-badge--success',
  danger: 'ui-badge--danger',
  info: 'ui-badge--info',
  warn: 'ui-badge--warn',
  neutral: 'ui-badge--neutral',
};

export const Badge: React.FC<BadgeProps> = ({ tone = 'default', dot, className, children, ...rest }) => (
  <span className={['ui-badge', toneClass[tone], className ?? ''].filter(Boolean).join(' ')} {...rest}>
    {dot && <span className="ui-badge__dot" />}
    {children}
  </span>
);