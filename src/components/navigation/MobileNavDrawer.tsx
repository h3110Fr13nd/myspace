import React from 'react';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { openCreateResourceModal } from '../../lib/createResourceEvents';
import { requestWorkspaceSearchFocus } from '../../lib/workspaceSearchEvents';
import { getUserFeedPath } from '../../lib/userIdentity';
import { authHref } from '../../lib/authRedirect';
import {
  Home,
  Search,
  Tag,
  Palette,
  Key,
  Shield,
  FolderSync,
  Rss,
  LogOut,
  Plus,
  Share2,
} from 'lucide-react';

export interface MobileNavDrawerProps {
  initialOpen?: boolean;
  currentUser?: string;
  displayName?: string | null;
  email?: string | null;
  isAuthenticated?: boolean;
  activeResourceId?: string;
  activeTitle?: string;
  activeType?: string;
  returnTo?: string;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  initialOpen = false,
  currentUser = 'user:anonymous',
  displayName = null,
  email = null,
  isAuthenticated = false,
  activeResourceId,
  activeTitle,
  activeType = 'document',
  returnTo = '/',
}) => {
  const [isOpen, setIsOpen] = React.useState(initialOpen);
  const [canManageWorkspaceAccess, setCanManageWorkspaceAccess] = React.useState(false);
  const workspaceAccessRequest = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const mobileNavWindow = window as Window & { __mobileNavOpen?: boolean };
    const handleOpen = () => {
      mobileNavWindow.__mobileNavOpen = false;
      workspaceAccessRequest.current?.abort();
      const controller = new AbortController();
      workspaceAccessRequest.current = controller;
      setCanManageWorkspaceAccess(false);
      fetch('/api/v1/permissions/workspace-access', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => setCanManageWorkspaceAccess(result?.canManageWorkspaceAccess === true))
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          setCanManageWorkspaceAccess(false);
        });
      setIsOpen(true);
    };
    const handleClose = () => {
      workspaceAccessRequest.current?.abort();
      setIsOpen(false);
    };
    window.addEventListener('open-mobile-nav', handleOpen);
    window.addEventListener('close-mobile-nav', handleClose);
    if (mobileNavWindow.__mobileNavOpen) handleOpen();
    return () => {
      workspaceAccessRequest.current?.abort();
      window.removeEventListener('open-mobile-nav', handleOpen);
      window.removeEventListener('close-mobile-nav', handleClose);
    };
  }, []);

  const handleClose = () => setIsOpen(false);

  const handleOpenCreate = () => {
    handleClose();
    openCreateResourceModal({ mode: 'create' });
  };

  const handleOpenSearch = () => {
    handleClose();
    requestWorkspaceSearchFocus();
  };

  const handleOpenShare = () => {
    handleClose();
    window.dispatchEvent(
      new CustomEvent('open-share-modal', {
        detail: {
          resourceId: activeResourceId,
          title: activeTitle || activeResourceId,
          type: activeType,
        },
      })
    );
  };

  return (
    <Drawer
      open={isOpen}
      onClose={handleClose}
      side="left"
      width="min(320px, 86vw)"
      header="Workspace Navigation"
    >
      <div className="mobile-nav">
        <div className="mobile-nav__actions" role="group" aria-label="Quick actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenSearch}
            className="mobile-nav__action"
          >
            <Search size={16} aria-hidden="true" />
            <span>Search resources</span>
          </Button>

          {isAuthenticated && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenCreate}
              className="mobile-nav__action mobile-nav__action--primary"
            >
              <Plus size={16} />
              <span>New resource</span>
            </Button>
          )}

          {isAuthenticated && activeResourceId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenShare}
              className="mobile-nav__action"
            >
              <Share2 size={16} />
              <span>Share this resource</span>
            </Button>
          )}
        </div>

        <section className="mobile-nav__group" aria-labelledby="mobile-nav-workspace">
          <h2 id="mobile-nav-workspace" className="mobile-nav__heading">Workspace</h2>
          <a href="/" className="mobile-nav-link" onClick={handleClose}>
            <Home size={18} />
            <span>All resources</span>
          </a>
          <a href="/tags" className="mobile-nav-link" onClick={handleClose}>
            <Tag size={18} />
            <span>Browse tags</span>
          </a>
        </section>

        {isAuthenticated && (
          <section className="mobile-nav__group" aria-labelledby="mobile-nav-tools">
            <h2 id="mobile-nav-tools" className="mobile-nav__heading">Manage your workspace</h2>
            <a href="/vault/sync" className="mobile-nav-link" onClick={handleClose}>
              <FolderSync size={18} />
              <span>Sync Obsidian Vault</span>
            </a>
            {canManageWorkspaceAccess && (
              <a href="/admin/permissions" className="mobile-nav-link" onClick={handleClose}>
                <Shield size={18} />
                <span>Workspace access</span>
              </a>
            )}
            <a href="/settings/appearance" className="mobile-nav-link" onClick={handleClose}>
              <Palette size={18} />
              <span>Appearance &amp; Themes</span>
            </a>
            <a href="/settings/security" className="mobile-nav-link" onClick={handleClose}>
              <Key size={18} />
              <span>Security &amp; API Keys</span>
            </a>
            {displayName && (
              <a
                href={getUserFeedPath(currentUser)}
                target="_blank"
                rel="noreferrer"
                className="mobile-nav-link"
                onClick={handleClose}
              >
                <Rss size={18} />
                <span>Your public feed</span>
              </a>
            )}
          </section>
        )}

        <div className="mobile-nav__account">
          {isAuthenticated ? (
            <div className="mobile-nav__account-content">
              <div className="mobile-nav__identity">
                <div className="mobile-nav__avatar" aria-hidden="true">
                  {displayName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="mobile-nav__identity-copy">
                  <div className="mobile-nav__identity-label">Signed in as</div>
                  <div className="mobile-nav__display-name">
                    {displayName || 'Your account'}
                  </div>
                  {email && <div className="mobile-nav__user-email">{email}</div>}
                </div>
              </div>
              <a href="/api/v1/auth/logout" className="ui-button ui-button--sm ui-button--danger mobile-nav__signout">
                <LogOut size={14} />
                <span>Sign Out</span>
              </a>
            </div>
          ) : (
            <div className="mobile-nav__guest-actions">
              <a href={authHref('/login', returnTo)} className="ui-button ui-button--sm ui-button--secondary">
                Sign In
              </a>
              <a href={authHref('/register', returnTo)} className="ui-button ui-button--sm ui-button--primary">
                Register
              </a>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
};
