import React from 'react';

export interface TabsProps<T extends string = string> {
  items: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  'aria-label'?: string;
}

export const Tabs = <T extends string = string>({ items, value, onChange, 'aria-label': label }: TabsProps<T>): React.ReactElement => (
  <div className="ui-tabs" role="tablist" aria-label={label}>
    {items.map((item) => (
      <button
        key={item.value}
        type="button"
        role="tab"
        aria-selected={item.value === value}
        className={['ui-tab', item.value === value ? 'ui-tab--active' : ''].filter(Boolean).join(' ')}
        onClick={() => onChange(item.value)}
      >
        {item.label}
      </button>
    ))}
  </div>
);

export default Tabs;