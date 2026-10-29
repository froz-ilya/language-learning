/**
 * Opening the on-screen keyboard on a page that isn't shown yet. iOS only opens it for a focus()
 * made during the tap itself, and the next page's field mounts later. So the tap focuses a hidden
 * stand-in field (keyboard up), and the page moves focus to its real field with takeKeyboard();
 * iOS keeps the keyboard open when focus moves between fields.
 */

let bridge: HTMLInputElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function dropBridge() {
  clearTimeout(timer);
  bridge?.remove();
  bridge = null;
}

/** Call synchronously in the tap handler that opens a page with a text field. */
export function primeKeyboard(): void {
  if (typeof document === 'undefined') return;
  dropBridge();
  const el = document.createElement('input');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  // 16px so iOS doesn't zoom in; kept on screen (off-screen fields don't open the keyboard).
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;';
  document.body.appendChild(el);
  el.focus({ preventScroll: true });
  bridge = el;
  // Nothing took the keyboard (navigation cancelled): let it go down again.
  timer = setTimeout(dropBridge, 1500);
}

/** Focus the page's real field, taking over the keyboard opened by primeKeyboard(). */
export function takeKeyboard(input: HTMLInputElement | undefined): void {
  input?.focus({ preventScroll: true });
  dropBridge();
}

/** Let the keyboard opened by primeKeyboard() go down, e.g. when a sheet opens instead of the page. */
export function releaseKeyboard(): void {
  bridge?.blur();
  dropBridge();
}
