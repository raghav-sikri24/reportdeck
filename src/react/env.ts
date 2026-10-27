import { useSyncExternalStore } from 'react';
import type { ColorMode, ThemeSetting } from '../core/types';

const canUseDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';

export function isDev(): boolean {
  try {
    return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

const warned = new Set<string>();
/** Logs each distinct message once, in development only. */
export function warnDev(message: string): void {
  if (!isDev() || warned.has(message)) return;
  warned.add(message);
  console.warn(`[reportdeck] ${message}`);
}

function subscribeMedia(query: string, onChange: () => void): () => void {
  if (!canUseDOM() || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener?.('change', onChange);
  return () => mql.removeEventListener?.('change', onChange);
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(query, cb),
    () => (canUseDOM() && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : serverValue),
    () => serverValue,
  );
}

/**
 * Reads an explicit page theme: `data-theme="dark|light"` or a `dark`/`light`
 * class on <html> (Tailwind, shadcn, Next themes), so charts follow the app's
 * own toggle, not just the OS setting.
 */
function readDocumentTheme(): ColorMode | null {
  if (!canUseDOM()) return null;
  const html = document.documentElement;
  const attr = html.getAttribute('data-theme') ?? html.getAttribute('data-color-scheme');
  if (attr === 'dark' || attr === 'light') return attr;
  if (html.classList.contains('dark')) return 'dark';
  if (html.classList.contains('light')) return 'light';
  const scheme = html.style.colorScheme;
  if (scheme === 'dark' || scheme === 'light') return scheme;
  return null;
}

function subscribeDocumentTheme(onChange: () => void): () => void {
  if (!canUseDOM() || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style'],
  });
  return () => observer.disconnect();
}

export function useColorMode(setting: ThemeSetting): ColorMode {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const docTheme = useSyncExternalStore(subscribeDocumentTheme, readDocumentTheme, () => null);
  if (setting !== 'auto') return setting;
  return docTheme ?? (prefersDark ? 'dark' : 'light');
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useForcedColors(): boolean {
  return useMediaQuery('(forced-colors: active)');
}
