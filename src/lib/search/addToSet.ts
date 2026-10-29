// "Add to set" from the quick search: pick one of the user's own sets, add one card, skip
// duplicates. Nothing is stored unless the user adds.
import { db } from '../db/schema';
import { saveCard } from '../db/repo';
import { buildCard } from '../reading/store';
import { parseGermanInput } from '../german/parseTerm';
import { reviewsFor, statusOf, type WordStatus } from '../progress';
import type { Card, Folder, Gender, WordSet } from '../types';
import type { WordFields } from './wordInfo';

/**
 * A card with this term (case-insensitive) and the same article: a card with no article, or
 * looked-up fields with no article, count as the same word; "der See" and "die See" don't.
 */
export function isSameWord(card: Pick<Card, 'term' | 'genders'>, term: string, genders: Gender[] = []): boolean {
  if (card.term.trim().toLowerCase() !== term.trim().toLowerCase()) return false;
  if (!genders.length || !card.genders?.length) return true;
  return card.genders.some((g) => genders.includes(g));
}

export function findDuplicate<C extends Pick<Card, 'term' | 'genders'>>(cards: C[], fields: WordFields): C | undefined {
  return cards.find((c) => isSameWord(c, fields.term, fields.genders ?? []));
}

/**
 * The set's card for a word being typed on the add screen (CardEditor): a typed "der Tisch"
 * counts as Tisch, m; only the whole term matches, never a prefix. While a noun's articles
 * differ in meaning (`articleCount` > 1, der See / die See) and none is picked yet, nothing is a
 * duplicate: the user may want the other article.
 */
export function quickAddDuplicate<C extends Pick<Card, 'term' | 'genders'>>(
  cards: C[],
  word: Pick<Card, 'term' | 'pos' | 'genders'>,
  articleCount = 0,
): C | undefined {
  const p = parseGermanInput(word.term);
  const term = p.term || word.term.trim();
  if (!term) return undefined;
  const pos = p.pos ?? word.pos;
  const genders = p.genders.length ? p.genders : word.genders;
  if (articleCount > 1 && !(pos === 'noun' && genders.length === 1)) return undefined;
  return findDuplicate(cards, { term, genders: pos === 'noun' ? genders : [] });
}

/**
 * Add the word to a set as one card, unless the set has it already (see isSameWord).
 * Returns the card id and whether it was created.
 */
export async function addWordToSet(setId: number, fields: WordFields): Promise<{ cardId: number; created: boolean }> {
  const existing = findDuplicate(await db.cards.where('setId').equals(setId).toArray(), fields);
  if (existing) return { cardId: existing.id!, created: false };
  const cardId = await saveCard(buildCard(setId, { ...fields, examples: (fields.examples ?? []).map((e) => ({ ...e })) }));
  return { cardId, created: true };
}

/** A set the word can go to, for the picker. */
export interface SetChoice {
  id: number;
  name: string;
  /** Folder name ('' when unfiled). */
  folder: string;
  /** The remembered quick-add set (shown first). */
  last: boolean;
}

/**
 * User sets only (level preset sets are left out), the last quick-add set first, then newest
 * first — like the "Add a word to…" picker on Today.
 */
export function orderSetChoices(sets: WordSet[], folders: Folder[], lastId: number): SetChoice[] {
  const folderName = new Map(folders.map((f) => [f.id!, f.name]));
  return sets
    .filter((s) => !s.level && s.id)
    .sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId) || b.createdAt - a.createdAt || b.id! - a.id!)
    .map((s) => ({ id: s.id!, name: s.name, folder: folderName.get(s.folderId) ?? '', last: s.id === lastId }));
}

export async function loadSetChoices(lastId: number): Promise<SetChoice[]> {
  const [sets, folders] = await Promise.all([db.sets.toArray(), db.folders.toArray()]);
  return orderSetChoices(sets, folders, lastId);
}

/** One of the user's cards for a word, with where it is and how well it's known. */
export interface OwnedCard {
  id: number;
  setId: number;
  /** The set's display name (a preset's topic, else its name). */
  setName: string;
  genders: Gender[];
  status: WordStatus;
}

const STATUS_ORDER: WordStatus[] = ['known', 'learned', 'learning', 'new'];

/** The user's cards with this term (any set, presets included), best status first. Use inside live(). */
export async function ownedCards(term: string): Promise<OwnedCard[]> {
  const t = term.trim();
  if (!t) return [];
  const cards = await db.cards.where('term').equalsIgnoreCase(t).toArray();
  if (!cards.length) return [];
  const [reviews, sets] = await Promise.all([reviewsFor(cards), db.sets.bulkGet([...new Set(cards.map((c) => c.setId))])]);
  const names = new Map(sets.filter((s): s is WordSet => !!s).map((s) => [s.id!, s.topic || s.name]));
  return cards
    .filter((c) => names.has(c.setId))
    .map((c) => ({ id: c.id!, setId: c.setId, setName: names.get(c.setId)!, genders: c.genders ?? [], status: statusOf(c, reviews.get(c.id!)) }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}
