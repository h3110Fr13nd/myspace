import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Palette, PenTool, Code2, Check, ZoomIn, ZoomOut, RotateCcw, Save, Loader2 } from 'lucide-react';
import { ResourceViewerFrame } from '../components/ui/ResourceViewerFrame';
import { Button, IconButton } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { showToast } from './ui/Toast';
import { RoughElement } from './excalidraw/RoughFallback';
import { useZoomPan } from '../lib/viewer/useZoomPan';

export interface ExcalidrawElement {
  id: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'text' | 'freedraw';
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  points?: Array<[number, number]>;
}

export interface ExcalidrawSpec {
  type?: 'excalidraw';
  version?: number;
  source?: string;
  elements: ExcalidrawElement[];
  appState?: {
    viewBackgroundColor?: string;
    gridSize?: number;
  };
}

interface Props {
  spec?: ExcalidrawSpec;
  assetId?: string;
  title?: string;
  rawContent?: string;
  currentUser?: string;
  isEmbedded?: boolean;
  height?: string | number;
}

const DEFAULT_SPEC: ExcalidrawSpec = {
  elements: [
    {
      id: 'el-1',
      type: 'rectangle',
      x: 100,
      y: 80,
      width: 180,
      height: 100,
      strokeColor: '#00f2fe',
      backgroundColor: 'rgba(0, 242, 254, 0.12)',
      strokeWidth: 2,
    },
    {
      id: 'el-2',
      type: 'text',
      x: 120,
      y: 118,
      width: 140,
      height: 24,
      text: 'Frontend Web App',
      fontSize: 16,
      strokeColor: '#ffffff',
    },
    {
      id: 'el-3',
      type: 'arrow',
      x: 280,
      y: 130,
      width: 200,
      height: 0,
      strokeColor: '#6366f1',
      strokeWidth: 2,
      points: [[0, 0], [200, 0]],
    },
    {
      id: 'el-4',
      type: 'ellipse',
      x: 480,
      y: 70,
      width: 180,
      height: 120,
      strokeColor: '#a855f7',
      backgroundColor: 'rgba(168, 85, 247, 0.12)',
      strokeWidth: 2,
    },
    {
      id: 'el-5',
      type: 'text',
      x: 480,
      y: 118,
      width: 180,
      height: 24,
      text: 'ReBAC Auth Server',
      fontSize: 16,
      strokeColor: '#ffffff',
    },
    {
      id: 'el-6',
      type: 'diamond',
      x: 280,
      y: 260,
      width: 160,
      height: 100,
      strokeColor: '#ec4899',
      backgroundColor: 'rgba(236, 72, 153, 0.12)',
      strokeWidth: 2,
    },
    {
      id: 'el-7',
      type: 'text',
      x: 305,
      y: 298,
      width: 110,
      height: 24,
      text: 'Data Lake Sync',
      fontSize: 14,
      strokeColor: '#ffffff',
    },
  ],
};

function normalizeExcalidraw(input: any): ExcalidrawSpec {
  if (!input) return DEFAULT_SPEC;
  if (Array.isArray(input.elements)) return input;
  if (Array.isArray(input)) return { elements: input };
  return DEFAULT_SPEC;
}

