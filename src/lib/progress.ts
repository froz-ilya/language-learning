import { db } from './db/schema';
import type { Card, Review } from './types';

/**
 * Word status:
 *   new      — never studied
 *   learning — studied, not yet retained long-term
 *   learned  — FSRS stability ≥ LEARNED_STABILITY_DAYS (remembered for weeks)
 *   known    — marked "I know this" manually; skipped in sessions
 */
export type WordStatus = 'new' | 'learning' | 'learned' | 'known';

export const LEARNED_STABILITY_DAYS = 21;

export const STATUS_LABELS: Record<WordStatus, string> = {
  new: 'New',
  learning: 'Learning',
  learned: 'Learned',
  known: 'Known',
};

export function statusOf(card: Pick<Card, 'known'>, review: Review | undefined): WordStatus {
  if (card.known) return 'known';
  if (!review || review.fsrs.reps === 0) return 'new';
  return review.fsrs.stability >= LEARNED_STABILITY_DAYS ? 'learned' : 'learning';
}

export interface Progress {
  total: number;
  new: number;
  learning: number;
  learned: number;
  known: number;
  /** learned + known */
  done: number;
  /** done / total, 0…1 */
  ratio: number;
}

export function emptyProgress(): Progress {
  return { total: 0, new: 0, learning: 0, learned: 0, known: 0, done: 0, ratio: 0 };
}

export function progressOf(cards: Card[], reviews: Map<number, Review>): Progress {
  const p = emptyProgress();
  for (const c of cards) p[statusOf(c, reviews.get(c.id!))]++;
  p.total = cards.length;
  p.done = p.learned + p.known;
  p.ratio = p.total ? p.done / p.total : 0;
  return p;
}

export async function reviewsFor(cards: Card[]): Promise<Map<number, Review>> {
  const ids = cards.map((c) => c.id!);
  const reviews = await db.reviews.bulkGet(ids);
  const map = new Map<number, Review>();
  reviews.forEach((r) => r && map.set(r.cardId, r));
  return map;
}

/** Progress of a list of cards (use inside live() so it updates as you study). */
export async function progressFor(cards: Card[]): Promise<Progress> {
  return progressOf(cards, await reviewsFor(cards));
}

/** Progress per set id, for all given sets, in one pass. */
export async function progressBySet(setIds: number[]): Promise<Map<number, Progress>> {
  const cards = await db.cards.where('setId').anyOf(setIds).toArray();
  const reviews = await reviewsFor(cards);
  const bySet = new Map<number, Card[]>();
  for (const c of cards) bySet.set(c.setId, [...(bySet.get(c.setId) ?? []), c]);
  return new Map(setIds.map((id) => [id, progressOf(bySet.get(id) ?? [], reviews)]));
}

/**
 * Mark words known / not known.
 * known=true: skipped in sessions, counts as done.
 * known=false ("not learned"): also resets their study progress, so they come back as new.
 */
export async function setKnown(cardIds: number[], known: boolean): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.where('id').anyOf(cardIds).modify({ known: known ? 1 : 0 });
    if (!known) await db.reviews.bulkDelete(cardIds);
  });
}
