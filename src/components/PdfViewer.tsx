import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, ZoomIn, ZoomOut, Maximize2, Minimize2, Download, ArrowUpRight, FilePen, Plus, ExternalLink, LoaderCircle } from 'lucide-react';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button, IconButton } from './ui/Button';
import { Tabs } from './ui/Tabs';
import { useZoomPan } from '../lib/viewer/useZoomPan';

interface PdfViewerProps {
  assetId: string;
  title?: string;
  currentUser?: string;
  initialPage?: number;
  height?: string;
  isEmbedded?: boolean;
  /** Optional alternate HTML view served by the LaTeXML conversion service. */
  htmlUrl?: string | null;
  /** Optional coupled annotation note ID from PDF metadata. */
  coupledNoteId?: string | null;
  /** Callback to create a new annotation note for this PDF. */
  onCreateNotes?: () => Promise<string | null>;
}

const NotesPanel: React.FC<{
  coupledNoteId: string | null;
  onCreateNotes?: () => Promise<string | null>;
  currentUser: string;
}> = ({ coupledNoteId, onCreateNotes, currentUser }) => {
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [createdNoteHref, setCreatedNoteHref] = useState<string | null>(null);
  const [noteOpened, setNoteOpened] = useState(false);
  const isAnonymous = currentUser === 'user:anonymous';

  const handleCreateNotes = useCallback(async () => {
    if (!onCreateNotes) {
      setNoteError('Note creation is unavailable here. Please try again from the PDF page.');
      return;
    }

    // Open the tab during the user gesture so browsers do not block it after
    // the asynchronous create request finishes.
    const noteTab = window.open('', '_blank');
    if (noteTab) noteTab.opener = null;
    setNoteLoading(true);
    setNoteError(null);
    setCreatedNoteHref(null);
    setNoteOpened(false);
    try {
      const noteId = await onCreateNotes();
      if (!noteId) throw new Error('The note was not created. Please try again.');

      const href = `/?doc=${encodeURIComponent(noteId)}`;
      if (noteTab && !noteTab.closed) {
        noteTab.location.replace(href);
        setNoteOpened(true);
      } else {
        setCreatedNoteHref(href);
      }
    } catch {
      noteTab?.close();
      setNoteError('Could not create the annotation note. Check your connection and try again.');
    } finally {
      setNoteLoading(false);
    }
  }, [onCreateNotes]);

  if (coupledNoteId) {
    return (
      <div className="pdf-notes">
        <section className="pdf-notes__linked">
          <div className="pdf-notes__heading">
            <FilePen size={20} aria-hidden="true" />
            <strong>Annotation Note Linked</strong>
          </div>
          <p className="pdf-notes__description">
            This PDF has a linked annotation note. Open it to add highlights, summaries, and connections.
          </p>
          <div className="pdf-notes__actions">
            <a
              href={`/?doc=${encodeURIComponent(coupledNoteId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-button ui-button--primary ui-button--md"
            >
              <ExternalLink size={14} aria-hidden="true" /> Open annotation note
            </a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pdf-notes pdf-notes--empty">
      <FilePen className="pdf-notes__empty-icon" size={40} aria-hidden="true" />
      <div className="pdf-notes__copy">
        <h3 className="pdf-notes__title">No annotation note yet</h3>
        <p className="pdf-notes__description">
          Keep highlights, questions, and summaries for this paper in one linked note.
        </p>
      </div>
      {isAnonymous ? (
        <a
          className="ui-button ui-button--primary ui-button--md"
          href="/login"
          onClick={(event) => {
            event.preventDefault();
            const returnTo = window.location.pathname + window.location.search;
            window.location.assign(`/login?redirect=${encodeURIComponent(returnTo)}`);
          }}
        >
          <Plus size={16} aria-hidden="true" /> Sign in to create a note
        </a>
      ) : (
        <Button
          variant="primary"
          size="lg"
          onClick={handleCreateNotes}
          disabled={!onCreateNotes || noteLoading}
          aria-busy={noteLoading}
        >
          {noteLoading ? <LoaderCircle className="pdf-notes__spinner" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {noteLoading ? 'Creating note…' : 'Create annotation note'}
        </Button>
      )}
      {!onCreateNotes && !isAnonymous && (
        <p className="pdf-notes__hint">Note creation is unavailable for this PDF.</p>
      )}
      {noteError && <p className="pdf-notes__message pdf-notes__message--error" role="alert">{noteError}</p>}
      {createdNoteHref && (
        <p className="pdf-notes__message" role="status">
          Your note is ready. <a href={createdNoteHref}>Open annotation note</a>.
        </p>
      )}
      {noteOpened && <p className="pdf-notes__message" role="status">Annotation note opened in a new tab.</p>}
      {!isAnonymous && (
        <p className="pdf-notes__hint">
          It will inherit this PDF’s permissions and open in a new tab.
        </p>
      )}
    </div>
  );
};

export const PdfViewer: React.FC<PdfViewerProps> = ({
  assetId,
  title = 'Research Document',
  currentUser = 'user:anonymous',
  initialPage = 1,
  height = '720px',
  isEmbedded = false,
  htmlUrl = null,
  coupledNoteId = null,
  onCreateNotes,
}) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const { scale, zoomIn, zoomOut } = useZoomPan({ min: 0.5, max: 2, step: 0.25, initial: 1 });
  const cleanId = assetId.replace(/^pdf:/, '').replace(/\.pdf$/, '');
  const streamUrl = `/api/v1/assets/pdf/${encodeURIComponent(cleanId)}`;

  const [tab, setTab] = useState<'pdf' | 'html' | 'notes'>('pdf');
  const handleTabChange = useCallback((value: string) => {
    if (value === 'pdf' || value === 'html' || value === 'notes') {
      setTab(value);
    }
  }, []);
  const [htmlOk, setHtmlOk] = useState(false);

  useEffect(() => {
    if (!htmlUrl) return;
    setHtmlOk(false);
    fetch(htmlUrl)
      .then((r) => setHtmlOk(r.ok))
      .catch(() => setHtmlOk(false));
  }, [htmlUrl]);

  return (
    <ResourceViewerFrame
      meta={{
        icon: <BookOpen size={18} />,
        title,
        subtitleLabel: 'Key',
        subtitleValue: (
          <>
            <code>{cleanId}.pdf</code>
            <span>• Authorized for: <strong>{currentUser}</strong></span>
          </>
        ),
      }}
      actions={
        <>
          <Tabs
            items={[
              { value: 'pdf', label: '📄 PDF' },
              ...(htmlUrl && htmlOk ? [{ value: 'html', label: '📝 HTML' }] : []),
              { value: 'notes', label: '📝 Notes' },
            ]}
            value={tab}
            onChange={handleTabChange}
            aria-label="Document view"
          />
          <IconButton label="Zoom Out" ghost title="Zoom Out" onClick={zoomOut}>
            <ZoomOut size={16} />
          </IconButton>
          <span className="ui-viewer__zoom">{Math.round(scale * 100)}%</span>
          <IconButton label="Zoom In" ghost title="Zoom In" onClick={zoomIn}>
            <ZoomIn size={16} />
          </IconButton>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="ui-button ui-button--sm ui-button--secondary"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>

          <a
            href={streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-button ui-button--sm ui-button--secondary"
          >
            <ArrowUpRight size={14} /> Open
          </a>

          <a
            href={streamUrl}
            download={`${cleanId}.pdf`}
            className="ui-button ui-button--sm ui-button--primary"
          >
            <Download size={14} /> Download
          </a>
        </>
      }
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      className={isFullscreen ? 'ui-viewer--fullscreen' : undefined}
      style={{ height: isEmbedded ? '100%' : undefined }}
    >
      <div
        className="ui-viewer__stage"
        style={{
          flex: isEmbedded ? 1 : undefined,
          height: isFullscreen ? 'calc(100vh - 90px)' : isEmbedded ? '100%' : height,
          minHeight: isEmbedded ? '200px' : undefined,
        }}
      >
        {tab === 'html' && htmlOk ? (
          <iframe
            src={htmlUrl!}
            title={`HTML view of ${cleanId}`}
            width="100%"
            height="100%"
            style={{ border: 'none' }}
            loading="lazy"
          />
        ) : tab === 'notes' ? (
          <NotesPanel coupledNoteId={coupledNoteId} onCreateNotes={onCreateNotes} currentUser={currentUser} />
        ) : (
          <iframe
            src={`${streamUrl}#page=${initialPage}&view=FitH`}
            title={`PDF Stream ${cleanId}`}
            width="100%"
            height="100%"
            style={{
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              transition: 'transform var(--motion-fast) var(--ease-out)',
            }}
            loading="lazy"
          />
        )}
      </div>
    </ResourceViewerFrame>
  );
};

export default PdfViewer;
