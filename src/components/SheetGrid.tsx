import React, { useEffect, useMemo, useState } from 'react';
import { Table, Download, Maximize2 } from 'lucide-react';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button, IconButton } from './ui/Button';
import { Badge } from './ui/Badge';
import { parseDelimited, normalizeGrid } from '../lib/csv';

interface SheetGridProps {
  sheetId: string;
  currentUser: string;
  isEmbedded?: boolean;
  csvData?: string;
  rawData?: string[][];
  title?: string;
}

const FALLBACK_GRID: string[][] = [
  ['Category', 'Q1 Actual', 'Q2 Actual', 'Q3 Forecast', 'Variance'],
  ['Engineering Salaries', '$120,000', '$125,000', '$130,000', '+$5,000'],
  ['Cloud Infrastructure (S3/PG)', '$8,500', '$9,200', '$9,800', '+$600'],
  ['OpenFGA Security Audit', '$15,000', '$0', '$0', '$0'],
  ['Total Operating Expense', '$143,500', '$134,200', '$139,800', '+$5,600'],
];

export const SheetGrid: React.FC<SheetGridProps> = ({
  sheetId,
  currentUser,
  isEmbedded = false,
  csvData,
  rawData,
  title,
}) => {
  const [data, setData] = useState<string[][]>(() => {
    if (rawData && rawData.length > 0) return rawData;
    if (csvData && csvData.trim()) {
      const delimiter = csvData.includes('\t') && !csvData.includes(',') ? '\t' : ',';
      return parseDelimited(csvData, delimiter);
    }
    return FALLBACK_GRID;
  });

  useEffect(() => {
    const hasData =
      (rawData && rawData.length > 0) || Boolean(csvData && csvData.trim());
    if (hasData || !sheetId) return;
    let cancelled = false;
    fetch(`/api/v1/resources/${encodeURIComponent(sheetId)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || typeof payload.csvData !== 'string' || !payload.csvData.trim()) return;
        const delimiter = payload.csvData.includes('\t') && !payload.csvData.includes(',') ? '\t' : ',';
        const parsed = parseDelimited(payload.csvData, delimiter);
        if (normalizeGrid(parsed).width > 0) setData(parsed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sheetId, currentUser, csvData, rawData]);

  const normalized = useMemo(() => normalizeGrid(data), [data]);
  const hasGrid = normalized.width > 0 && normalized.rows.length > 0;
  const tableData = hasGrid ? normalized.rows : FALLBACK_GRID;
  const colCount = normalized.width > 0 ? normalized.width : tableData[0].length;

  const isRestricted = currentUser !== 'user:alice' && (sheetId.includes('restricted') || sheetId.includes('confidential'));

  if (isRestricted) {
    return (
      <ResourceViewerFrame
        meta={{
          icon: <Table size={18} />,
          title: 'Restricted Spreadsheet',
          subtitleLabel: sheetId,
          subtitleValue: <Badge tone="danger">Access Denied</Badge>,
        }}
        embedded={isEmbedded}
        mode={isEmbedded ? 'embedded' : 'standalone'}
        style={{ height: isEmbedded ? '100%' : undefined }}
      >
        <div className="ui-viewer__stage ui-viewer__stage--scroll" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', minHeight: isEmbedded ? '120px' : '180px' }}>
          <span style={{ fontSize: 'var(--text-lg)', color: 'var(--status-danger)' }}>🔒</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
            User <strong>{currentUser}</strong> lacks authorization rights to view financial cell data. Data stripped server-side.
          </p>
        </div>
      </ResourceViewerFrame>
    );
  }

  return (
    <ResourceViewerFrame
      meta={{
        icon: <Table size={18} />,
        title: title || 'Spreadsheet',
        subtitleLabel: 'Sheet',
        subtitleValue: <code>{sheetId}</code>,
      }}
      actions={
        <>
          <Badge tone="success">Live Cell Grid</Badge>
          <Button size="sm" variant="secondary" title="Open in new tab">
            <Maximize2 size={14} />
          </Button>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      style={{ height: isEmbedded ? '100%' : undefined }}
    >
      <div className="ui-viewer__stage ui-viewer__stage--scroll" style={{ flex: isEmbedded ? '1 1 0%' : '0 0 auto', minHeight: isEmbedded ? '180px' : '400px', maxHeight: isEmbedded ? 'none' : 'var(--sheet-stage-height)', overflow: 'auto' }}>
        <div className="custom-scrollbar" style={{ overflowX: 'auto', padding: isEmbedded ? 'var(--space-2)' : 'var(--space-4)' }}>
          {tableData.length > 0 && colCount > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--surface-subtle)', color: 'var(--text-primary)' }}>
                  {tableData[0].map((header, idx) => (
                    <th key={idx} style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-glass)', textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-word' }} title={header}>
                      {header || '\u00A0'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.slice(1).map((row, rIdx) => (
                  <tr key={rIdx} style={{ background: rIdx % 2 === 0 ? 'var(--surface-subtle)' : 'transparent' }}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-glass)', color: cIdx === 0 ? 'var(--text-primary)' : 'var(--accent-cyan)', whiteSpace: 'normal', wordBreak: 'break-word' }} title={cell}>
                        {cell || '\u00A0'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0, padding: 'var(--space-4)' }}>No tabular data to display.</p>
          )}
        </div>
      </div>
    </ResourceViewerFrame>
  );
};

export default SheetGrid;