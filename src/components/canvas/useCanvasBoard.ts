import React, { useEffect } from 'react';

/**
 * Hook that owns the board shell state shared by CanvasViewer and CanvasEditor.
 *
 * @param mode          'edit' | 'view'
 * @param width         initial viewport width (used for initial k calc)
 * @param height        initial viewport height
 * @param onTransform   callback(transform) fired on every pan/zoom
 * @param children      rendered inside the viewport
 * @param toolbar       optional custom toolbar slot (default: CanvasToolbar)
 * @param contextMenu   optional context menu config
 * @param selection     optional selected node IDs / handles
 */
export function useCanvasBoard({
  mode = 'view',
  width = 280,
  height = 240,
  onTransform,
  children,
  toolbar,
  contextMenu,
  selection,
}: {
  mode: 'edit' | 'view';
  width?: number;
  height?: number;
  onTransform: (transform: { k: number; x: number; y: number }) => void;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
  contextMenu?: boolean;
  selection?: Set<string>;
}) {
  // --- Transform state ---
  const [k, setK] = React.useState(1);
  const [x, setX] = React.useState(0);
  const [y, setY] = React.useState(0);
  const [isPanning, setIsPanning] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  // --- Wheel zoom ---
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // world-space delta scaled by current k, then re-applied
    const wx = (x + (mx / (rect.width / k))) * delta - mx / (rect.width / k);
    const wy = (y + (my / (rect.height / k))) * delta - my / (rect.height / k);
    setK(k * delta);
    setX(x + wx * k / delta);
    setY(y + wy * k / delta);
    onTransform?.({ k, x, y });
  };

  // --- Keyboard: spacebar hand in viewer ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        if (mode === 'view') {
          e.preventDefault();
          setIsPanning(!isPanning);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPanning, mode]);

  // --- Fullscreen toggle ---
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return {
    k,
    x,
    y,
    isPanning,
    isFullscreen,
    toggleFullscreen,
    handleWheel,
  };
}