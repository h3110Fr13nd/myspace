/**
 * (workspace_theme) and exposes typed read/write helpers plus DOM application.
 *
 * Theme dimensions (each maps to an attribute on <html>):
 *   - data-theme    dark | light
 *   - data-accent   brand | violet | emerald | rose | ocean
 *   - data-density  comfortable | compact
 *   - data-mode     glass | flat
 *   - data-chrome   header | rail | rail-pinned  (see lib/chrome.ts)
 */

export type Theme = 'dark' | 'light';
export type Accent = 'brand' | 'violet' | 'emerald' | 'rose' | 'ocean';
export type Density = 'comfortable' | 'compact';
export type SurfaceMode = 'glass' | 'flat';
export type { ChromeMode } from './chrome';

import { DEFAULT_CHROME_MODE, resolveChromeMode, type ChromeMode } from './chrome';

export interface WorkspacePrefs {
  theme: Theme;
  accent: Accent;
  density: Density;
  mode: SurfaceMode;
  chrome: ChromeMode;
}

export const PREF_KEY = 'workspace_prefs';
const LEGACY_THEME_KEY = 'workspace_theme';

export const DEFAULT_PREFS: WorkspacePrefs = {
  theme: 'dark',
  accent: 'brand',
  density: 'comfortable',
  mode: 'glass',
  chrome: DEFAULT_CHROME_MODE,
};

export const ACCENTS: { value: Accent; label: string }[] = [
  { value: 'brand', label: 'Brand Cyan-Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'ocean', label: 'Ocean Blue' },
];

export const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

export const MODES: { value: SurfaceMode; label: string }[] = [
  { value: 'glass', label: 'Glass (blur)' },
  { value: 'flat', label: 'Flat (solid)' },
];

/** Resolve saved prefs, honoring the legacy single-key theme, else defaults. */
export function readPrefs(): WorkspacePrefs {
  const base: WorkspacePrefs = { ...DEFAULT_PREFS };
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const saved = { ...base, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) };
      // Unknown/removed chrome modes fall back instead of breaking the layout.
      saved.chrome = resolveChromeMode(saved.chrome);
      return saved;
    }
  } catch (e) {
    /* ignore corrupt prefs */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      base.theme = legacy;
      return base;
    }
  } catch (e) {
    /* ignore */
  }
  // Nothing saved yet: follow the OS colour scheme. This mirrors the pre-paint
  // boot script in ResourceHead.astro so both agree on the initial theme.
  try {
    if (typeof window.matchMedia === 'function') {
      base.theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
  } catch (e) {
    /* ignore */
  }
  return base;
}

export function writePrefs(prefs: WorkspacePrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch (e) {
    /* ignore quota errors */
  }
}

export function setPrefs(mutator: (prev: WorkspacePrefs) => WorkspacePrefs): WorkspacePrefs {
  const next = mutator(readPrefs());
  writePrefs(next);
  applyPrefs(next);
  return next;
}

/** Apply all prefs to the document root so CSS variable overlays take effect. */
export function applyPrefs(prefs: WorkspacePrefs): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.setAttribute('data-theme', prefs.theme);
  el.setAttribute('data-accent', prefs.accent || 'brand');
  el.setAttribute('data-density', prefs.density || 'comfortable');
  el.setAttribute('data-mode', prefs.mode || 'glass');
  el.setAttribute('data-chrome', resolveChromeMode(prefs.chrome));
}