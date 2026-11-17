import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Ruler, Pencil, Check, Save, Maximize2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button, IconButton } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { showToast } from './ui/Toast';
import { useZoomPan } from '../lib/viewer/useZoomPan';
import { loadMermaid } from '../lib/mermaid';

interface Props {
  code?: string;
  initialCode?: string;
  diagramId?: string;
  assetId?: string;
  title?: string;
  currentUser?: string;
  isEmbedded?: boolean;
  height?: string | number;
}

const DEFAULT_MERMAID = `graph TD
  A[User / Client] -->|ReBAC Access Check| B(OpenFGA Engine)
  B -->|Allowed| C{Resource Type}
  C -->|Canvas| D[JsonCanvas 2D Viewport]
  C -->|Notebook| E[Jupyter Kernel Cells]
  C -->|Sketch| F[Excalidraw Vector Canvas]
  C -->|Diagram| G[Mermaid Flowchart]
  B -->|Denied| H[403 Restricted Card]`;

export const MermaidViewer: React.FC<Props> = ({
  code,
  initialCode,
  diagramId,
  assetId,
  title,
  currentUser = 'user:anonymous',
  isEmbedded = false,
  height,
}) => {
  const effectiveCode = initialCode || code;
  const effectiveId = diagramId || assetId;
  const [sourceCode, setSourceCode] = useState(effectiveCode || DEFAULT_MERMAID);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [localCode, setLocalCode] = useState(sourceCode);
  const [loading, setLoading] = useState(Boolean(effectiveId && !effectiveCode));
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCode, setModalCode] = useState(sourceCode);
  const { scale, zoomIn, zoomOut, reset: resetZoom } = useZoomPan({ min: 0.3, max: 2.5, step: 0.15, initial: 1 });

  useEffect(() => {
    if (effectiveId && !effectiveCode) {
      setLoading(true);
      fetch(`/api/v1/resources/${encodeURIComponent(effectiveId)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          if (data.content || data.chart) {
            const codeVal = data.content || data.chart;
            setSourceCode(codeVal);
            setLocalCode(codeVal);
            setModalCode(codeVal);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [effectiveId, effectiveCode]);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      setErrorMsg(null);
      try {
        const id = `standalone-mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, sourceCode);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err.message || 'Syntax error in Mermaid diagram');
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [sourceCode]);

  const handleApply = () => {
    setSourceCode(localCode);
    setIsEditing(false);
  };

  const handleSave = async (codeToSave?: string) => {
    setIsSaving(true);
    setSaveStatus(null);
    const content = codeToSave !== undefined ? codeToSave : localCode;
    try {
      const targetId = effectiveId || 'diagrams/rebac_pipeline.mmd';
      const res = await fetch(`/api/v1/resources/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          title: title || 'Mermaid Diagram',
        }),
      });
      if (res.ok) {
        setSourceCode(content);
        setSaveStatus('✓ Saved to file!');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveStatus('⚠️ ' + (err.error || 'Save failed'));
      }
    } catch (err: any) {
      setSaveStatus('⚠️ Error: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const [modalSvg, setModalSvg] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalIsSaving, setModalIsSaving] = useState(false);
  const [modalSaveStatus, setModalSaveStatus] = useState<string | null>(null);

  const renderModalSvg = useCallback(async (codeStr: string) => {
    setModalError(null);
    setModalSvg(null);
    try {
      const id = `modal-mermaid-${Math.random().toString(36).substring(2, 9)}`;
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(id, codeStr);
      setModalSvg(svg);
    } catch (err: any) {
      setModalError(err.message || 'Syntax error');
    }
  }, []);

  const modalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isModalOpen) return;
    if (modalDebounceRef.current) clearTimeout(modalDebounceRef.current);
    modalDebounceRef.current = setTimeout(() => renderModalSvg(modalCode), 500);
    return () => { if (modalDebounceRef.current) clearTimeout(modalDebounceRef.current); };
  }, [modalCode, isModalOpen, renderModalSvg]);

  const handleModalSave = async () => {
    setModalIsSaving(true);
    setModalSaveStatus(null);
    try {
      const targetId = effectiveId || 'diagrams/rebac_pipeline.mmd';
      const res = await fetch(`/api/v1/resources/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: modalCode, title: title || 'Mermaid Diagram' }),
      });
      if (res.ok) {
        setSourceCode(modalCode);
        setLocalCode(modalCode);
        setModalSaveStatus('✓ Saved!');
        showToast('Mermaid diagram saved!', { tone: 'success' });
        setTimeout(() => setModalSaveStatus(null), 3000);
      } else {
        setModalSaveStatus('⚠️ Save failed');
        showToast('Failed to save Mermaid diagram', { tone: 'danger' });
      }
    } catch (err: any) {
      setModalSaveStatus('⚠️ ' + err.message);
      showToast(`Error saving diagram: ${err.message}`, { tone: 'danger' });
    } finally {
      setModalIsSaving(false);
    }
  };

  const handleToggleEdit = () => {
    if (isEditing) handleApply();
    else {
      setLocalCode(sourceCode);
      setIsEditing(true);
    }
  };

  const openFullEditor = () => {
    setModalCode(sourceCode);
    setIsModalOpen(true);
  };

  const TEMPLATE_SNIPPETS = [
    { label: 'Flowchart', code: 'graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do X]\n  B -->|No| D[Do Y]' },
    { label: 'Sequence', code: 'sequenceDiagram\n  Client->>Server: Request\n  Server-->>Client: Response' },
    { label: 'Class', code: 'classDiagram\n  class Animal {\n    +name: string\n    +sound(): string\n  }\n  Animal <|-- Dog' },
    { label: 'State', code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Idle : stop\n  Running --> [*] : complete' },
    { label: 'Pie', code: 'pie title Resource Usage\n  "CPU" : 40\n  "Memory" : 35\n  "Network" : 25' },
  ];

  return (
    <ResourceViewerFrame
      meta={{
        icon: <Ruler size={18} />,
        title: title || 'Mermaid Diagram Viewer',
        badge: saveStatus && (
          <Badge tone={saveStatus.startsWith('✓') ? 'success' : 'danger'}>{saveStatus}</Badge>
        ),
      }}
      actions={
        <>
          <IconButton label="Zoom Out" ghost title="Zoom Out" onClick={zoomOut}>
            <ZoomOut size={16} />
          </IconButton>
          <span className="ui-viewer__zoom">{Math.round(scale * 100)}%</span>
          <IconButton label="Zoom In" ghost title="Zoom In" onClick={zoomIn}>
            <ZoomIn size={16} />
          </IconButton>
          <IconButton label="Reset zoom" ghost title="Reset zoom" onClick={resetZoom}>
            <RotateCcw size={16} />
          </IconButton>

          <Button size="sm" variant={isEditing ? 'primary' : 'secondary'} onClick={handleToggleEdit}>
            {isEditing ? <Check size={14} /> : <Pencil size={14} />}
            {isEditing ? 'Apply' : 'Edit Code'}
          </Button>

          {isEditing && (
            <Button size="sm" onClick={() => handleSave(localCode)} disabled={isSaving} title="Save changes to resource file">
              <Save size={14} /> {isSaving ? 'Saving...' : 'Save to File'}
            </Button>
          )}

          <Button size="sm" variant="secondary" onClick={openFullEditor} title="Open full split-screen diagram editor">
            <Maximize2 size={14} /> Full Editor
          </Button>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      style={{ height: height || (isEmbedded ? '100%' : undefined) }}
    >
      {isEditing && (
        <div className="ui-viewer__editor-drawer">
          <textarea
            value={localCode}
            onChange={(e) => setLocalCode(e.target.value)}
            rows={8}
            className="ui-viewer__textarea"
          />
        </div>
      )}

      {/* SVG DIAGRAM VIEWPORT */}
      <div className="ui-viewer__diagram-stage" style={{ flex: isEmbedded ? 1 : undefined }}>
        {svgContent && !errorMsg ? (
          <div
            dangerouslySetInnerHTML={{ __html: svgContent }}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              transition: 'transform var(--motion-fast) var(--ease-out)',
            }}
          />
        ) : errorMsg ? (
          <div style={{ color: 'var(--accent-rose)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
            ⚠️ Diagram Rendering Error: {errorMsg}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Rendering Mermaid diagram...
          </div>
        )}
      </div>

      {/* ──── FULLSCREEN SPLIT-PANE DIAGRAM EDITOR MODAL ──── */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="full"
        title={
          <>
            <Ruler size={18} /> {title || 'Mermaid Diagram'} — Full Editor
            {modalSaveStatus && (
              <span className="ui-viewer__meta-note">{modalSaveStatus}</span>
            )}
          </>
        }
        footer={
          <Button size="sm" onClick={handleModalSave} disabled={modalIsSaving}>
            <Save size={14} /> {modalIsSaving ? 'Saving…' : 'Save Diagram'}
          </Button>
        }
        bodyClassName="ui-viewer__modal-body"
      >
        {/* LEFT: Code Editor + Templates */}
        <div className="ui-viewer__split-left">
          <div className="ui-viewer__split-templates">
            {TEMPLATE_SNIPPETS.map((t) => (
              <button key={t.label} className="ui-viewer__chip" onClick={() => setModalCode(t.code)}>
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={modalCode}
            onChange={(e) => setModalCode(e.target.value)}
            spellCheck={false}
            className="ui-viewer__editor-textarea"
          />
        </div>

        {/* RIGHT: Live SVG Preview */}
        <div className="ui-viewer__split-right">
          {modalError ? (
            <div style={{ color: 'var(--accent-rose)', fontSize: 'var(--text-sm)', maxWidth: '500px', textAlign: 'center' }}>
              ⚠️ {modalError}
            </div>
          ) : modalSvg ? (
            <div dangerouslySetInnerHTML={{ __html: modalSvg }} style={{ maxWidth: '100%' }} />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Rendering preview…</div>
          )}
        </div>
      </Modal>
    </ResourceViewerFrame>
  );
};

export default MermaidViewer;
