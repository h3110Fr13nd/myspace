import React from 'react';
import { PdfViewer } from '../../components/PdfViewer';
import { ImageViewer } from '../../components/ImageViewer';
import { GoogleDriveViewer } from '../../components/GoogleDriveViewer';
import { MermaidViewer } from '../../components/MermaidViewer';
import { ExcalidrawViewer } from '../../components/ExcalidrawViewer';
import { JupyterViewer } from '../../components/JupyterViewer';
import { SheetGrid } from '../../components/SheetGrid';
import { DynamicForm } from '../../components/DynamicForm';
import { CanvasViewer } from '../../components/canvas/CanvasViewer';
import { resolveResourceType } from '../../lib/registry/resourceRegistry';

export interface ViewerProps {
  assetId?: string;
  resourceId?: string;
  diagramId?: string;
  notebookId?: string;
  sheetId?: string;
  formId?: string;
  canvasId?: string;
  type?: string;
  title?: string;
  initialCode?: string;
  code?: string;
  rawContent?: string;
  rawJson?: string;
  metadata?: Record<string, any>;
  currentUser?: string;
  isEmbedded?: boolean;
  height?: string | number;
  depth?: number;
  lod?: 'full' | 'medium' | 'minimal';
}

export function renderResourceContent(
  resourceType: string,
  props: ViewerProps
): React.ReactElement | null {
  const typeDef = resolveResourceType({ type: resourceType, id: props.assetId || props.resourceId, file: props.assetId || props.resourceId });
  const resolvedType = typeDef.type;

  switch (resolvedType) {
    case 'canvas': {
      const canvasId = props.canvasId ||
        (props.assetId || props.resourceId || '').replace(/^canvas[:\/]/, '').replace(/^public_vault\/canvas\//, '').replace(/\.canvas$/, '');
      return (
        <CanvasViewer
          canvasId={canvasId}
          initialData={props.metadata?.canvasData}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
          depth={(props.depth || 0) + 1}
        />
      );
    }

    case 'pdf': {
      const pdfHeight = props.height !== undefined ? String(props.height) : (props.isEmbedded ? '100%' : '720px');
      return (
        <PdfViewer
          assetId={props.assetId || props.resourceId || ''}
          title={props.title}
          currentUser={props.currentUser}
          initialPage={1}
          height={pdfHeight}
          isEmbedded={props.isEmbedded ?? true}
        />
      );
    }

    case 'image': {
      return (
        <ImageViewer
          assetId={props.assetId || props.resourceId || ''}
          title={props.title || 'Image Resource Asset'}
          currentUser={props.currentUser || 'user:anonymous'}
          metadata={props.metadata}
          isEmbedded={props.isEmbedded ?? true}
        />
      );
    }

    case 'sheet': {
      return (
        <SheetGrid
          sheetId={props.sheetId || props.assetId || props.resourceId || ''}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
          csvData={props.metadata?.csvData}
          rawData={props.metadata?.sheetData}
          title={props.title}
        />
      );
    }

    case 'form': {
      return (
        <DynamicForm
          formId={props.formId || props.assetId || props.resourceId || ''}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
        />
      );
    }

    case 'google_doc':
    case 'google_sheet': {
      return (
        <GoogleDriveViewer
          assetId={props.assetId || props.resourceId || ''}
          type={resourceType}
          title={props.title || 'Google Drive Item'}
          currentUser={props.currentUser || 'user:anonymous'}
          metadata={props.metadata}
          isEmbedded={props.isEmbedded ?? true}
        />
      );
    }

    case 'excalidraw': {
      return (
        <ExcalidrawViewer
          assetId={props.assetId || props.resourceId || ''}
          title={props.title || 'Excalidraw Sketch'}
          rawContent={props.rawContent || (props.metadata?.elements ? JSON.stringify(props.metadata) : '{}')}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
          height={props.height as string || (props.isEmbedded ? '100%' : undefined)}
        />
      );
    }

    case 'jupyter': {
      return (
        <JupyterViewer
          notebookId={props.notebookId || props.assetId || props.resourceId || ''}
          title={props.title || 'Jupyter Notebook'}
          rawJson={props.rawJson || (props.metadata?.cells ? JSON.stringify(props.metadata) : '{}')}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
          height={props.height as string || (props.isEmbedded ? '100%' : undefined)}
        />
      );
    }

    case 'mermaid': {
      return (
        <MermaidViewer
          diagramId={props.diagramId || props.assetId || props.resourceId || ''}
          title={props.title || 'Mermaid Diagram Viewer'}
          initialCode={props.initialCode || props.code || props.metadata?.chart || 'graph TD;\n  A[Start] --> B[Finish];'}
          currentUser={props.currentUser || 'user:anonymous'}
          isEmbedded={props.isEmbedded ?? true}
          height={props.height as string || (props.isEmbedded ? '100%' : undefined)}
        />
      );
    }

    default: {
      return null;
    }
  }
}

export function getViewerComponent(resourceType: string): React.ComponentType<ViewerProps> | null {
  const typeDef = resolveResourceType({ type: resourceType });
  const resolvedType = typeDef.type;

  const componentMap: Record<string, React.ComponentType<ViewerProps>> = {
    canvas: CanvasViewer as React.ComponentType<ViewerProps>,
    pdf: PdfViewer as React.ComponentType<ViewerProps>,
    image: ImageViewer as React.ComponentType<ViewerProps>,
    sheet: SheetGrid as React.ComponentType<ViewerProps>,
    form: DynamicForm as React.ComponentType<ViewerProps>,
    google_doc: GoogleDriveViewer as React.ComponentType<ViewerProps>,
    google_sheet: GoogleDriveViewer as React.ComponentType<ViewerProps>,
    excalidraw: ExcalidrawViewer as React.ComponentType<ViewerProps>,
    jupyter: JupyterViewer as React.ComponentType<ViewerProps>,
    mermaid: MermaidViewer as React.ComponentType<ViewerProps>,
  };

  return componentMap[resolvedType] || null;
}