export const FOCUS_WORKSPACE_SEARCH_EVENT = 'focus-workspace-search';

/** Open the existing workspace search, including before its island hydrates. */
export function requestWorkspaceSearchFocus(): void {
  if (typeof window === 'undefined') return;
  window.__workspaceSearchFocusPending = true;
  window.dispatchEvent(new CustomEvent(FOCUS_WORKSPACE_SEARCH_EVENT));
}

declare global {
  interface Window {
    __workspaceSearchFocusPending?: boolean;
  }
}
