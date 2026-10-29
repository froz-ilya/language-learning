import { formHits, reflexivePronounAt } from '../german/highlight';
import { isReflexiveTerm, REFLEXIVE_PRONOUNS } from '../german/reflexive';
import { tokenize } from '../reading/text';
import type { Card, Example } from '../types';
import { shuffle, type Rng } from './session';

/**
 * "Reflexive pronouns" mode: an example sentence of a reflexive verb with its pronoun blanked
 * ("Ich freue ___ auf dich."), pick mich / mir / sich / … Pure, unit tested in pronouns.test.ts.
 *
 * A card qualifies when it has an example with the pronoun as a whole word and either its term
 * is reflexive ("sich freuen") or it is a verb (level words keep the bare "freuen") whose
 * example has a pronoun agreeing with the subject next to a form of the verb ("Ich freue mich").
 */

export interface PronounQuestion {
  example: Example;
  /** The sentence before and after the blank. */
  before: string;
  after: string;
  /** The pronoun as written in the sentence ("mich", "Sich"). */
  text: string;
  /** Lower-case: the answer ("mich"). */
  pronoun: string;
}

type PronounCard = Pick<Card, 'term' | 'pos' | 'plural' | 'praeteritum' | 'partizip2' | 'examples'>;

/** The blank in one sentence, or null when it has no reflexive pronoun for this card. */
export function blankPronoun(example: Example, card: PronounCard): PronounQuestion | null {
  const sentence = example.de.trim();
  if (!sentence) return null;
  const reflexive = isReflexiveTerm(card.term);
  if (!reflexive && card.pos !== 'verb') return null;
  const tokens = tokenize(sentence);
  const at = reflexivePronounAt(tokens, formHits(tokens, card), !reflexive);
  if (at < 0) return null;
  const start = tokens.slice(0, at).reduce((n, t) => n + t.text.length, 0);
  const text = tokens[at].text;
  return {
    example: { ...example, de: sentence },
    before: sentence.slice(0, start),
    after: sentence.slice(start + text.length),
    text,
    pronoun: text.toLocaleLowerCase('de'),
  };
}

/** The question for a card: its first example that works, or null. */
export function pronounQuestion(card: PronounCard): PronounQuestion | null {
  if (!card.term.trim()) return null;
  for (const ex of card.examples ?? []) {
    const q = blankPronoun(ex, card);
    if (q) return q;
  }
  return null;
}

export function isPronounCard(card: PronounCard): boolean {
  return pronounQuestion(card) !== null;
}

/** The same person in the other case. */
const OTHER_CASE: Record<string, string> = { mich: 'mir', mir: 'mich', dich: 'dir', dir: 'dich' };
const ALL = Object.keys(REFLEXIVE_PRONOUNS);

/**
 * Four options, shuffled: the answer, the same person in the other case (mich ↔ mir), then
 * "sich" / "uns" / "euch", then the rest at random.
 */
export function pronounOptions(pronoun: string, rng: Rng = Math.random, n = 4): string[] {
  const answer = pronoun.toLocaleLowerCase('de');
  const preferred = [OTHER_CASE[answer], ...shuffle(['sich', 'uns', 'euch'], rng)].filter(Boolean);
  const rest = shuffle(ALL, rng);
  const picked: string[] = [];
  for (const p of [...preferred, ...rest]) {
    if (picked.length >= n - 1) break;
    if (p !== answer && !picked.includes(p)) picked.push(p);
  }
  return shuffle([answer, ...picked], rng);
}
