import { flushSync, tick } from 'svelte';
import { reducedMotion } from './motion';
import { afterOverlays } from './ui/overlay';

/**
 * Minimal hash router: "#/set/12?mode=write" → { path: '/set/12', parts: ['set', '12'], query }.
 * Hash routing keeps GitHub Pages happy (no server rewrites needed).
 *
 * Navigation direction (for page transitions) comes from a history index kept in
 * history.state.idx: a higher index than the current one = forward, lower = back.
 * Moves between two tab roots are 'tab'; replace() is 'replace' (no animation).
 * When the View Transitions API is available (and motion isn't reduced) the route update
 * runs inside document.startViewTransition() and <html data-nav="…"> tells CSS which
 * animation to play (see app.css, "Page transitions").
 *
 * Open dialogs and sheets add same-URL history entries ({ ...state, overlay }) so the system
 * back button closes them first (see ui/overlay.ts). onExternal ignores those pops because the
 * hash doesn't change; go()/replace()/switchTab()/back() drop them before navigating.
 */
export const route = $state({
  path: '/',
  parts: [] as string[],
  query: new URLSearchParams(),
});

export type NavDirection = 'forward' | 'back' | 'tab' | 'replace' | 'none';

/** Direction of the latest navigation. */
export const nav = $state({ direction: 'none' as NavDirection });

/** Routes that show the bottom tab bar. */
export const TAB_ROOTS = ['/', '/library', '/levels', '/read', '/settings'] as const;

export function isTabRoot(path: string): boolean {
  return (TAB_ROOTS as readonly string[]).includes(path);
}

/** Best guess at a page's parent, for back() when there is no history (e.g. a deep link). */
export function parentOf(path: string): string {
  const head = path.split('/').filter(Boolean)[0];
  if (head === 'level' || head === 'placement') return '/levels';
  if (head === 'article' || head === 'paste') return '/read';
  if (head === 'set' || head === 'folder' || head === 'card' || head === 'import') return '/library';
  return '/';
}

let idx = 0;
/** Hash we're showing or about to show; dedupes popstate + hashchange for one move. */
let current = '';
const scrollMemo = new Map<number, number>();

const currentHash = () => location.hash || '#/';

function parse(hash: string) {
  const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
  route.path = path || '/';
  route.parts = route.path.split('/').filter(Boolean).map(decodeURIComponent);
  route.query = new URLSearchParams(query);
}

function pathOf(hash: string) {
  return (hash.replace(/^#/, '') || '/').split('?')[0] || '/';
}

let navToken = 0;

function restoreScroll(dir: NavDirection) {
  const target = dir === 'back' ? (scrollMemo.get(idx) ?? 0) : 0;
  window.scrollTo(0, target);
  if (target <= 0) return;
  // Content often loads async (IndexedDB); retry for a moment until the page is tall enough.
  const until = performance.now() + 600;
  const retry = () => {
    if (Math.abs(window.scrollY - target) < 2 || performance.now() > until) return;
    window.scrollTo(0, target);
    requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

/** Apply a location change to `route`, animated when possible. */
function commit(hash: string, requested: NavDirection) {
  const from = route.path;
  const to = pathOf(hash);
  const dir: NavDirection =
    requested !== 'replace' && requested !== 'none' && isTabRoot(from) && isTabRoot(to) && from !== to ? 'tab' : requested;
  nav.direction = dir;

  const update = () => {
    parse(hash);
  };

  const animate =
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    dir !== 'replace' &&
    dir !== 'none' &&
    !reducedMotion() &&
    document.visibilityState === 'visible';

  if (!animate) {
    update();
    void tick().then(() => restoreScroll(dir));
    return;
  }

  const token = ++navToken;
  const root = document.documentElement;
  root.dataset.nav = dir;
  try {
    const transition = document.startViewTransition(() => {
      update();
      flushSync();
      restoreScroll(dir);
    });
    // A newer navigation skips this one; that rejects `ready`, which is expected.
    transition.ready.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (token === navToken) delete root.dataset.nav;
      });
  } catch {
    delete root.dataset.nav;
    update();
    void tick().then(() => restoreScroll(dir));
  }
}

/** Back/forward buttons, history.back(), or a hash typed by hand. */
function onExternal() {
  const hash = currentHash();
  if (hash === current) return;
  scrollMemo.set(idx, window.scrollY);
  const stateIdx = (history.state as { idx?: number } | null)?.idx;
  let dir: NavDirection;
  if (typeof stateIdx === 'number') {
    dir = stateIdx < idx ? 'back' : stateIdx > idx ? 'forward' : 'replace';
    idx = stateIdx;
  } else {
    // New entry the browser created for us (e.g. a link to "#/set/3"): stamp it.
    idx += 1;
    history.replaceState({ idx }, '', hash);
    dir = 'forward';
  }
  current = hash;
  commit(hash, dir);
}

if (typeof window !== 'undefined') {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const stateIdx = (history.state as { idx?: number } | null)?.idx;
  if (typeof stateIdx === 'number') idx = stateIdx;
  else history.replaceState({ idx }, '', currentHash());
  current = currentHash();
  parse(current);
  window.addEventListener('popstate', onExternal);
  window.addEventListener('hashchange', onExternal);
}

function toHash(path: string, query?: Record<string, string | number>) {
  const q = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : '';
  return `#${path}${q}`;
}

/** Navigate, e.g. go('/set/3') or go('/card/new', { set: 3 }). */
export function go(path: string, query?: Record<string, string | number>) {
  const hash = toHash(path, query);
  afterOverlays(() => {
    if (hash === current) return;
    scrollMemo.set(idx, window.scrollY);
    idx += 1;
    // Entries after this one are gone now; forget their scroll positions.
    for (const k of scrollMemo.keys()) if (k >= idx) scrollMemo.delete(k);
    history.pushState({ idx }, '', hash);
    current = hash;
    commit(hash, 'forward');
  });
}

/** Replace the current entry (no new history entry, no animation). */
export function replace(path: string) {
  const hash = `#${path}`;
  afterOverlays(() => {
    history.replaceState({ idx }, '', hash);
    current = hash;
    commit(hash, 'replace');
  });
}

/**
 * Switch tab (used by the tab bar): replaces the current entry so tabs don't pile up
 * history, with the quick crossfade.
 */
export function switchTab(path: string) {
  const hash = `#${path}`;
  afterOverlays(() => {
    if (hash === current) return;
    history.replaceState({ idx }, '', hash);
    current = hash;
    commit(hash, 'tab');
  });
}

export function back(fallback = '/') {
  afterOverlays(() => {
    if (idx > 0) {
      history.back();
      return;
    }
    // Opened directly on this page (no in-app history): go "up" to the fallback.
    const hash = `#${fallback}`;
    if (hash === current) return;
    scrollMemo.delete(idx);
    history.replaceState({ idx }, '', hash);
    current = hash;
    commit(hash, 'back');
  });
}
