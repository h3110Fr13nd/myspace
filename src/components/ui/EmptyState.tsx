import React from 'react';
import { Inbox, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title = 'Nothing here yet', description, action, className }) => (
  <div className={['ui-empty', className ?? ''].filter(Boolean).join(' ')}>
    <div aria-hidden="true" style={{ opacity: 0.6 }}>{icon ?? <Inbox size={32} />}</div>
    <div className="ui-empty__title">{title}</div>
    {description && <div>{description}</div>}
    {action}
  </div>
);

export const LoadingState: React.FC<{ label?: string; className?: string }> = ({ label, className }) => (
  <div className={['ui-empty', className ?? ''].filter(Boolean).join(' ')}>
    <Loader2 size={24} aria-hidden="true" style={{ animation: 'ui-spin 1s linear infinite' }} />
    {label && <div>{label}</div>}
  </div>
);

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message = 'Something went wrong', onRetry }) => (
  <div className="ui-empty">
    <AlertTriangle size={24} style={{ color: 'var(--status-danger)' }} />
    <div className="ui-empty__title">{message}</div>
    {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
  </div>
);

export const Skeleton: React.FC<{ width?: number | string; height?: number | string; className?: string }> = ({
  width = '100%',
  height = 14,
  className,
}) => <div className={['ui-skeleton', className ?? ''].filter(Boolean).join(' ')} style={{ width, height }} />;

export const SkeletonBlock: React.FC<{ lines?: number; className?: string }> = ({ lines = 3, className }) => (
  <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} height={i === lines - 1 ? 10 : 14} />
    ))}
  </div>
);