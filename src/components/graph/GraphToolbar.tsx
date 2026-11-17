import React from 'react';
import { IconButton } from '../ui/Button';
import { Flex, Stack } from '../ui/Stack';

interface GraphToolbarProps {
  isModal?: boolean;
  isDrawerOpen?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onResetZoom?: () => void;
  badgeRef: React.RefObject<any>;
}

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  isModal = false,
  isDrawerOpen = false,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetZoom,
  badgeRef,
}) => {
  if (isModal) {
    return (
      <Stack gap={2} className="graph-toolbar-modal" style={{
        position: 'absolute',
        bottom: '18px',
        right: '18px',
        background: 'rgba(15, 23, 42, 0.85)',
        padding: '6px',
        borderRadius: '10px',
        border: '1px solid var(--border-glass)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        zIndex: 10,
      }}>
        <IconButton label="Zoom In" onClick={onZoomIn} className="graph-toolbar-btn">
          +
        </IconButton>
        <IconButton label="Zoom Out" onClick={onZoomOut} className="graph-toolbar-btn">
          −
        </IconButton>
        <div
          ref={badgeRef}
          title="Current Zoom Scale"
          style={{
            fontSize: '0.66rem',
            color: 'var(--accent-cyan-bright)',
            fontWeight: 700,
            textAlign: 'center',
            padding: '2px 0',
            fontVariantNumeric: 'tabular-nums',
            userSelect: 'none',
          }}
        >
          100%
        </div>
        <IconButton label="Fit to Screen" onClick={onFit} className="graph-toolbar-btn graph-toolbar-btn-accent">
          ⛶
        </IconButton>
        {onResetZoom && (
          <IconButton label="Reset Zoom to 1x" onClick={onResetZoom} className="graph-toolbar-btn graph-toolbar-btn-muted">
            ↺
          </IconButton>
        )}
      </Stack>
    );
  }

  return (
    <Flex gap={1} className="graph-toolbar-widget" style={{
      position: 'absolute',
      bottom: '8px',
      right: '8px',
      background: 'rgba(15, 23, 42, 0.75)',
      padding: '3px',
      borderRadius: '6px',
      border: '1px solid var(--border-glass)',
      backdropFilter: 'blur(8px)',
    }}>
      <IconButton label="Zoom In" onClick={onZoomIn} ghost className="graph-toolbar-btn-sm">
        +
      </IconButton>
      <IconButton label="Zoom Out" onClick={onZoomOut} ghost className="graph-toolbar-btn-sm">
        −
      </IconButton>
      <span
        ref={badgeRef}
        title="Current Zoom"
        style={{
          fontSize: '0.65rem',
          color: 'var(--accent-cyan-bright)',
          fontWeight: 700,
          padding: '0 3px',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        100%
      </span>
      <IconButton label="Fit to Screen" onClick={onFit} ghost className="graph-toolbar-btn-sm graph-toolbar-btn-accent">
        ⛶
      </IconButton>
    </Flex>
  );
};