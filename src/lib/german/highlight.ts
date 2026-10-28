import { tokenize } from '../reading/text';
import type { Card } from '../types';

/**
 * Marking a card's word in an example sentence: "Ich ging gestern ins Kino." for gehen →
 * "ging" marked. A word token is marked when it is a form of the card's word:
 * - a form the card stores (term, plural, Präteritum, Partizip II), any case;
 * - a regular form of it: the verb stem plus a short ending (geht, gehst), the noun plus a
 *   short ending (Hauses, Häusern);
 * - its dictionary lemma is the card's word (fährt → fahren, Häuser → Haus), via `lemmaOf`;
 * - for a separable verb (aufstehen) a form of the base verb together with its particle as a
 *   separate word in the same sentence ("Ich stehe um 7 Uhr auf." → stehe, auf).
 * Several-word terms ("sich freuen") mark each of their words (not sich, articles).
 */

export interface MarkedPart {
  text: string;
  hit: boolean;
}

/** Looks up the dictionary form of a word token (null when unknown). */
export type LemmaOf = (token: string) => Promise<string | null>;

type CardForms = Pick<Card, 'term' | 'pos' | 'plural' | 'praeteritum' | 'partizip2'>;

const SKIP = new Set(['sich', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'etwas', 'jemanden', 'jemandem', 'jdn', 'jdm']);

/** Separable verb prefixes, longest first. */
const PARTICLES = [
  'zurück', 'zusammen', 'weiter', 'heraus', 'herein', 'hinaus', 'hinein', 'vorbei', 'entgegen',
  'fest', 'fort', 'heim', 'hin', 'her', 'los', 'mit', 'nach', 'vor', 'weg', 'auf', 'aus', 'ein', 'an', 'ab', 'bei', 'zu',
];

const lower = (s: string) => s.toLocaleLowerCase('de');

/** "gehen" → "geh", "sammeln" → "samml" (≥ 3 letters), else ''. */
function verbStem(verb: string): string {
  const stem = verb.endsWith('en') ? verb.slice(0, -2) : verb.endsWith('n') ? verb.slice(0, -1) : '';
  return stem.length >= 3 ? stem : '';
}

/** Lower-case words of the card that should be found in sentences. */
function headWords(card: CardForms): string[] {
  return card.term
    .split(/\s+/)
    .map((w) => lower(w.replace(/[^\p{L}-]/gu, '')))
    .filter((w) => w.length > 1 && !SKIP.has(w));
}

/** Regular endings after a verb stem (geh-t), a noun (Haus-es) and an adjective (schön-sten). */
const VERB_ENDINGS = new Set(['e', 'st', 't', 'en', 'et', 'est', 'te', 'ten', 'tet', 'test', 'tes', 'ete', 'eten', 'etest', 'end']);
const NOUN_ENDINGS = new Set(['s', 'es', 'n', 'en', 'e', 'ns']);
const ADJ_ENDINGS = new Set(['e', 'en', 'em', 'er', 'es', 'ere', 'eren', 'erem', 'erer', 'eres', 'ste', 'sten', 'stem', 'ster', 'stes', 'este', 'esten']);

/** `token` is `base` plus one of `endings`. */
const withEnding = (token: string, base: string, endings: Set<string>) =>
  !!base && token.startsWith(base) && endings.has(token.slice(base.length));

/** Sync test: is `token` (lower-case) a stored or regular form of `word`? */
function isFormOf(token: string, word: string, card: CardForms, stored: Set<string>): boolean {
  if (stored.has(token) || token === word) return true;
  if (card.pos === 'verb') return withEnding(token, verbStem(word), VERB_ENDINGS);
  if (card.pos === 'noun') return withEnding(token, word, NOUN_ENDINGS);
  return word.length >= 3 && withEnding(token, word, ADJ_ENDINGS);
}

export async function markExample(sentence: string, card: CardForms, lemmaOf?: LemmaOf): Promise<MarkedPart[]> {
  const tokens = tokenize(sentence);
  const words = headWords(card);
  const stored = new Set([card.plural, card.praeteritum, card.partizip2].map((f) => lower(f.trim())).filter(Boolean));
  const termLower = lower(card.term.trim());
  const hits = new Set<number>();

  const lemmaHit = async (token: string, targets: string[]) => {
    if (!lemmaOf) return false;
    try {
      const l = await lemmaOf(token);
      return !!l && targets.includes(lower(l));
    } catch {
      return false;
    }
  };

  // Separable verb: base verb + particle ("aufstehen" → stehen + auf).
  const particle = card.pos === 'verb' && words.length === 1 ? PARTICLES.find((p) => termLower.startsWith(p) && termLower.length - p.length >= 4) : undefined;
  const base = particle ? termLower.slice(particle.length) : '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.word) continue;
    const tl = lower(t.text);
    if (words.some((w) => isFormOf(tl, w, card, stored)) || (await lemmaHit(t.text, [termLower, ...words]))) {
      hits.add(i);
    }
  }

  if (particle && base && !tokens.some((_, i) => hits.has(i))) {
    // Split form: a form of the base verb and the particle standing alone in the same sentence.
    const baseForms = new Set<number>();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t.word) continue;
      const tl = lower(t.text);
      if (isFormOf(tl, base, { ...card, plural: '', praeteritum: '', partizip2: '' }, new Set()) || (await lemmaHit(t.text, [base]))) {
        baseForms.add(i);
      }
    }
    const particles = tokens.flatMap((t, i) => (t.word && lower(t.text) === particle ? [i] : []));
    if (baseForms.size && particles.length) {
      for (const i of baseForms) hits.add(i);
      for (const i of particles) hits.add(i);
    }
  }

  // Merge into parts: marked words and the text between them.
  const parts: MarkedPart[] = [];
  tokens.forEach((t, i) => {
    const hit = hits.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit && !hit) last.text += t.text;
    else parts.push({ text: t.text, hit });
  });
  return parts;
}
