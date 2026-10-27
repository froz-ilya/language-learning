import type { Card, Gender } from '../types';

export const ARTICLE: Record<Gender, string> = { m: 'der', f: 'die', n: 'das' };
export const GENDER_OF_ARTICLE: Record<string, Gender> = { der: 'm', die: 'f', das: 'n' };

export function articleOf(genders: Gender[]): string {
  return genders.map((g) => ARTICLE[g]).join('/');
}

/** "der Tisch", "der/das Teil", "gehen" */
export function displayTerm(card: Pick<Card, 'term' | 'pos' | 'genders'>): string {
  if (card.pos === 'noun' && card.genders.length) return `${articleOf(card.genders)} ${card.term}`;
  return card.term;
}

/** "die Häuser" (plural nouns always take "die"). */
export function displayPlural(card: Pick<Card, 'plural'>): string {
  return card.plural ? `die ${card.plural}` : '';
}

/** "ging – ist gegangen" */
export function displayVerbForms(card: Pick<Card, 'praeteritum' | 'partizip2' | 'auxiliary'>): string {
  const perfekt = card.partizip2 ? `${card.auxiliary === 'sein' ? 'ist' : card.auxiliary === 'haben' ? 'hat' : ''} ${card.partizip2}`.trim() : '';
  return [card.praeteritum, perfekt].filter(Boolean).join(' – ');
}

/** Text for text-to-speech: article + noun so the gender is heard too. */
export function speakableTerm(card: Pick<Card, 'term' | 'pos' | 'genders'>): string {
  if (card.pos === 'noun' && card.genders.length) return `${ARTICLE[card.genders[0]]} ${card.term}`;
  return card.term;
}

/**
 * Candidate head nouns of a compound, longest first:
 * "Hausschlüssel" → ["Ausschlüssel", "Usschlüssel", …, "Schlüssel", …]. Minimum 3 letters.
 */
export function compoundHeads(word: string): string[] {
  const heads: string[] = [];
  for (let i = 1; i <= word.length - 3; i++) {
    const rest = word.slice(i);
    heads.push(rest[0].toUpperCase() + rest.slice(1));
  }
  return heads;
}

/** Build the compound's plural from the head's: ("Hausschlüssel", "Schlüssel", "Schlüssel") → "Hausschlüssel". */
export function compoundPlural(word: string, head: string, headPlural: string): string {
  if (!headPlural) return '';
  const prefix = word.slice(0, word.length - head.length);
  return prefix + headPlural.toLowerCase();
}
