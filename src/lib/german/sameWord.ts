import type { Card, Gender, Pos } from '../types';

/** "Sich  Treffen " → "sich treffen": the term as words are compared. */
const termKey = (term: string) => term.trim().replace(/\s+/g, ' ').toLowerCase();

/** Parts of speech differ only when both are known: a card still 'other' can be any reading. */
const samePos = (a?: Pos, b?: Pos) => !a || !b || a === 'other' || b === 'other' || a === b;

/**
 * A card with this term (case-insensitive), part of speech and article: a card with no article,
 * or looked-up fields with no article, count as the same word; "der See" and "die See" don't,
 * nor do "das Treffen" and "treffen". A reflexive verb is its own word: "sich treffen" is not
 * "treffen".
 */
export function isSameWord(card: Pick<Card, 'term' | 'genders'> & { pos?: Pos }, term: string, genders: Gender[] = [], pos?: Pos): boolean {
  if (termKey(card.term) !== termKey(term) || !samePos(card.pos, pos)) return false;
  if (!genders.length || !card.genders?.length) return true;
  return card.genders.some((g) => genders.includes(g));
}
