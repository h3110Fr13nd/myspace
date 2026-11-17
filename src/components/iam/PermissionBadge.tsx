import React from 'react';
import { Badge } from '../ui';

interface PermissionBadgeProps {
  relation: string;
  isInherited?: boolean;
}

export const PermissionBadge: React.FC<PermissionBadgeProps> = ({ relation, isInherited }) => {
  if (isInherited) {
    return (
      <Badge tone="neutral" className="ui-badge--inherited">
        {relation} (inherited)
      </Badge>
    );
  }

  if (relation.startsWith('denied_')) {
    return <Badge tone="danger">🚫 BLOCK {relation.replace('denied_', '')}</Badge>;
  }

  switch (relation) {
    case 'owner':
      return <Badge tone="info" className="ui-badge--owner">{relation}</Badge>;
    case 'editor':
      return <Badge tone="info" className="ui-badge--editor">{relation}</Badge>;
    case 'member':
      return <Badge tone="success">{relation}</Badge>;
    case 'viewer':
      return <Badge tone="info">{relation}</Badge>;
    case 'commenter':
      return <Badge tone="success">{relation}</Badge>;
    case 'downloader':
      return <Badge tone="info">{relation}</Badge>;
    default:
      return <Badge tone="info">{relation}</Badge>;
  }
};
