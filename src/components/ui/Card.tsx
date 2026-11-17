import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: keyof HTMLElementTagNameMap;
}

/** Glassmorphism surface card built on tokens. */
export const Card: React.FC<CardProps> = ({ as: Tag = 'div', className, children, ...rest }) => {
  const Cmp = Tag as React.ElementType;
  return (
    <Cmp className={['ui-card', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Cmp>
  );
};