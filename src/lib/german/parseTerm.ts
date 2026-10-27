import type { Auxiliary, Gender, Pos } from '../types';
import { GENDER_OF_ARTICLE } from './articles';

export interface ParsedTerm {
  term: string;
  pos?: Pos;
  genders: Gender[];
  plural?: string;
  praeteritum?: string;
  partizip2?: string;
  auxiliary?: Auxiliary;
}

/**
 * Understands what people type into a German term field (and what Quizlet sets usually contain):
 *   "der Tisch"                   → noun, m
 *   "der/das Teil"                → noun, m+n
 *   "das Haus, die Häuser"        → noun, n, plural Häuser
 *   "das Haus, -¨er" / "(-e)"     → noun, n (plural shorthand kept as typed is not reliable, ignored)
 *   "gehen, ging, ist gegangen"   → verb with forms
 *   "gehen"                       → term only
 */
export function parseGermanInput(raw: string): ParsedTerm {
  const text = raw.trim().replace(/\s+/g, ' ');

  const article = text.match(/^((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)\s+(.+)$/i);
  if (article) {
    const genders = [...new Set(article[1].toLowerCase().split('/').map((a) => GENDER_OF_ARTICLE[a.trim()]))];
    const [noun, ...rest] = article[2].split(',').map((s) => s.trim());
    const pluralPart = rest.join(',').trim();
    const pluralMatch = pluralPart.match(/^die\s+(\S.*)$/i);
    return {
      term: noun.replace(/\s*\(.*\)$/, ''),
      pos: 'noun',
      genders,
      plural: pluralMatch ? pluralMatch[1] : undefined,
    };
  }

  const parts = text.split(',').map((s) => s.trim());
  if (parts.length === 3) {
    const perfekt = parts[2].match(/^(ist|hat|sein|haben)\s+(\S+)$/i);
    if (perfekt) {
      const aux = perfekt[1].toLowerCase();
      return {
        term: parts[0],
        pos: 'verb',
        genders: [],
        praeteritum: parts[1],
        partizip2: perfekt[2],
        auxiliary: aux === 'ist' || aux === 'sein' ? 'sein' : 'haben',
      };
    }
  }

  return { term: text, genders: [] };
}
