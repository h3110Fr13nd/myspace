import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

declare global {
  interface Window {
    /** Global toast bridge so <script is:inline> pages can use showToast too. */
    showToast?: (message: React.ReactNode, options?: ToastOptions) => void;
  }
}

export type ToastTone = 'success' | 'danger' | 'info' | 'warn';

export interface ToastEntry {
  id: number;
  message: React.ReactNode;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
}

type Listener = (toasts: ToastEntry[]) => void;

let toasts: ToastEntry[] = [];
let listeners: Listener[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((l) => l(toasts));
}

/** Show a global toast (tone defaults to info). Called outside React. */
if (typeof window !== 'undefined') {
  window.showToast = showToast;
}

export function showToast(message: React.ReactNode, options: ToastOptions = {}): void {
  const { tone = 'info', duration = 2600 } = options;
  const entry: ToastEntry = { id: nextId++, message, tone };
  toasts = [...toasts, entry];
  emit();
  if (duration > 0) {
    window.setTimeout(() => dismissToast(entry.id), duration);
  }
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const toneIcon: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 size={16} />,
  danger: <AlertCircle size={16} />,
  info: <Info size={16} />,
  warn: <AlertTriangle size={16} />,
};

const toneClass: Record<ToastTone, string> = {
  success: 'ui-toast--success',
  danger: 'ui-toast--danger',
  info: 'ui-toast--info',
  warn: 'ui-toast--warn',
};

/** Renders active toasts; mount once (e.g. inside BaseLayout / Header). */
export const Toaster: React.FC = () => {
  const [items, setItems] = useState<ToastEntry[]>(toasts);

  useEffect(() => {
    const listener: Listener = (next) => setItems(next);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (items.length === 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={['ui-toast', toneClass[t.tone]].filter(Boolean).join(' ')}>
          <span aria-hidden="true">{toneIcon[t.tone]}</span>
          <span>{t.message}</span>
          <button className="ui-toast__close" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
};

export const useToast = () => useCallback(showToast, []);