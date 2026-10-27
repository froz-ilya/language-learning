/**
 * Overlay stack: lets the system back button / back gesture (Android) close an open dialog,
 * action sheet or bottom sheet before it navigates.
 *
 * Opening an overlay pushes a same-URL history entry ({ ...history.state, overlay: id }), so
 * the router (which ignores pops whose hash equals the current one) doesn't navigate. A back
 * press then pops that entry and the popstate handler here closes the top overlay. When an
 * overlay closes another way (button, backdrop, Esc), release() calls history.back() to drop
 * its entry again, guarded so it never closes twice.
 *
 * History moves are asynchronous, so anything that touches history while one of our back()
 * calls is in flight waits for it (whenSettled): a new overlay's pushState and the router's
 * go()/replace()/back(). Otherwise a push could land before the pop and be undone by it.
 *
 *   const overlay = openOverlay(() => (open = false));   // when it opens
 *   overlay.release();                                    // when it closes (any way)
 */

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  go(delta: number): void;
}

export interface OverlayEnv {
  history: HistoryLike;
  href: () => string;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

export interface OverlayHandle {
  /** The overlay closed (any way). Safe to call more than once. */
  release(): void;
}

/** Give up waiting for our own popstate after this long (it should arrive within a frame). */
const SETTLE_TIMEOUT_MS = 600;

interface Entry {
  id: number;
  close: () => void;
  /** Its history entry exists (pushed and not yet popped / unwound). */
  pushed: boolean;
  open: boolean;
}

const overlayId = (state: unknown): number => {
  const v = (state as { overlay?: unknown } | null)?.overlay;
  return typeof v === 'number' ? v : 0;
};

export function createOverlayStack(env: OverlayEnv) {
  const stack: Entry[] = [];
  // Time based so ids of stale entries left over from before a reload are always smaller.
  let nextId = Date.now();
  /** popstate events we caused (history.go) and haven't seen yet. */
  let pending = 0;
  let waiters: (() => void)[] = [];
  let timer: unknown;

  function settle() {
    pending = 0;
    env.clearTimeout(timer);
    timer = undefined;
    const run = waiters;
    waiters = [];
    for (const fn of run) fn();
  }

  function goBack(n: number) {
    pending += 1;
    env.clearTimeout(timer);
    timer = env.setTimeout(settle, SETTLE_TIMEOUT_MS);
    env.history.go(-n);
  }

  /** Run fn now, or once our pending history moves have finished. */
  function whenSettled(fn: () => void) {
    if (pending === 0) fn();
    else waiters.push(fn);
  }

  function onPopstate() {
    if (pending > 0) {
      pending -= 1;
      if (pending === 0) settle();
      return;
    }
    // Back (or a jump) by the user: close every overlay whose entry we've left, top first.
    const current = overlayId(env.history.state);
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      if (!e.pushed || e.id <= current) continue;
      e.pushed = false;
      e.open = false;
      stack.splice(i, 1);
      e.close();
    }
  }

  function open(close: () => void): OverlayHandle {
    const e: Entry = { id: nextId++, close, pushed: false, open: true };
    stack.push(e);
    whenSettled(() => {
      if (!e.open || e.pushed) return;
      const state = env.history.state;
      const base = state && typeof state === 'object' ? state : {};
      env.history.pushState({ ...base, overlay: e.id }, '', env.href());
      e.pushed = true;
    });
    return {
      release() {
        if (!e.open) return;
        e.open = false;
        const i = stack.indexOf(e);
        if (i >= 0) stack.splice(i, 1);
        // Only step back while its own entry is the current one (not after a navigation).
        const onTop = e.pushed && overlayId(env.history.state) === e.id;
        e.pushed = false;
        if (onTop) goBack(1);
      },
    };
  }

  /**
   * Before a navigation: drop the history entries of open overlays (they're about to go away
   * with the page). The navigation itself should run through whenSettled().
   */
  function unwind() {
    let n = 0;
    for (const e of stack) {
      if (e.pushed) n++;
      e.pushed = false;
    }
    if (n) goBack(n);
  }

  return {
    open,
    whenSettled,
    unwind,
    /** Call on every popstate. */
    onPopstate,
    /** Any overlay open right now? */
    hasOpen: () => stack.length > 0,
    /** Our own history.go() is still in flight. */
    isPending: () => pending > 0,
  };
}

export type OverlayStack = ReturnType<typeof createOverlayStack>;

const overlays: OverlayStack | null =
  typeof window !== 'undefined' && typeof history !== 'undefined'
    ? createOverlayStack({
        history,
        href: () => location.href,
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (t) => window.clearTimeout(t as number),
      })
    : null;
if (overlays) window.addEventListener('popstate', overlays.onPopstate);

const noop: OverlayHandle = { release() {} };

/** Register an open overlay; `close` is called when back is pressed while it's on top. */
export function openOverlay(close: () => void): OverlayHandle {
  return overlays ? overlays.open(close) : noop;
}

/** Any dialog / sheet open? */
export function hasOverlay(): boolean {
  return overlays?.hasOpen() ?? false;
}

/**
 * For the router: drop open overlays' history entries, then run the navigation once history
 * has settled (synchronously when nothing is pending, which is the normal case).
 */
export function afterOverlays(fn: () => void): void {
  if (!overlays) return fn();
  overlays.unwind();
  overlays.whenSettled(fn);
}
