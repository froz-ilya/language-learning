import { normalize } from '../german/answer';
import type { Card } from '../types';
import { shuffle, type Rng } from './session';

/**
 * Multiple-choice options: the card plus up to n-1 distractors from `pool`, preferring the
 * same part of speech, never repeating an answer text. Returned shuffled.
 */
export function choiceOptions(
  card: Card,
  pool: readonly Card[],
  answerOf: (c: Card) => string,
  n = 4,
  rng: Rng = Math.random,
): Card[] {
  const seen = new Set([normalize(answerOf(card))]);
  const candidates: Card[] = [];
  for (const c of shuffle(pool, rng)) {
    if (c === card || (c.id != null && c.id === card.id)) continue;
    const key = normalize(answerOf(c));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  const samePos = candidates.filter((c) => c.pos === card.pos);
  const otherPos = candidates.filter((c) => c.pos !== card.pos);
  const distractors = [...samePos, ...otherPos].slice(0, n - 1);
  return shuffle([card, ...distractors], rng);
}

/** Split into rounds of `size` pairs; a last round of 1 is merged into the previous one. */
export function matchRounds(cards: readonly Card[], size = 6): Card[][] {
  const rounds: Card[][] = [];
  for (let i = 0; i < cards.length; i += size) rounds.push(cards.slice(i, i + size));
  if (rounds.length > 1 && rounds[rounds.length - 1].length === 1) {
    rounds[rounds.length - 2].push(...rounds.pop()!);
  }
  return rounds;
}
