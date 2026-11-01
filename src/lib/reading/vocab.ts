import { db } from '../db/schema';
import type { LexEntry } from '../dict/types';
import { withSich } from '../german/reflexive';
import { reviewsFor, statusOf, type WordStatus } from '../progress';
export { lemmaMap } from './rate';

/** A card the user has, as far as the reader cares. */
export interface CardRef {
  id: number;
  setId: number;
  term: string;
  status: WordStatus;
}

const STATUS_ORDER: WordStatus[] = ['known', 'learned', 'learning', 'new'];

/** All cards by lower-cased term (best status first). Use inside live() so it stays current. */
export async function loadVocab(): Promise<Map<string, CardRef[]>> {
  const cards = await db.cards.toArray();
  const reviews = await reviewsFor(cards);
  const map = new Map<string, CardRef[]>();
  for (const c of cards) {
    const key = c.term.trim().toLowerCase();
    if (!key) continue;
    const ref: CardRef = { id: c.id!, setId: c.setId, term: c.term, status: statusOf(c, reviews.get(c.id!)) };
    const list = map.get(key);
    if (list) list.push(ref);
    else map.set(key, [ref]);
  }
  for (const list of map.values()) list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return map;
}

/** The lemma a token stands for (dictionary form, or the token itself when unknown). */
export function lemmaOf(token: string, lemmas: Map<string, LexEntry | null>): string {
  return lemmas.get(token)?.term ?? token;
}

/**
 * Cards matching a token: by its lemma (for a verb used only with "sich", also its "sich …"
 * card), else by the token as written (case-insensitive).
 */
export function cardsFor(token: string, lemmas: Map<string, LexEntry | null>, vocab: Map<string, CardRef[]>): CardRef[] {
  return cardsOfReading(token, lemmas.get(token), vocab);
}

/** Cards matching a token read as `e` (see cardsFor; for the reading of a word at its position). */
export function cardsOfReading(token: string, e: LexEntry | null | undefined, vocab: Map<string, CardRef[]>): CardRef[] {
  const lemma = (e?.term ?? token).toLowerCase();
  return (
    vocab.get(lemma) ??
    (e?.reflexive === 'only' ? vocab.get(withSich(lemma)) : undefined) ??
    vocab.get(token.toLowerCase()) ??
    []
  );
}

/** Cards for a dictionary entry itself (a split verb's anrufen, "sich treffen"), not via the text's lemmas. */
export const cardsOfTerm = (term: string, vocab: Map<string, CardRef[]> | undefined): CardRef[] =>
  vocab?.get(term.trim().toLowerCase()) ?? [];

/** Both lists, each card once. */
export const mergeCards = (a: CardRef[], b: CardRef[]): CardRef[] => [...a, ...b.filter((c) => !a.some((x) => x.id === c.id))];
