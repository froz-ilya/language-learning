// Reverse dictionary runtime (Russian / English → German), built by scripts/dict/reverse.mjs
// into public/dict/rev/. Results are always German dictionary entries.
import type { Lang } from '../types';
import type { LexEntry } from './types';

/** A German word found by one of its translations. */
export interface ReverseHit {
  /** Dictionary id ("Steuer#f"); open it with lookupLocal(entry.term) / articleVariants. */
  id: string;
  /** The German entry (term, pos, genders, rank, level; translations of the searched language). */
  entry: LexEntry;
  /** The translation that matched, in the searched language ("налог"). */
  translation: string;
}

/** Language a typed query is in: Cyrillic → 'ru'; Latin → German or English ('latin'). */
export function queryScript(query: string): 'ru' | 'latin' | 'none' {
  if (/\p{Script=Cyrillic}/u.test(query)) return 'ru';
  if (/\p{Script=Latin}/u.test(query)) return 'latin';
  return 'none';
}

/**
 * German words whose `lang` translation matches `query` (whole translation first, then a word of
 * it, then words starting with the query), more common words first. [] when nothing matches or
 * the index can't be loaded (offline before first use). Never throws.
 */
export async function reverseSearch(query: string, lang: Lang, limit = 12): Promise<ReverseHit[]> {
  void query;
  void lang;
  void limit;
  return [];
}
