import React from 'react';
import { GraphShell } from './graph/GraphShell';
import type { GraphNode, GraphLink, GraphViewProps } from './graph/constants';
import {
  DEFAULT_PHYSICS,
  normalizeEntityType,
  getNodeRadius as getRadius,
  getNodeColor as getColor,
  getNodeLabel as getLabel,
  ENTITY_META,
} from './graph/constants';

export type { GraphNode, GraphLink, GraphViewProps };
export { ENTITY_META, DEFAULT_PHYSICS, normalizeEntityType, getRadius, getColor, getLabel };

export const GraphView: React.FC<GraphViewProps> = (props) => (
  <GraphShell host="svg" {...props} />
);