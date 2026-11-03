import { lemmatize, lookupLocal } from '../../lib/dict/local';
import type { LexEntry } from '../../lib/dict/types';

/**
 * Tappable nouns in grammar sentences: an ending depends on the noun's gender, so a tap on a noun
 * shows its article (der, die, das), plural and meaning. Looked up in the offline dictionary.
 */

/** The noun whose sheet is open; null when closed. One sheet per page, see NounSheet.svelte. */
export const nounSheet = $state<{ entry: LexEntry | null; written: string }>({ entry: null, written: '' });

export function openNoun(entry: LexEntry, written: string) {
  nounSheet.entry = entry;
  nounSheet.written = written;
}

/** A word as it stands in text: letters, with a hyphen inside ("E-Mail"). */
export const WORD = /[\p{L}]+(?:-[\p{L}]+)*/gu;

const cache = new Map<string, Promise<LexEntry | null>>();

/**
 * The noun a capitalised word of a sentence stands for ("Kindern" → das Kind), or null: not
 * capitalised, not a noun, or not in the dictionary. At the start of a sentence (`first`) a
 * capital proves nothing, so the word counts only when the dictionary has no other reading of
 * it: "Kaffee" is a noun there, "Trotz" (trotz) and "Heißer" are not.
 */
export function nounOf(word: string, first = false): Promise<LexEntry | null> {
  if (!/^\p{Lu}/u.test(word)) return Promise.resolve(null);
  const key = `${first ? '^' : ''}${word}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const entry = await lemmatize(word);
      if (entry?.pos !== 'noun') return null;
      if (first && (await lookupLocal(word.toLowerCase())).some((h) => h.entry.pos !== 'noun')) return null;
      return entry;
    })().catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}
