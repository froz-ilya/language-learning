import type { Card } from '../types';
import type { Rng } from './session';
import { sourceOrder } from './smart';

/** Share of sampled words you must know to be offered "Mark whole level as known". */
export const PLACEMENT_PASS = 0.85;
export const PLACEMENT_SIZE = 20;

/**
 * `n` items spread evenly over `items` (which are in frequency order): one random pick from
 * each of n equal buckets, so common and rare words are both represented.
 */
export function spreadSample<T>(items: readonly T[], n: number, rng: Rng = Math.random): T[] {
  if (items.length <= n) return items.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * items.length) / n);
    const hi = Math.floor(((i + 1) * items.length) / n);
    out.push(items[lo + Math.floor(rng() * (hi - lo))]);
  }
  return out;
}

/** Placement words for a level: askable cards in frequency order, spread-sampled. */
export function placementSample(cards: readonly Card[], n = PLACEMENT_SIZE, rng: Rng = Math.random): Card[] {
  const usable = cards.filter((c) => c.term.trim() && c.translation.trim()).sort(sourceOrder);
  return spreadSample(usable, n, rng);
}

export function placementPassed(known: number, total: number): boolean {
  return total > 0 && known / total >= PLACEMENT_PASS;
}
