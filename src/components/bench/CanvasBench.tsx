/** Benchmark harness (dev-only /bench/canvas). Not product UI. */
import React, { useMemo } from 'react';
import { CanvasEditor } from '../canvas/CanvasEditor';
import { CanvasViewer } from '../canvas/CanvasViewer';
import type { JsonCanvasSpec } from '../canvas/types';
import { synthCanvas } from '../../../bench/lib/synth';

export const CanvasBench: React.FC<{ n: number; mode: 'editor' | 'viewer' }> = ({ n, mode }) => {
  const data = useMemo(() => {
    performance.mark('bench:synth:start');
    const doc = synthCanvas(n) as unknown as JsonCanvasSpec;
    performance.mark('bench:synth:end');
    return doc;
  }, [n]);
  return (
    <div className="bench-stage" data-bench-ready>
      {mode === 'editor' ? (
        <CanvasEditor canvasId={`bench-${n}`} initialData={data} currentUser="bench" />
      ) : (
        <CanvasViewer canvasId={`bench-${n}`} initialData={data} currentUser="bench" isEmbedded />
      )}
    </div>
  );
};
