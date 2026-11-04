import { runChain } from '../sources/chain';
import { tatoebaExamples, type ExamplePair } from '../sources/providers/tatoeba';
import type { TranslateLang } from './translate';

export type { ExamplePair } from '../sources/providers/tatoeba';

/**
 * Example sentences for the translator: how people actually say it, from Tatoeba. Asked only for
 * a word or a short phrase (a whole sentence is never in it word for word), never for German
 * into German, and once per text (in-memory cache, like the translations).
 */
export const EXAMPLES_MAX_WORDS = 4;
const LIMIT = 5;
const CACHE_MAX = 50;
const cache = new Map<string, ExamplePair[]>();

/** Whether `text` is short enough to look for examples of. */
export function wantsExamples(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= EXAMPLES_MAX_WORDS && text.trim().length <= 80;
}

/** Forget every cached result (tests). */
export function clearExamplesCache(): void {
  cache.clear();
}

/**
 * Sentence pairs with `text` in `from` and a translation into `to`; [] when there are none or
 * Tatoeba can't be reached (it's extra, so a failure shows nothing rather than an error).
 * An abort rejects with an AbortError.
 */
export async function findExamples(text: string, from: TranslateLang, to: TranslateLang, signal?: AbortSignal): Promise<ExamplePair[]> {
  const q = text.trim().replace(/\s+/g, ' ');
  if (!wantsExamples(q) || from === to) return [];
  const key = `${from}|${to}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit.map((p) => ({ ...p }));
  const r = await runChain('examples', [tatoebaExamples], { text: q, from, to, limit: LIMIT }, signal);
  const pairs = r?.value ?? [];
  // A miss because Tatoeba failed isn't kept: the next try may get an answer.
  if (r) {
    cache.set(key, pairs);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return pairs.map((p) => ({ ...p }));
}
