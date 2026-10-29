import type { Auxiliary, Gender, Pos } from '../types';
import { GENDER_OF_ARTICLE } from './articles';
import { baseOfReflexive, isReflexiveTerm, withSich } from './reflexive';

export interface ParsedTerm {
  /** The word as a card stores it: no article; a reflexive verb keeps "sich" ("sich treffen"). */
  term: string;
  /**
   * "sich treffen": a reflexive verb. `term` keeps "sich"; dictionaries are asked for the verb
   * (baseOfReflexive(term)). Only for "sich" + one word, not "sich Sorgen machen".
   */
  reflexive?: true;
  pos?: Pos;
  genders: Gender[];
  plural?: string;
  praeteritum?: string;
  partizip2?: string;
  auxiliary?: Auxiliary;
}

/** "Haus" → "Häus", "Mutter" → "Mütter": umlaut on the stem's last a / o / u / au (an -er/-el/-en/-e ending is skipped). */
function umlaut(word: string): string {
  const ending = word.match(/(?:er|el|en|e)$/)?.[0] ?? '';
  const stem = word.slice(0, word.length - ending.length);
  const m = stem.match(/^(.*?)(au|Au|a|o|u|A|O|U)([^aeiouäöüAEIOUÄÖÜ]*)$/);
  if (!m) return word;
  const map: Record<string, string> = { au: 'äu', a: 'ä', o: 'ö', u: 'ü', Au: 'Äu', A: 'Ä', O: 'Ö', U: 'Ü' };
  return m[1] + map[m[2]] + m[3] + ending;
}

/**
 * The plural part after the noun, in the styles word lists use:
 *   "die Häuser" / "Häuser"        → Häuser
 *   "-en" / "en" / "-n" / "-e" …   → noun + ending (Handlung, en → Handlungen)
 *   "-¨er" / "¨e" / "-¨"           → umlauted noun + ending (Haus, -¨er → Häuser)
 *   "-"                            → same as the singular (Lehrer, - → Lehrer)
 * Anything else (several words, notes) is not a plural.
 */
function pluralOf(noun: string, part: string): string | undefined {
  const p = part.replace(/^\(|\)$/g, '').trim();
  if (!p) return undefined;
  const full = p.match(/^(?:die\s+)?(\p{Lu}[\p{L}-]*)$/u);
  if (full) return full[1];
  const short = p.match(/^-?\s*(¨|")?\s*(e|en|n|er|s|nen|se)?$/);
  if (short && (short[1] || short[2] || p === '-')) return (short[1] ? umlaut(noun) : noun) + (short[2] ?? '');
  return undefined;
}

/**
 * Understands what people type into a German term field (and what Quizlet sets usually contain):
 *   "der Tisch"                   → noun, m
 *   "der/das Teil"                → noun, m+n
 *   "das Haus, die Häuser"        → noun, n, plural Häuser (also "Häuser", "-¨er", "en": see pluralOf)
 *   "gehen, ging, ist gegangen"   → verb with forms
 *   "sich treffen"                → term "sich treffen", reflexive (also with verb forms)
 *   "gehen"                       → term only
 */
export function parseGermanInput(raw: string): ParsedTerm {
  const p = parseTerm(raw);
  const base = baseOfReflexive(p.term);
  // "Sich treffen" → "sich treffen"; one verb after "sich", not a phrase.
  return isReflexiveTerm(p.term) && p.pos !== 'noun' && /^\S+$/.test(base) ? { ...p, term: withSich(base), reflexive: true } : p;
}

function parseTerm(raw: string): ParsedTerm {
  const text = raw.trim().replace(/\s+/g, ' ');

  const article = text.match(/^((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)\s+(.+)$/i);
  if (article) {
    const genders = [...new Set(article[1].toLowerCase().split('/').map((a) => GENDER_OF_ARTICLE[a.trim()]))];
    const [noun, ...rest] = article[2].split(',').map((s) => s.trim());
    const term = noun.replace(/\s*\(.*\)$/, '');
    return { term, pos: 'noun', genders, plural: pluralOf(term, rest.join(',').trim()) };
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
