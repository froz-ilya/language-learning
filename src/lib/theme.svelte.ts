import { settings } from './settings.svelte';
import type { ThemeSetting } from './types';

/**
 * Light/dark theme. The resolved theme is set as <html data-theme="light|dark">; CSS tokens in
 * app.css switch on it. 'auto' follows the phone's setting and updates when it changes.
 * The choice is mirrored to localStorage so index.html can apply it before the first paint.
 */
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;

export function resolveTheme(choice: ThemeSetting, systemDark: boolean): 'light' | 'dark' {
  return choice === 'auto' ? (systemDark ? 'dark' : 'light') : choice;
}

function apply(choice: ThemeSetting) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(choice, !!media?.matches);
  try {
    localStorage.setItem('theme', choice);
  } catch {
    // Private mode: the theme still applies for this session.
  }
  // Status bar / Android task switcher color follows the page background.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && bg) meta.content = bg;
}

/** Apply now, and again whenever the setting or the phone's light/dark mode changes. */
export function initTheme(): void {
  if (typeof document === 'undefined') return;
  $effect.root(() => {
    $effect(() => apply(settings.theme));
  });
  media?.addEventListener('change', () => apply(settings.theme));
}
