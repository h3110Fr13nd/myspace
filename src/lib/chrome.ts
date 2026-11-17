/**
 * Chrome mode registry — the single source of truth for how the app's
 * navigation chrome is presented.
 *
 * A mode is only data here. Everything else keys off it:
 *   - `src/lib/prefs.ts`        persists it and reflects it as `data-chrome`
 *   - `src/styles/chrome.css`   decides what each mode shows
 *   - `settings/appearance`     renders one option per entry
 *
 * Adding a mode: add an entry, add its CSS block. Nothing else needs to know.
 * Removing a mode: delete the entry and its CSS block. The chrome components
 * (BrandBlock, SearchModal, ActionRail, TopBar) are mode-agnostic.
 */

export const CHROME_MODES = ['header', 'rail', 'rail-pinned'] as const;

export type ChromeMode = (typeof CHROME_MODES)[number];

export interface ChromeModeOption {
  value: ChromeMode;
  label: string;
  /** Short descriptor for the settings card. */
  hint: string;
  icon: string;
}

export const DEFAULT_CHROME_MODE: ChromeMode = 'rail';

export const CHROME_MODE_OPTIONS: ChromeModeOption[] = [
  {
    value: 'header',
    label: 'Header bar',
    hint: 'Full-width header with brand, centred search and labelled actions',
    icon: '▤',
  },
  {
    value: 'rail',
    label: 'Floating rail',
    hint: 'Actions float over the content and fade out while you read',
    icon: '◱',
  },
  {
    value: 'rail-pinned',
    label: 'Pinned rail',
    hint: 'Same layout, but the rail stays put over the graph panel',
    icon: '◰',
  },
];

export function isChromeMode(value: unknown): value is ChromeMode {
  return typeof value === 'string' && (CHROME_MODES as readonly string[]).includes(value);
}

/** Coerce anything (saved prefs, query strings) to a valid mode. */
export function resolveChromeMode(value: unknown): ChromeMode {
  return isChromeMode(value) ? value : DEFAULT_CHROME_MODE;
}

/** The mode currently reflected on <html data-chrome>. */
export function getActiveChromeMode(): ChromeMode {
  if (typeof document === 'undefined') return DEFAULT_CHROME_MODE;
  return resolveChromeMode(document.documentElement.getAttribute('data-chrome'));
}

/** True when the floating rail should auto-hide (hover/focus still reveal it). */
export function chromeModeAutoHides(mode: ChromeMode = getActiveChromeMode()): boolean {
  return mode === 'rail';
}
