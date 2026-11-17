import React from 'react';
import { ENTITY_META } from './constants';
import { Flex } from '../ui/Stack';
import { Badge } from '../ui/Badge';

export const GraphLegend: React.FC = () => {
  const legendItems = Object.entries(ENTITY_META).map(([key, meta]) => (
    <Flex key={key} align="center" gap={1} style={{ color: meta.color }}>
      <Badge tone="info" dot style={{ background: meta.color, borderColor: meta.color, padding: '2px 8px' }}>
        {meta.icon} {meta.label}
      </Badge>
    </Flex>
  ));

  return (
    <Flex wrap gap={2} style={{ marginTop: '10px', fontSize: 'var(--text-xs)' }}>
      {legendItems}
      <Flex align="center" gap={1} style={{ color: 'var(--status-success)' }}>
        <Badge tone="success" dot style={{ borderColor: '#fff' }}>
          ✓ Read
        </Badge>
      </Flex>
    </Flex>
  );
};