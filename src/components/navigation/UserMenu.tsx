import React, { useState, useRef, useEffect, useId } from 'react';
import { Palette, Key, Shield, FolderSync, Rss, LogOut, Command, ExternalLink } from 'lucide-react';
import { getUserFeedPath } from '../../lib/userIdentity';
import { authHref } from '../../lib/authRedirect';

export interface UserMenuProps {
  currentUser?: string;
  displayName?: string | null;
  /** Real address from the verified session; shown in the dropdown, not on the trigger. */
  email?: string | null;
  isAuthenticated?: boolean;
  returnTo?: string;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  currentUser = 'user:anonymous',
  displayName = null,
  email = null,
  isAuthenticated = false,
  returnTo = '/',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [canManageWorkspaceAccess, setCanManageWorkspaceAccess] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
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

    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isAuthenticated) {
    return (
      <div className="user-menu-guest">
        <a href={authHref('/login', returnTo)} className="ui-button ui-button--sm ui-button--secondary">
          Sign In
        </a>
        <a href={authHref('/register', returnTo)} className="ui-button ui-button--sm ui-button--primary">
          Register
        </a>
      </div>
    );
  }

  const initial = displayName ? displayName[0].toUpperCase() : '?';

  return (
    <div
      ref={menuRef}
      className="user-menu-wrapper"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="user-menu-trigger"
        data-ready={isReady}
        onClick={() => {
          if (!isOpen) setCanManageWorkspaceAccess(false);
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label={displayName ? `Account menu for ${displayName}` : 'Account menu'}
        title={displayName || 'Account'}
        className="user-menu-trigger"
      >
        <span className="user-menu-avatar" aria-hidden="true">{initial}</span>
      </button>

      {isOpen && (
        <nav id={menuId} aria-label="Account" className="user-menu-dropdown">
          <div className="user-menu-identity">
            <div className="user-menu-identity__label">Signed in as</div>
            <div className="user-menu-identity__name">{displayName}</div>
            {email && <div className="user-menu-identity__email">{email}</div>}
          </div>

          <a
            href="/vault/sync"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <FolderSync size={16} />
            <span>Sync Obsidian Vault</span>
          </a>

          {canManageWorkspaceAccess && (
            <a
              href="/admin/permissions"
              className="user-menu-item"
              onClick={() => setIsOpen(false)}
            >
              <Shield size={16} />
              <span>Workspace access</span>
            </a>
          )}

          <div className="user-menu-divider" role="separator" />

          <a
            href="/settings/appearance"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <Palette size={16} />
            <span>Appearance & Themes</span>
          </a>

          <a
            href="/settings/security"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <Key size={16} />
            <span>Security & API Keys</span>
          </a>

          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setIsOpen(false);
              window.dispatchEvent(new CustomEvent('open-keyboard-shortcuts'));
            }}
          >
            <Command size={16} />
            <span className="user-menu-item__label">
              <span>Keyboard Shortcuts</span>
              <kbd>?</kbd>
            </span>
          </button>

          {displayName && (
            <a
              href={getUserFeedPath(currentUser)}
              target="_blank"
              rel="noreferrer"
              className="user-menu-item"
              onClick={() => setIsOpen(false)}
            >
              <Rss size={16} />
              <span className="user-menu-item__label">
                <span>Your public feed</span>
                <ExternalLink size={12} aria-hidden="true" />
              </span>
            </a>
          )}

          <div className="user-menu-divider" role="separator" />

          <a
            href="/api/v1/auth/logout"
            data-testid="logout-btn"
            className="user-menu-item user-menu-item--danger"
            onClick={() => setIsOpen(false)}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </a>
        </nav>
      )}
    </div>
  );
};
