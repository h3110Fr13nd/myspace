import React from 'react';
import { Modal } from '../../ui/Modal';
import { IconButton } from '../../ui';
import { TiledGraphView, type GraphMetaResponse, type OpenedNode } from './TiledGraphView';

interface TiledGraphModalProps {
  open: boolean;
  onClose: () => void;
  meta: GraphMetaResponse;
  activeNodeId?: string;
  onStaleMeta?: () => void;
  onOpenNode?: (node: OpenedNode) => void;
}

/**
 * Full-screen shell for the streamed graph. Uses the shared Modal primitive
 * (portal, focus trap, Escape, scroll lock) and the existing graph modal chrome.
 */
export const TiledGraphModal: React.FC<TiledGraphModalProps> = ({
  open,
  onClose,
  meta,
  activeNodeId,
  onStaleMeta,
  onOpenNode,
}) => {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} size="full" showClose={false} className="graph-modal-full" bodyClassName="graph-modal-body">
      <div className="graph-modal-header">
        <div>
          <h2 className="graph-modal-title">Knowledge Graph</h2>
          <p className="graph-modal-subtitle">
            {meta.nodes.toLocaleString()} nodes, streamed as you explore · drag to pan · scroll or pinch to zoom ·
            click a cluster to zoom in · Esc to close
          </p>
        </div>
        <IconButton label="Close graph" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <TiledGraphView meta={meta} activeNodeId={activeNodeId} onStaleMeta={onStaleMeta} onOpenNode={onOpenNode} />
    </Modal>
  );
};
