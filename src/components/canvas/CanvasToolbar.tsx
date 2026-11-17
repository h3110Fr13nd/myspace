import React from 'react';
import { Button, IconButton, Badge } from '../ui';
import type { WheelBehavior } from './core/useCanvasGestures';
import {
  X,
  Minus,
  Plus,
  RotateCcw,
  Maximize,
  Minimize,
  Code,
  Save,
  Download,
  Zap,
  MousePointer2,
  Hand,
  MoveHorizontal,
  ZoomIn,
  PanelRight,
} from 'lucide-react';

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToBounds: () => void;
  isModal?: boolean;
  onToggleModal?: () => void;
  isStudio?: boolean;
  canvasId?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  onAddText?: () => void;
  onOpenResourcePicker?: () => void;
  onAddGroup?: () => void;
  onGroupSelected?: () => void;
  selectedCount?: number;
  onExportObsidian?: () => void;
  onAutoLayout?: () => void;
  onOpenJsonEditor?: () => void;
  activeMode?: 'select' | 'pan';
  /**
   * What an unmodified wheel / two-finger scroll does. Persisted by the gesture
   * controller, so this is a display of that state rather than a second source
   * of truth: `onWheelBehaviorChange` hands the value straight back to it.
   */
  wheelBehavior?: WheelBehavior;
  onWheelBehaviorChange?: (behavior: WheelBehavior) => void;
  onToggleMode?: (mode: 'select' | 'pan') => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const CanvasToolbar: React.FC<Props> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToBounds,
  isModal = false,
  onToggleModal,
  isStudio = false,
  canvasId,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onSave,
  isSaving = false,
  onAddText,
  onOpenResourcePicker,
  onAddGroup,
  onGroupSelected,
  selectedCount = 0,
  onExportObsidian,
  onAutoLayout,
  onOpenJsonEditor,
  activeMode = 'select',
  onToggleMode,
  wheelBehavior = 'pan',
  onWheelBehaviorChange,
  isSidebarOpen = false,
  onToggleSidebar,
}) => {
  return (
    <div
      className="canvas-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'rgba(15, 23, 42, 0.88)',
        padding: '3px 8px',
        borderRadius: '10px',
        border: '1px solid var(--border-glass)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        flexWrap: 'nowrap',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Studio Authoring Actions */}
      {isStudio && (
        <>
          {/* Tool Modes: Select vs Pan */}
          {onToggleMode && (
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '6px', padding: '2px' }}>
              <Button
                variant={activeMode === 'select' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onToggleMode('select')}
                title="Select & Marquee Drag (V)"
                style={{ padding: '3px 8px', height: '28px', fontSize: '0.78rem' }}
              >
                <MousePointer2 size={13} style={{ marginRight: '4px' }} /> Select
              </Button>
              <Button
                variant={activeMode === 'pan' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onToggleMode('pan')}
                title="Hand Pan Canvas (H)"
                style={{ padding: '3px 8px', height: '28px', fontSize: '0.78rem' }}
              >
                <Hand size={13} style={{ marginRight: '4px' }} /> Pan
              </Button>
            </div>
          )}

          {/*
            Scroll behaviour. Trackpad users want scroll to pan and pinch to
            zoom, which is the default. Plain-mouse users usually expect the
            wheel to zoom, the way Figma and Miro behave, and before this control
            existed there was no way to ask for that short of hand-editing
            localStorage. Ctrl/Cmd+wheel always zooms regardless of this choice.
          */}
          {onWheelBehaviorChange && (
            <div
              role="group"
              aria-label="Scroll behaviour"
              style={{
                display: 'flex',
                gap: '2px',
                background: 'var(--surface-0, rgba(0, 0, 0, 0.3))',
                borderRadius: '6px',
                padding: '2px',
              }}
            >
              <Button
                variant={wheelBehavior === 'pan' ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={wheelBehavior === 'pan'}
                onClick={() => onWheelBehaviorChange('pan')}
                title="Scroll and two-finger swipe move the view (Ctrl+Scroll always zooms)"
                style={{ padding: '3px 8px', height: '28px', fontSize: '0.78rem' }}
              >
                <MoveHorizontal size={13} style={{ marginRight: '4px' }} /> Scroll pans
              </Button>
              <Button
                variant={wheelBehavior === 'zoom' ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={wheelBehavior === 'zoom'}
                onClick={() => onWheelBehaviorChange('zoom')}
                title="Scroll and two-finger swipe zoom in and out"
                style={{ padding: '3px 8px', height: '28px', fontSize: '0.78rem' }}
              >
                <ZoomIn size={13} style={{ marginRight: '4px' }} /> Scroll zooms
              </Button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddText}
              title="Add Markdown / LaTeX Note (N)"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px' }}
            >
              <span style={{ marginRight: '4px' }}>📝</span> Note
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenResourcePicker}
              title="Browse & Insert Resource (R)"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px' }}
            >
              <span style={{ marginRight: '4px' }}>📦</span> Insert
            </Button>

            {/* Smart Group Button */}
            {selectedCount > 1 && onGroupSelected ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onGroupSelected}
                title={`Wrap ${selectedCount} selected nodes in a Group (Ctrl+G)`}
                style={{
                  height: '28px',
                  fontSize: '0.78rem',
                  padding: '3px 8px',
                  background: 'rgba(234, 179, 8, 0.15)',
                  borderColor: 'rgba(234, 179, 8, 0.5)',
                  color: '#fbbf24',
                  fontWeight: 700,
                }}
              >
                <span style={{ marginRight: '4px' }}>🗂️</span> Group ({selectedCount})
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onAddGroup}
                title="Add Group Container"
                style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px' }}
              >
                <span style={{ marginRight: '4px' }}>🗂️</span> Group
              </Button>
            )}
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-glass)', margin: '0 2px' }} />

          {/* History Undo / Redo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <IconButton
              label="Undo (Ctrl+Z)"
              onClick={onUndo}
              disabled={!canUndo}
              ghost
              style={{ width: '28px', height: '28px', padding: 0 }}
            >
              <RotateCcw size={14} />
            </IconButton>
            <IconButton
              label="Redo (Ctrl+Y)"
              onClick={onRedo}
              disabled={!canRedo}
              ghost
              style={{ width: '28px', height: '28px', padding: 0 }}
            >
              <RotateCcw size={14} style={{ transform: 'scaleX(-1)' }} />
            </IconButton>
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-glass)', margin: '0 2px' }} />

          {/* Auto Layout */}
          {onAutoLayout && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAutoLayout}
              title="Auto-arrange nodes in DAG hierarchy"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px' }}
            >
              <Zap size={13} style={{ marginRight: '4px' }} /> Layout
            </Button>
          )}

          {/* Raw JSON */}
          {onOpenJsonEditor && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenJsonEditor}
              title="Open Live .canvas JSON File Editor"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px', color: 'var(--accent-cyan)' }}
            >
              <Code size={13} style={{ marginRight: '4px' }} /> Raw .canvas
            </Button>
          )}

          {/* Export Obsidian */}
          {onExportObsidian && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onExportObsidian}
              title="Export Obsidian .canvas file"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 8px' }}
            >
              <Download size={13} style={{ marginRight: '4px' }} /> Export
            </Button>
          )}

          <div style={{ width: '1px', height: '18px', background: 'var(--border-glass)', margin: '0 2px' }} />
        </>
      )}

      {/* Viewport Zoom & Pan Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <IconButton
          label="Zoom Out (-)"
          onClick={onZoomOut}
          ghost
          style={{ width: '28px', height: '28px', padding: 0 }}
        >
          <Minus size={15} />
        </IconButton>
        <Badge
          tone="neutral"
          style={{
            minWidth: '38px',
            textAlign: 'center',
            fontSize: '0.72rem',
            padding: '2px 5px',
            userSelect: 'none',
          }}
        >
          {Math.round(zoom * 100)}%
        </Badge>
        <IconButton
          label="Zoom In (+)"
          onClick={onZoomIn}
          ghost
          style={{ width: '28px', height: '28px', padding: 0 }}
        >
          <Plus size={15} />
        </IconButton>
        <IconButton
          label="Reset Zoom (100%)"
          onClick={onResetZoom}
          ghost
          style={{ width: '28px', height: '28px', padding: 0, color: 'var(--accent-cyan)' }}
        >
          <RotateCcw size={13} />
        </IconButton>
        <IconButton
          label="Fit All Nodes in View (F)"
          onClick={onFitToBounds}
          ghost
          style={{ width: '28px', height: '28px', padding: 0, color: 'var(--text-secondary)' }}
        >
          <Maximize size={14} />
        </IconButton>
      </div>

      {/* Studio Save & Controls */}
      {isStudio && (
        <>
          <div style={{ width: '1px', height: '18px', background: 'var(--border-glass)', margin: '0 2px' }} />

          {/* Save Button */}
          {onSave && (
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={isSaving}
              title="Save Changes to Database & File (Ctrl+S)"
              style={{ height: '28px', fontSize: '0.78rem', padding: '3px 10px' }}
            >
              {isSaving ? (
                <>
                  <span style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}>⟳</span> Saving...
                </>
              ) : (
                <>
                  <Save size={13} style={{ marginRight: '4px' }} /> Save
                </>
              )}
            </Button>
          )}

          {/* Fullscreen Toggle */}
          {onToggleModal && (
            <IconButton
              label={isModal ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
              onClick={onToggleModal}
              ghost
              style={{ width: '28px', height: '28px', padding: 0 }}
            >
              {isModal ? <Minimize size={14} /> : <Maximize size={14} />}
            </IconButton>
          )}

          {/* Inspector Sidebar Toggle */}
          {onToggleSidebar && (
            <IconButton
              label={isSidebarOpen ? 'Hide Inspector (I)' : 'Show Inspector (I)'}
              onClick={onToggleSidebar}
              ghost={!isSidebarOpen}
              style={{
                width: '28px',
                height: '28px',
                padding: 0,
                color: isSidebarOpen ? 'var(--accent-cyan-bright)' : 'var(--text-secondary)',
                background: isSidebarOpen ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                borderColor: isSidebarOpen ? 'var(--accent-cyan)' : 'transparent',
              }}
            >
              <PanelRight size={15} />
            </IconButton>
          )}
        </>
      )}

      {/* Non-studio Viewport Extras */}
      {!isStudio && (
        <>
          {/* Live UI .canvas Raw JSON Code Viewer Button */}
          {onOpenJsonEditor && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenJsonEditor}
              title="View Raw .canvas JSON File"
              style={{ height: '28px', fontSize: '0.78rem', color: 'var(--accent-cyan)', borderColor: 'var(--border-glass)' }}
            >
              <Code size={13} style={{ marginRight: '4px' }} /> Raw .canvas
            </Button>
          )}

          {/* Jump to Studio Editor Button */}
          {canvasId && (
            <a
              href={`/studio/canvas/${encodeURIComponent(canvasId.replace(/^canvas:/, ''))}`}
              style={{
                textDecoration: 'none',
                height: '28px',
                padding: '0 8px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-glass)',
                borderRadius: '6px',
                background: 'rgba(15, 23, 42, 0.6)',
                boxSizing: 'border-box',
              }}
              title="Open in Canvas Studio Editor"
            >
              <span>✏️</span> Studio
            </a>
          )}

          {/* Expand Fullscreen Modal Button */}
          {onToggleModal && (
            <Button
              variant={isModal ? 'danger' : 'ghost'}
              size="sm"
              onClick={onToggleModal}
              title={isModal ? 'Close Fullscreen (Esc)' : 'Expand Fullscreen Modal'}
              style={{
                height: '28px',
                fontSize: '0.78rem',
                background: isModal ? 'rgba(244, 63, 94, 0.15)' : 'rgba(0, 242, 254, 0.12)',
                border: `1px solid ${isModal ? 'var(--accent-rose)' : 'var(--accent-cyan)'}`,
                color: isModal ? 'var(--accent-rose)' : '#fff',
              }}
            >
              <span>{isModal ? <><X size={13} style={{ marginRight: '4px' }} /> Close</> : <><Maximize size={13} style={{ marginRight: '4px' }} /> Fullscreen</>}</span>
            </Button>
          )}
        </>
      )}
    </div>
  );
};