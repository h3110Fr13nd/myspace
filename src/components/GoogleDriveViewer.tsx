import React, { useEffect, useState } from 'react';
import { Table, FileText, ClipboardList, Folder, Link2, Check, ArrowUpRight } from 'lucide-react';
import { SheetGrid } from './SheetGrid';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button } from './ui/Button';
import { stripHtml } from '../lib/render/codeHighlighter';

interface GoogleDriveViewerProps {
  assetId: string;
  type: string;
  title: string;
  currentUser?: string;
  metadata?: Record<string, any>;
  isEmbedded?: boolean;
}

export const GoogleDriveViewer: React.FC<GoogleDriveViewerProps> = ({
  assetId,
  type,
  title,
  currentUser = 'user:anonymous',
  metadata = {},
  isEmbedded = false,
}) => {
  const isSpreadsheet = type.includes('sheet') || assetId.includes('sheet');

  const [copied, setCopied] = useState(false);
  const [nativeValues, setNativeValues] = useState<string[][] | null>(null);
  const [nativeState, setNativeState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>(
    isSpreadsheet && currentUser !== 'user:anonymous' ? 'loading' : 'idle'
  );
  const cleanTitle = stripHtml(title);
  const rawFileId =
    metadata.googleSpreadsheetId ||
    metadata.googleDocId ||
    metadata.googleFileId ||
    metadata.fileId ||
    assetId
      .replace(/^google_sheet:/, '')
      .replace(/^google_doc:/, '')
      .replace(/^google:/, '')
      .replace(/^drive:[^:]+:/, '')
      .replace(/^drive_/, '');
  const fileId = stripHtml(rawFileId);

  useEffect(() => {
    if (!isSpreadsheet || !fileId || currentUser === 'user:anonymous') {
      setNativeState('unavailable');
      return;
    }
    let cancelled = false;
    setNativeState('loading');
    fetch(`/api/v1/google/sheets/values?id=${encodeURIComponent(fileId)}&range=A1%3AZ100`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(data.values) && data.values.length > 0) {
          setNativeValues(data.values);
          setNativeState('ready');
        } else {
          setNativeState('unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) setNativeState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [isSpreadsheet, fileId, currentUser]);

  let embedUrl = '';
  let directUrl = metadata.googleUrl || '';
  let typeLabel = 'Google Drive Item';
  let typeIcon: React.ReactNode = <Folder size={18} />;

  if (type.includes('sheet') || assetId.includes('sheet')) {
    typeLabel = 'Google Spreadsheet';
    typeIcon = <Table size={18} />;
    embedUrl = `https://docs.google.com/spreadsheets/d/${fileId}/htmlembed?widget=true&headers=false`;
    if (!directUrl) directUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  } else if (type.includes('form') || assetId.includes('form')) {
    typeLabel = 'Google Form';
    typeIcon = <ClipboardList size={18} />;
    embedUrl = `https://docs.google.com/forms/d/e/${fileId}/viewform?embedded=true`;
    if (!directUrl) directUrl = `https://docs.google.com/forms/d/e/${fileId}/viewform`;
  } else {
    typeLabel = 'Google Document';
    typeIcon = <FileText size={18} />;
    embedUrl = `https://docs.google.com/document/d/${fileId}/preview`;
    if (!directUrl) directUrl = `https://docs.google.com/document/d/${fileId}/edit`;
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(directUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLoadingSpreadsheet = isSpreadsheet && nativeState === 'loading';

  return (
    <ResourceViewerFrame
      meta={{
        icon: typeIcon,
        title: cleanTitle,
        subtitleLabel: typeLabel,
        subtitleValue: 'Authorized via ReBAC',
      }}
      actions={
        <>
          <Button size="sm" onClick={handleCopyLink}>
            {copied ? <Check size={14} /> : <Link2 size={14} />}
            {copied ? 'Copied' : 'Share'}
          </Button>
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-button ui-button--sm ui-button--secondary"
          >
            <ArrowUpRight size={14} /> Drive
          </a>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      style={{ height: isEmbedded ? '100%' : undefined }}
    >
      <div
        className="ui-viewer__stage"
        style={{
          flex: isEmbedded ? '1 1 0%' : '0 0 auto',
          height: isEmbedded ? '100%' : 'var(--sheet-stage-height)',
          minHeight: isEmbedded ? '180px' : undefined,
          overflow: isSpreadsheet ? 'auto' : 'hidden',
          background: isSpreadsheet ? 'var(--bg-glass)' : '#fff',
          justifyContent: isLoadingSpreadsheet ? 'center' : undefined,
          alignItems: isLoadingSpreadsheet ? 'center' : undefined,
          gap: isLoadingSpreadsheet ? 'var(--space-2)' : undefined,
          color: isLoadingSpreadsheet ? 'var(--text-muted)' : undefined,
          fontSize: isLoadingSpreadsheet ? 'var(--text-sm)' : undefined,
        }}
      >
        {isSpreadsheet && nativeState === 'ready' && nativeValues ? (
          <SheetGrid
            sheetId={fileId}
            currentUser={currentUser}
            isEmbedded
            rawData={nativeValues}
            title={title}
          />
        ) : isLoadingSpreadsheet ? (
          <span>Loading live spreadsheet cells…</span>
        ) : (
          <iframe
            src={embedUrl}
            title={title}
            width="100%"
            height="100%"
            style={{ border: 'none' }}
            allowFullScreen
            loading="lazy"
          />
        )}
      </div>

      {!isEmbedded && (
        <p className="ui-viewer__notice">
          🔐 Access to this Google resource is synchronized with your internal workspace identity (<code>{currentUser}</code>).
        </p>
      )}
    </ResourceViewerFrame>
  );
};

export default GoogleDriveViewer;