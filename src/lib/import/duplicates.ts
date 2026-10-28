import type { Card } from '../types';
import { isSameWord } from '../search/addToSet';
import type { ImportRow } from './parse';

/** Why a pasted row is skipped: it repeats an earlier row, or the set already has the word. */
export type Duplicate = 'paste' | 'set';

/**
 * Duplicate marks for pasted rows (null = import it). A row is a duplicate when its German term
 * (case-insensitive, after parsing) matches an earlier row or a card already in the target set;
 * nouns with different typed articles ("der See" / "die See") are different words, a row
 * without an article matches any article (same rule as "Add to set", see isSameWord).
 * The first occurrence is kept.
 */
export function markDuplicates(rows: ImportRow[], existing: Pick<Card, 'term' | 'genders'>[] = []): (Duplicate | null)[] {
  const kept: Pick<Card, 'term' | 'genders'>[] = [];
  return rows.map((r) => {
    const { term, genders } = r.parsed;
    if (existing.some((c) => isSameWord(c, term, genders))) return 'set';
    if (kept.some((c) => isSameWord(c, term, genders))) return 'paste';
    kept.push({ term, genders });
    return null;
  });
}
