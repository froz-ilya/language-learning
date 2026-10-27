import { isIOS, isStandalone } from './platform';

/**
 * "Install app" support. Chrome (Android and desktop) fires `beforeinstallprompt` when the app
 * can be installed; we keep the event and show our own Install button (Settings, Today banner)
 * instead of Chrome's mini-infobar. iOS has no such event: there we show a hint instead
 * (Share → Add to Home Screen) while the app runs in Safari.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export const install = $state({
  /** The browser offered installation and we can show its prompt. */
  canInstall: false,
});

let deferred: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    install.canInstall = true;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    install.canInstall = false;
  });
}

/** iOS in Safari (not yet on the home screen): show the Add to Home Screen hint. */
export function showIOSInstallHint(): boolean {
  return isIOS() && !isStandalone();
}

/** Show the browser's install prompt. Resolves to the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  // The event can only be used once.
  deferred = null;
  install.canInstall = false;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  } catch {
    return 'unavailable';
  }
}

const BANNER_KEY = 'installBannerDismissed';

export function installBannerDismissed(): boolean {
  try {
    return localStorage.getItem(BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallBanner(): void {
  try {
    localStorage.setItem(BANNER_KEY, '1');
  } catch {
    // private mode / blocked storage: it just shows again next launch
  }
}
