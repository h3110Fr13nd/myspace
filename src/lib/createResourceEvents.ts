/**
 * Shared cross-cutting event contract for the unified Create/Import modal.
 * Kept dependency-free so non-React surfaces (AppPortals.astro inline scripts,
 * FolderTree, SearchModal) can dispatch it without pulling the modal into
 * their client bundles.
 */

export const OPEN_CREATE_RESOURCE_EVENT = 'open-create-resource-modal';
const PENDING_OPTIONS_KEY = '__pendingCreateResourceModalOptions';

export type CreateResourceType =
  | 'document'
  | 'folder'
  | 'canvas'
  | 'sheet'
  | 'excalidraw'
  | 'mermaid'
  | 'pdf'
  | 'image'
  | 'google_sheet'
  | 'google_doc';

export interface CreateResourceModalOptions {
  parentFolder?: string;
  spaceId?: string;
  type?: CreateResourceType;
  mode?: 'create' | 'import';
  title?: string;
}

export function openCreateResourceModal(options?: CreateResourceModalOptions): void {
  if (typeof window !== 'undefined') {
    (window as Window & { [PENDING_OPTIONS_KEY]?: CreateResourceModalOptions })[
      PENDING_OPTIONS_KEY
    ] = options || {};
    window.dispatchEvent(
      new CustomEvent<CreateResourceModalOptions>(OPEN_CREATE_RESOURCE_EVENT, { detail: options || {} })
    );
  }
}

/** Take a request dispatched before the idle-loaded modal has hydrated. */
export function takePendingCreateResourceModalOptions(): CreateResourceModalOptions | undefined {
  if (typeof window === 'undefined') return undefined;
  const pendingWindow = window as Window & {
    [PENDING_OPTIONS_KEY]?: CreateResourceModalOptions;
  };
  const options = pendingWindow[PENDING_OPTIONS_KEY];
  delete pendingWindow[PENDING_OPTIONS_KEY];
  return options;
}

/** Declare the global helper used by AppPortals.astro inline scripts */
declare global {
  interface Window {
    openCreateResourceModal?: (opts?: CreateResourceModalOptions) => void;
  }
}
