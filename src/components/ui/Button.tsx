import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cybergradient';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: never;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ui-button--primary',
  secondary: 'ui-button--secondary',
  ghost: 'ui-button--ghost',
  danger: 'ui-button--danger',
  cybergradient: 'ui-button--cybergradient',
};

/** Standard button covering the .glass-button / orphaned .btn-* cases. */
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  className,
  children,
  ...rest
}) => (
  <button
    className={['ui-button', variantClass[variant], `ui-button--${size}`, className ?? ''].filter(Boolean).join(' ')}
    disabled={disabled || loading}
    {...rest}
  >
    {children}
  </button>
);

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  ghost?: boolean;
}

/** Square icon-only button; `label` is required for accessibility. */
export const IconButton: React.FC<IconButtonProps> = ({ label, active, ghost, className, children, ...rest }) => (
  <button
    aria-label={label}
    title={label}
    className={[
      'ui-icon-button',
      active ? 'ui-icon-button--active' : '',
      ghost ? 'ui-icon-button--ghost' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </button>
);