import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { Button } from './ui/Button';
import { showToast } from './ui/Toast';

interface ReadToggleProps {
  resourceId: string;
  currentUser?: string;
  title?: string;
  size?: 'sm' | 'md';
}

function getStorageKey(user?: string): string {
  const cleanUser = (user || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `foss_read_resources_${cleanUser}`;
}

export function getReadSet(user?: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(getStorageKey(user));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function toggleReadState(id: string, user?: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const set = getReadSet(user);
    const isCurrentlyRead = set.has(id);
    if (isCurrentlyRead) {
      set.delete(id);
    } else {
      set.add(id);
    }
    localStorage.setItem(getStorageKey(user), JSON.stringify(Array.from(set)));
    window.dispatchEvent(new CustomEvent('resource-read-status-changed', {
      detail: { id, user: user || 'anonymous', isRead: !isCurrentlyRead }
    }));
    return !isCurrentlyRead;
  } catch {
    showToast('Could not save reading status on this device. Please try again.', { tone: 'danger' });
    return null;
  }
}

export const ReadToggle: React.FC<ReadToggleProps> = ({ resourceId, currentUser = 'anonymous', title, size = 'md' }) => {
  const [isRead, setIsRead] = useState(false);

  useEffect(() => {
    const set = getReadSet(currentUser);
    setIsRead(set.has(resourceId));

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string; user?: string; isRead: boolean }>;
      if (customEvent.detail?.id === resourceId && (!customEvent.detail.user || customEvent.detail.user === currentUser)) {
        setIsRead(customEvent.detail.isRead);
      }
    };

    window.addEventListener('resource-read-status-changed', handleUpdate);
    return () => window.removeEventListener('resource-read-status-changed', handleUpdate);
  }, [resourceId, currentUser]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newState = toggleReadState(resourceId, currentUser);
    if (newState !== null) setIsRead(newState);
  };

  return (
    <Button type="button" variant="secondary" size={size}
      onClick={handleToggle}
      className={`read-toggle-btn ${isRead ? 'is-read' : 'is-unread'}`}
      aria-label={isRead ? 'Mark as Unread' : 'Mark as Read'}
      title={isRead ? 'Mark this resource as unread' : 'Mark this resource as read'}>
      {isRead ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
      <span>{isRead ? 'Read' : 'Mark as Read'}</span>
    </Button>
  );
};
