import { db } from '../db/schema';
import { lemmatize } from '../dict/local';
import type { LexEntry } from '../dict/types';
import { reviewsFor, statusOf, type WordStatus } from '../progress';
import type { Token } from './text';

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

/** Lemma entries for every distinct word token (keyed by the token as written). */
export async function lemmaMap(paragraphs: Token[][]): Promise<Map<string, LexEntry | null>> {
  const words = new Set<string>();
  for (const tokens of paragraphs) for (const t of tokens) if (t.word) words.add(t.text);
  const out = new Map<string, LexEntry | null>();
  const list = [...words];
  // Small batches: lemmatize() loads dictionary pieces lazily.
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40);
    const entries = await Promise.all(batch.map((w) => lemmatize(w).catch(() => null)));
    batch.forEach((w, j) => out.set(w, entries[j]));
  }
  return out;
}

/** The lemma a token stands for (dictionary form, or the token itself when unknown). */
export function lemmaOf(token: string, lemmas: Map<string, LexEntry | null>): string {
  return lemmas.get(token)?.term ?? token;
}

/** Cards matching a token: by its lemma, else by the token as written (case-insensitive). */
export function cardsFor(token: string, lemmas: Map<string, LexEntry | null>, vocab: Map<string, CardRef[]>): CardRef[] {
  return vocab.get(lemmaOf(token, lemmas).toLowerCase()) ?? vocab.get(token.toLowerCase()) ?? [];
}
