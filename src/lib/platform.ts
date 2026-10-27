/**
 * Platform detection, for the few places where iOS and Android must behave differently
 * (edge-swipe back, install hints, vibration, voice tips). Every check takes an optional
 * navigator-like object so tests can stub it.
 */

export interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  /** iOS Safari: true when running as a home-screen web app. */
  standalone?: boolean;
  vibrate?: unknown;
  userAgentData?: { platform?: string; mobile?: boolean } | null;
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined;
}

/** iPhone, iPod or iPad (iPadOS reports a Mac user agent, but has a touch screen). */
export function isIOS(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export function isAndroid(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  if (/android/i.test(nav.userAgentData?.platform ?? '')) return true;
  return /Android/i.test(nav.userAgent ?? '');
}

/** Running as an installed app (home-screen web app on iOS, installed PWA elsewhere). */
export function isStandalone(
  nav: NavigatorLike | undefined = currentNavigator(),
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window !== 'undefined'
    ? window.matchMedia?.bind(window)
    : undefined,
): boolean {
  if (nav?.standalone === true) return true;
  try {
    return !!matchMedia?.('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * The Vibration API works (Android browsers). Desktop Chrome exposes navigator.vibrate too but
 * has nothing to vibrate, and iOS has no API at all, so this is Android only.
 */
export function canVibrate(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  return !!nav && typeof nav.vibrate === 'function' && isAndroid(nav);
}
