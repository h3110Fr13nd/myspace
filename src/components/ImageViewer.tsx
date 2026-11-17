import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { ResourceViewerFrame } from './ui/ResourceViewerFrame';
import { Button, IconButton } from './ui/Button';
import { showToast } from './ui/Toast';
import { useZoomPan } from '../lib/viewer/useZoomPan';
import '../styles/image-viewer.css';

interface ImageViewerProps {
  assetId: string;
  title: string;
  currentUser: string;
  metadata?: any;
  isEmbedded?: boolean;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ assetId, title, metadata, isEmbedded = false }) => {
  const { scale, zoomIn, zoomOut } = useZoomPan({ min: 0.5, max: 2.5, step: 0.25, initial: 1 });
  const cleanId = assetId.replace(/^image:/, '');
  const imageUrl = metadata?.url || `/api/v1/assets/image/${encodeURIComponent(cleanId)}`;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => { setFailed(false); }, [imageUrl]);
  // A server-rendered image can fail before the island hydrates and attaches
  // onError. Recover that state instead of leaving a broken image without Retry.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, [imageUrl, attempt]);

  return (
    <ResourceViewerFrame
      meta={{ icon: <ImageIcon size={18} />, title: title || 'Image' }}
      actions={<>
        <IconButton label="Zoom Out" ghost onClick={zoomOut} disabled={failed}><ZoomOut size={16} /></IconButton>
        <span className="ui-viewer__zoom">{Math.round(scale * 100)}%</span>
        <IconButton label="Zoom In" ghost onClick={zoomIn} disabled={failed}><ZoomIn size={16} /></IconButton>
        <a href={imageUrl} download={metadata?.fileName || cleanId} className="ui-button ui-button--sm ui-button--primary">
          <Download size={14} aria-hidden="true" /> Download image
        </a>
      </>}
      embedded={isEmbedded}
      mode={isEmbedded ? 'embedded' : 'standalone'}
      className={isEmbedded ? 'image-viewer image-viewer--embedded' : 'image-viewer'}
    >
      <div className="ui-viewer__stage ui-viewer__stage--scroll image-viewer__stage">
        {failed ? (
          <div role="alert" className="ui-col ui-align-center ui-gap-3">
            <p>Image could not be loaded. Check your connection and try again.</p>
            <Button variant="secondary" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>Retry image</Button>
          </div>
        ) : (
          <img ref={imageRef} key={`${imageUrl}:${attempt}`} src={imageUrl} alt={title} className="image-viewer__image"
            style={{ transform: `scale(${scale})` }}
            onError={() => { setFailed(true); showToast('Image could not be loaded.', { tone: 'danger' }); }}
          />
        )}
      </div>
    </ResourceViewerFrame>
  );
};

export default ImageViewer;
