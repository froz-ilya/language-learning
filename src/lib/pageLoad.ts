/**
 * Pages read IndexedDB as they mount, so a new page first renders without its data. The router
 * holds the page transition for a moment until those reads finish, which lets the page arrive
 * complete instead of as a skeleton that blocks then pop into.
 *
 *   const entry = beginPage();
 *   …mount the page…
 *   await pageLoaded();
 *   …flush the DOM…
 *   endPage(entry);
 *
 * While a page is arriving its blocks skip their entrance animation: the page transition is the
 * motion (see enter() in motion.ts). Reads that outlast LOAD_BUDGET_MS animate in as usual.
 */

/** Longest a navigation waits for data. Short enough to still feel immediate. */
export const LOAD_BUDGET_MS = 150;

const pending = new Set<object>();
let wake: (() => void) | undefined;
let entry = 0;
let arriving = false;

/** A read started. Call the returned function when it ends (safe to call more than once). */
export function trackLoad(): () => void {
  const read = {};
  pending.add(read);
  return () => {
    pending.delete(read);
    if (!pending.size) wake?.();
  };
}

/** A navigation starts; reads of the page before it no longer matter. */
export function beginPage(): number {
  pending.clear();
  wake?.();
  arriving = true;
  return ++entry;
}

/** Resolves when the page's reads have finished, or after `budget` ms. */
export function pageLoaded(budget = LOAD_BUDGET_MS): Promise<void> {
  if (!pending.size) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (wake === finish) wake = undefined;
      resolve();
    };
    const timer = setTimeout(finish, budget);
    wake = finish;
  });
}

/** The page is on screen. False when a newer navigation has taken over. */
export function endPage(id: number): boolean {
  if (id !== entry) return false;
  arriving = false;
  return true;
}

/** A page is on its way in, so its blocks shouldn't animate on their own. */
export function pageArriving(): boolean {
  return arriving;
}
