/**
 * "Share to Deutsch" (Android share target, see the manifest in vite.config.ts). Android opens
 * `<base>?title=…&text=…&url=…`; main.ts turns that into `#/share?term=…` and Share.svelte
 * picks a set and opens the quick-add editor with the word filled in.
 */

/** Longest phrase kept as is; longer text keeps only its first word. */
export const MAX_SHARED_PHRASE = 60;
/** More words than this isn't a "word or short phrase" any more: keep only the first word. */
const MAX_PHRASE_WORDS = 5;

// Quotes, brackets, dashes and sentence punctuation around a shared selection.
const EDGE_PUNCT = /^[\s"'`„“”‚‘’«»‹›()[\]{}<>.,;:!?¿¡…–—*_-]+|[\s"'`„“”‚‘’«»‹›()[\]{}<>.,;:!?¿¡…–—*_-]+$/g;

function clean(raw: string): string {
  const firstLine =
    raw
      .replace(/\bhttps?:\/\/\S+/gi, ' ')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.replace(EDGE_PUNCT, '')) ?? '';
  const text = firstLine.replace(/\s+/g, ' ').replace(EDGE_PUNCT, '');
  if (!text) return '';
  const words = text.split(' ');
  if (text.length <= MAX_SHARED_PHRASE && words.length <= MAX_PHRASE_WORDS) return text;
  return words[0].replace(EDGE_PUNCT, '').slice(0, MAX_SHARED_PHRASE);
}

/**
 * The word or short phrase to add from shared text: `text` first (a selection), else `title`.
 * Links are ignored, only the first non-empty line counts, surrounding quotes/punctuation are
 * stripped, and long text keeps just its first word. '' when there's nothing usable.
 */
export function extractSharedTerm(params: URLSearchParams): string {
  for (const key of ['text', 'title']) {
    const term = clean(params.get(key) ?? '');
    if (term) return term;
  }
  return '';
}

/** Does this query string come from the share target? */
export function isShareLaunch(params: URLSearchParams): boolean {
  return params.has('text') || params.has('title') || params.has('url');
}

const QUICK_ADD_SET_KEY = 'quickAddSet';

/** The set the last quick-added word went to (0 = none remembered). */
export function lastQuickAddSet(): number {
  try {
    return Number(localStorage.getItem(QUICK_ADD_SET_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function rememberQuickAddSet(setId: number): void {
  if (!setId) return;
  try {
    localStorage.setItem(QUICK_ADD_SET_KEY, String(setId));
  } catch {
    // storage blocked: shared words go to "My words"
  }
}
