import React from 'react';
import { icons, type LucideProps } from 'lucide-react';

export type IconName = keyof typeof icons;

export const Icon: React.FC<{ name: IconName } & LucideProps> = ({ name, size = 16, ...rest }) => {
  const Cmp = icons[name];
  if (!Cmp) return null;
  const Glyph = Cmp as React.ComponentType<LucideProps>;
  return <Glyph size={size} aria-hidden="true" {...rest} />;
};