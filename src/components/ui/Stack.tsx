import React from 'react';

export type Gap = 1 | 2 | 3 | 4 | 5 | 6;
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around';

interface FlexBaseProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  grow?: boolean;
}

const alignClass: Record<Align, string> = {
  start: 'ui-align-start',
  center: 'ui-align-center',
  end: 'ui-align-end',
  stretch: 'ui-align-stretch',
};

const justifyClass: Record<Justify, string> = {
  start: 'ui-justify-start',
  center: 'ui-justify-center',
  end: 'ui-justify-end',
  between: 'ui-justify-between',
  around: 'ui-justify-around',
};

function compose({ gap, align, justify, wrap, grow, className }: FlexBaseProps, base: string): string {
  return [base, gap ? `ui-gap-${gap}` : '', align ? alignClass[align] : '', justify ? justifyClass[justify] : '', wrap ? 'ui-wrap' : '', grow ? 'ui-grow' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

/** Horizontal flex container (row). */
export const Flex: React.FC<FlexBaseProps> = ({ gap, align, justify, wrap, grow, className, children, ...rest }) => (
  <div className={compose({ gap, align, justify, wrap, grow, className }, 'ui-row')} {...rest}>
    {children}
  </div>
);

/** Vertical flex container (column). */
export const Stack: React.FC<FlexBaseProps> = ({ gap, align, justify, wrap, grow, className, children, ...rest }) => (
  <div className={compose({ gap, align, justify, wrap, grow, className }, 'ui-col')} {...rest}>
    {children}
  </div>
);