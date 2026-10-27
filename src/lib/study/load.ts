import { db } from '../db/schema';
import type { Card, Review } from '../types';

/** Reviews of the given cards, keyed by card id (cards never studied are missing). */
export async function loadReviews(cards: Card[]): Promise<Map<number, Review>> {
  const ids = cards.map((c) => c.id).filter((id): id is number => id != null);
  const rows = await db.reviews.bulkGet(ids);
  const map = new Map<number, Review>();
  for (const r of rows) if (r) map.set(r.cardId, r);
  return map;
}

/**
 * Cards to draw multiple-choice distractors from: the source's own cards, topped up with the
 * whole collection when the source is too small for 4 options.
 */
export async function distractorPool(sourceCards: Card[], min = 8): Promise<Card[]> {
  if (sourceCards.length >= min) return sourceCards;
  const ids = new Set(sourceCards.map((c) => c.id));
  const others = (await db.cards.limit(500).toArray()).filter((c) => !ids.has(c.id));
  return [...sourceCards, ...others];
}
