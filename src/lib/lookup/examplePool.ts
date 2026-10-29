/**
 * Which of a lookup's examples a new card gets, given the meanings the user kept (Add word's
 * meaning chips). Pure, so CardEditor stays about state and the rules are testable.
 */
import type { Example } from '../types';

/** Sentence examples a card gets from a lookup (its set phrases come on top, see withPhrases). */
export const CARD_EXAMPLES = 3;
/** Examples a card gets in all, phrases included. */
export const CARD_EXAMPLES_WITH_PHRASES = 4;

const key = (e: Example) => e.de.trim().replace(/\s+/g, ' ').toLowerCase();

/** Round-robin over lists: the first of each, then the second of each, … */
function interleave(lists: Example[][]): Example[] {
  const out: Example[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let n = 0; n < longest; n++) for (const l of lists) if (n < l.length) out.push(l[n]);
  return out;
}

/**
 * Every candidate example, best first: those of the picked meanings (one per meaning in turn, in
 * meaning order), then those of the other meanings, then any other of `examples`. No blanks or
 * duplicates. `picked` is aligned with `meaningExamples`; when it isn't (no chips, a hand-typed
 * translation) or picks nothing, all meanings count as picked.
 */
export function examplePool(meaningExamples: Example[][] | undefined, picked: boolean[], examples: Example[]): Example[] {
  const byMeaning = meaningExamples ?? [];
  const usePicks = picked.length === byMeaning.length && picked.some(Boolean);
  const isPicked = (i: number) => !usePicks || picked[i];
  const ordered = [
    ...interleave(byMeaning.filter((_, i) => isPicked(i))),
    ...interleave(byMeaning.filter((_, i) => !isPicked(i))),
    ...examples,
  ];
  const seen = new Set<string>();
  const out: Example[] = [];
  for (const e of ordered) {
    const k = key(e);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ de: e.de, tr: e.tr ?? '' });
  }
  return out;
}

/** The card's examples with pool[shown] first, then the rest of the pool in order, capped. */
export function arrangeExamples(pool: Example[], shown = 0, cap = CARD_EXAMPLES): Example[] {
  const first = pool[shown];
  const rest = pool.filter((_, i) => i !== shown);
  return (first ? [first, ...rest] : rest).slice(0, cap).map((e) => ({ de: e.de, tr: e.tr ?? '' }));
}

/** The phrases that fit after `examples` (up to `cap` in all), skipping blanks and duplicates. */
export function phrasesToAdd(examples: Example[], phrases: Example[] | undefined, cap = CARD_EXAMPLES_WITH_PHRASES): Example[] {
  const seen = new Set(examples.map(key));
  const out: Example[] = [];
  for (const p of phrases ?? []) {
    if (examples.length + out.length >= cap) break;
    const k = key(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ de: p.de.trim(), tr: (p.tr ?? '').trim() });
  }
  return out;
}
