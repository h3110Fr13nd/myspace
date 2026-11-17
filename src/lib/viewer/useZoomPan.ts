import { useCallback, useState } from 'react';

export interface UseZoomPanOptions {
  min?: number;
  max?: number;
  step?: number;
  initial?: number;
}

export interface UseZoomPanResult {
  scale: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

/**
 * Shared zoom state for resource viewers. Each consumer maps `scale` to its own
 * transform (iframe scale, <img> scale, or SVG translate+scale).
 */
export function useZoomPan({
  min = 0.5,
  max = 3,
  step = 0.1,
  initial = 1,
}: UseZoomPanOptions = {}): UseZoomPanResult {
  const [scale, setScale] = useState<number>(initial);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(max, Number((s + step).toFixed(4))));
  }, [max, step]);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(min, Number((s - step).toFixed(4))));
  }, [min, step]);

  const reset = useCallback(() => {
    setScale(initial);
  }, [initial]);

  return { scale, zoomIn, zoomOut, reset };
}

export default useZoomPan;