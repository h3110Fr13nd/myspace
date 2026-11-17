import React from 'react';
import { roleOptionsFor } from './types';

interface RoleSelectorProps {
  value: string;
  modelRelations: string[];
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ value, modelRelations, onChange, className, style }) => {
  const isDeny = value.startsWith('denied_');
  const options = roleOptionsFor(modelRelations, { includeDenies: true });
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Role"
      className={['ui-select', 'iam-select-role', isDeny ? 'iam-select-deny' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <optgroup label="ALLOW Permissions">
        {options.filter((role) => !role.id.startsWith('denied_')).map((role) => (
          <option key={role.id} value={role.id}>{role.title}</option>
        ))}
      </optgroup>
      <optgroup label="EXPLICIT DENY (Block)">
        {options.filter((role) => role.id.startsWith('denied_')).map((role) => (
          <option key={role.id} value={role.id}>🚫 {role.title} (Explicit Deny)</option>
        ))}
      </optgroup>
    </select>
  );
};
