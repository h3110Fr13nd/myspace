import React, { useState, useEffect } from 'react';
import type { CanvasNode, CanvasEdge } from './types';
import { Modal, Button, TextArea, Flex } from '../ui';
import { Braces, Copy, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  title?: string;
  onApply?: (nodes: CanvasNode[], edges: CanvasEdge[], title?: string) => void;
  readOnly?: boolean;
}

export const CanvasJsonEditorModal: React.FC<Props> = ({
  isOpen,
  onClose,
  nodes,
  edges,
  title,
  onApply,
  readOnly = false,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Format clean JSON Canvas v1.0 object
  const serializeCanvas = (nList: CanvasNode[], eList: CanvasEdge[], canvasTitle?: string) => {
    const fileData = {
      title: canvasTitle || undefined,
      nodes: nList.map((n) => ({
        id: n.id,
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.round(n.width),
        height: Math.round(n.height),
        color: n.color || undefined,
        text: n.text || undefined,
        file: n.file || undefined,
        subpath: n.subpath || undefined,
        url: n.url || undefined,
        label: n.label || undefined,
        background: n.background || undefined,
        backgroundStyle: n.backgroundStyle || undefined,
        resourceId: n.resourceId || undefined,
        resourceType: n.resourceType || undefined,
      })),
      edges: eList.map((e) => ({
        id: e.id,
        fromNode: e.fromNode,
        fromSide: e.fromSide || undefined,
        fromEnd: e.fromEnd || undefined,
        toNode: e.toNode,
        toSide: e.toSide || undefined,
        toEnd: e.toEnd || undefined,
        label: e.label || undefined,
        color: e.color || undefined,
      })),
    };
    return JSON.stringify(fileData, null, 2);
  };

  // Populate when opened
  useEffect(() => {
    if (isOpen) {
      setJsonText(serializeCanvas(nodes, edges, title));
      setValidationError(null);
      setCopied(false);
    }
  }, [isOpen, nodes, edges, title]);

  // Live validator
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setJsonText(val);
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed.nodes)) {
        setValidationError("JSON Canvas spec requires a 'nodes' array");
        return;
      }
      if (!Array.isArray(parsed.edges)) {
        setValidationError("JSON Canvas spec requires an 'edges' array");
        return;
      }
      setValidationError(null);
    } catch (err: any) {
      setValidationError(`Syntax error: ${err.message}`);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setValidationError(null);
    } catch (err: any) {
      setValidationError(`Cannot format invalid JSON: ${err.message}`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        setValidationError("Missing 'nodes' or 'edges' array");
        return;
      }

      if (!onApply) return;
      onApply(parsed.nodes, parsed.edges, parsed.title || title);
      onClose();
    } catch (err: any) {
      setValidationError(`Cannot apply changes: ${err.message}`);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <div className="ui-row ui-full ui-gap-3 ui-justify-between">
          <div className="ui-row ui-gap-2 ui-align-start">
            <Braces size={20} className="ui-shrink0 ui-icon-accent" />
            <div>
              <div>{readOnly ? 'Raw .canvas JSON Inspector' : 'Live .canvas Text File Viewer &amp; Editor'}</div>
              <div className="ui-field__hint">
                {readOnly
                  ? 'Official JSON Canvas v1.0 standard · Read-only specification export'
                  : 'Official JSON Canvas v1.0 standard · Bidirectional sync with visual board'}
              </div>
            </div>
          </div>
          <Flex gap={2} className="ui-shrink0">
            {!readOnly && (
              <Button size="sm" variant="secondary" onClick={handleFormat} title="Prettify JSON">
                Format
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={handleCopy} title="Copy to clipboard">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? ' Copied!' : ' Copy JSON'}
            </Button>
          </Flex>
        </div>
      }
      footer={
        <Flex justify="between" gap={3} className="ui-full">
          <span className={`ui-validation-status ${validationError ? 'ui-validation-status--error' : 'ui-validation-status--success'}`}>
            {validationError
              ? `⚠️ ${validationError}`
              : `✓ Valid JSON Canvas v1.0 Spec (${nodes.length} nodes, ${edges.length} edges)`}
          </span>
          <Flex gap={2}>
            {readOnly ? (
              <Button size="sm" variant="primary" onClick={onClose}>
                Close
              </Button>
            ) : (
              <div className="ui-row ui-gap-2 ui-shrink0">
                <Button size="sm" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={Boolean(validationError)}
                  onClick={handleApply}
                >
                  Apply Changes to Board
                </Button>
              </div>
            )}
          </Flex>
        </Flex>
      }
    >
      <TextArea
        value={jsonText}
        onChange={readOnly ? undefined : handleTextChange}
        readOnly={readOnly}
        spellCheck={false}
        rows={16}
        className="ui-json-textarea"
      />
    </Modal>
  );
};