export const ExcalidrawViewer: React.FC<Props> = ({
  spec,
  assetId,
  title,
  rawContent,
  currentUser = 'user:anonymous',
  isEmbedded = false,
  height,
}) => {
  const [data, setData] = useState<ExcalidrawSpec>(() => normalizeExcalidraw(spec));
  const [loading, setLoading] = useState(Boolean(assetId && !spec && !rawContent));
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const { scale: zoom, zoomIn, zoomOut, reset: resetZoom } = useZoomPan({ min: 0.3, max: 2.5, step: 0.15, initial: 1 });
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [ExcalidrawComp, setExcalidrawComp] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Modal-specific ExcalidrawComp (always loaded on open, regardless of isEmbedded)
  const [ModalExcalidrawComp, setModalExcalidrawComp] = useState<any>(null);
  const modalDataRef = useRef<any>(null);

  // safeElements, dataRef, initialDataRef must be declared before callbacks that reference them
  const safeElements = Array.isArray(data?.elements) ? data.elements : DEFAULT_SPEC.elements;

  const dataRef = useRef(data);
  dataRef.current = data;

  const initialDataRef = useRef<any>(null);
  if (!initialDataRef.current && safeElements.length > 0) {
    initialDataRef.current = {
      elements: safeElements,
      appState: { theme: 'dark', ...data?.appState },
    };
  }

  const handleChange = React.useCallback((elements: readonly any[], appState: any) => {
    dataRef.current = { elements: elements as any, appState };
  }, []);

  // Load full Excalidraw for modal on demand
  const openEditor = useCallback(() => {
    setIsEditorOpen(true);
    if (!ModalExcalidrawComp) {
      import('@excalidraw/excalidraw')
        .then((mod) => setModalExcalidrawComp(() => mod.Excalidraw))
        .catch((err) => console.warn('Excalidraw modal load failed:', err));
    }
    modalDataRef.current = {
      elements: safeElements,
      appState: { theme: 'dark', ...data?.appState },
    };
  }, [ModalExcalidrawComp, safeElements, data?.appState]);

  const handleModalChange = useCallback((elements: readonly any[], appState: any) => {
    modalDataRef.current = { elements: elements as any, appState };
  }, []);

  const handleSaveSketch = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus(null);
    const current = modalDataRef.current || { elements: safeElements, appState: data?.appState };
    try {
      const targetId = assetId || 'sketches/system_architecture.excalidraw';
      const res = await fetch(`/api/v1/resources/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elements: current.elements,
          appState: current.appState,
          title: title || 'Excalidraw Sketch',
        }),
      });
      if (res.ok) {
        const normalized = { elements: current.elements as any[], appState: current.appState };
        setData(normalized);
        dataRef.current = normalized;
        initialDataRef.current = { elements: current.elements, appState: { theme: 'dark', ...current.appState } };
        setSaveStatus('✓ Saved to file!');
        showToast('Excalidraw sketch saved successfully', { tone: 'success' });
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('⚠️ Save failed');
        showToast('Failed to save Excalidraw sketch', { tone: 'danger' });
      }
    } catch (err: any) {
      setSaveStatus('⚠️ ' + err.message);
      showToast(`Error saving sketch: ${err.message}`, { tone: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }, [assetId, title, safeElements, data]);

  // Dynamically load full @excalidraw/excalidraw package on client only for standalone viewer
  useEffect(() => {
    if (isEmbedded) return;
    let isMounted = true;
    import('@excalidraw/excalidraw')
      .then((mod) => {
        if (isMounted) {
          setExcalidrawComp(() => mod.Excalidraw);
        }
      })
      .catch((err) => {
        console.info('Using Rough.js vector canvas fallback for Excalidraw:', err);
        showToast('Excalidraw failed to load — using the lightweight sketch fallback.', { tone: 'warn' });
      });
    return () => {
      isMounted = false;
    };
  }, [isEmbedded]);

  // Load from assetId if provided
  useEffect(() => {
    if (rawContent) {
      try {
        const parsed = JSON.parse(rawContent);
        setData(normalizeExcalidraw(parsed));
      } catch {
        setData(DEFAULT_SPEC);
      }
      setLoading(false);
    } else if (assetId) {
      setLoading(true);
      fetch(`/api/v1/resources/${encodeURIComponent(assetId)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((resJson) => {
          if (resJson.content) {
            const parsed = typeof resJson.content === 'string' ? JSON.parse(resJson.content) : resJson.content;
            setData(normalizeExcalidraw(parsed));
          }
        })
        .catch(() => {
          showToast('Failed to load the Excalidraw scene', { tone: 'danger' });
        })
        .finally(() => setLoading(false));
    }
  }, [assetId, rawContent]);

  const handleToggleJson = () => {
    if (!isEditingJson) {
      setJsonText(JSON.stringify(dataRef.current || data, null, 2));
    }
    setIsEditingJson(!isEditingJson);
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeExcalidraw(parsed);
      setData(normalized);
      dataRef.current = normalized;
      initialDataRef.current = {
        elements: normalized.elements,
        appState: { theme: 'dark', ...normalized.appState },
      };
      setIsEditingJson(false);
    } catch (err: any) {
      showToast('Invalid JSON: ' + err.message, { tone: 'danger' });
    }
  };

  const handleResetZoomPan = () => {
    resetZoom();
    setPan({ x: 20, y: 20 });
  };

  // Compute bounding box
  const bounds = React.useMemo(() => {
    if (safeElements.length === 0) {
      return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    safeElements.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 100));
      maxY = Math.max(maxY, el.y + (el.height || 60));
    });

    return {
      minX,
      minY,
      maxX: maxX + 60,
      maxY: maxY + 60,
      width: Math.max(maxX - minX + 120, 800),
      height: Math.max(maxY - minY + 120, 550),
    };
  }, [safeElements]);


  return (
    <ResourceViewerFrame
      meta={{
        icon: <Palette size={18} />,
        title: title || 'Excalidraw Sketch',
        badge: saveStatus && (
          <Badge tone={saveStatus.startsWith('✓') ? 'success' : 'danger'}>{saveStatus}</Badge>
        ),
        subtitleValue: `(${safeElements.length} elements)`,
      }}
      actions={
        <>
          <IconButton label="Zoom Out" ghost title="Zoom Out" onClick={zoomOut}>
            <ZoomOut size={16} />
          </IconButton>
          <span className="ui-viewer__zoom">{Math.round(zoom * 100)}%</span>
          <IconButton label="Zoom In" ghost title="Zoom In" onClick={zoomIn}>
            <ZoomIn size={16} />
          </IconButton>
          <IconButton label="Reset zoom and pan" ghost title="Reset" onClick={handleResetZoomPan}>
            <RotateCcw size={16} />
          </IconButton>

          <Button size="sm" variant="secondary" onClick={openEditor} title="Open full Excalidraw whiteboard editor">
            <PenTool size={14} /> Open Whiteboard
          </Button>

          <Button
            size="sm"
            variant={isEditingJson ? 'primary' : 'secondary'}
            onClick={handleToggleJson}
          >
            {isEditingJson ? <Check size={14} /> : <Code2 size={14} />}
            {isEditingJson ? 'Close JSON' : 'Edit JSON'}
          </Button>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      style={{ height: height || (isEmbedded ? '100%' : undefined) }}
    >
      {/* JSON EDITOR DRAWER */}
      {isEditingJson && (
        <div className="ui-viewer__editor-drawer">
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={8}
            className="ui-viewer__textarea"
          />
          <Button size="sm" variant="primary" onClick={handleApplyJson}>
            Apply Changes
          </Button>
        </div>
      )}

      {/* CANVAS BOARD VIEWPORT */}
      <div
        className="ui-viewer__canvas-stage"
        style={{ height: height || (isEmbedded ? '360px' : '520px') }}
      >
        {ExcalidrawComp && !isEmbedded ? (
          <div style={{ width: '100%', height: '100%' }}>
            <ExcalidrawComp
              initialData={initialDataRef.current}
              onChange={handleChange}
            />
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              cursor: isPanning ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => {
              setIsPanning(true);
              panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }}
            onMouseMove={(e) => {
              if (!isPanning) return;
              setPan({
                x: e.clientX - panStartRef.current.x,
                y: e.clientY - panStartRef.current.y,
              });
            }}
            onMouseUp={() => setIsPanning(false)}
            onMouseLeave={() => setIsPanning(false)}
          >
            <svg
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${bounds.width}px`,
                height: `${bounds.height}px`,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                transition: isPanning ? 'none' : 'transform 0.08s ease-out',
              }}
            >
              <defs>
                <pattern id="excalidraw-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="rgba(255, 255, 255, 0.08)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#excalidraw-grid)" />

              {safeElements.map((el, i) => (
                <RoughElement key={el.id ?? i} el={el} />
              ))}
            </svg>
          </div>
        )}
      </div>

      {/* ──── FULLSCREEN EXCALIDRAW WHITEBOARD EDITOR MODAL ──── */}
      <Modal
        open={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        size="full"
        title={
          <>
            <Palette size={18} /> {title || 'Excalidraw Sketch'} — Whiteboard Editor
            {saveStatus && (
              <span className="ui-viewer__meta-note">{saveStatus}</span>
            )}
          </>
        }
        footer={
          <Button size="sm" onClick={handleSaveSketch} disabled={isSaving}>
            <Save size={14} /> {isSaving ? 'Saving…' : 'Save Sketch'}
          </Button>
        }
        bodyClassName="ui-viewer__modal-body"
      >
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {ModalExcalidrawComp ? (
            <ModalExcalidrawComp
              initialData={modalDataRef.current}
              onChange={handleModalChange}
              theme="dark"
            />
          ) : (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '10px' }}>
              <Loader2 size={22} className="ui-viewer__spinner" />
              Loading Excalidraw whiteboard…
            </div>
          )}
        </div>
      </Modal>
    </ResourceViewerFrame>
  );
};

export default ExcalidrawViewer;