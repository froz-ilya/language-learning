import type { LevelCode } from '../levels/types';
import type { WordStatus } from '../progress';
import type { Pos } from '../types';
import type { Token } from './text';

/** What the level estimate needs to know about a word (from the offline dictionary). */
export interface WordRank {
  rank: number;
  pos: Pos;
}

/** Upper rank bound (80th percentile of content words) per level. */
export const LEVEL_BOUNDS: [LevelCode, number][] = [
  ['A1', 600],
  ['A2', 1300],
  ['B1', 2500],
  ['B2', 4000],
  ['C1', 6000],
];
const ORDER: LevelCode[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Rank assumed for a lower-case word the dictionary doesn't know (rare word). */
export const UNKNOWN_RANK = 9000;
/** Below this many content words there is too little text for an estimate. */
const MIN_CONTENT_WORDS = 12;
/** If the dictionary knows fewer than this share of words, it probably isn't loaded. */
const MIN_COVERAGE = 0.3;

/** Rank of the 80th-percentile content word used for the estimate (topic words make the tail rare). */
const PERCENTILE = 0.8;

/**
 * Words up to this rank are treated as familiar for highlighting: the upper bound of the user's
 * focus level ("level/B1" → 2500), or A2's bound when there is no level focus.
 */
export function comfortRank(focus: string): number {
  const code = focus.startsWith('level/') ? focus.slice(6) : '';
  if (code === 'C2') return Infinity;
  return LEVEL_BOUNDS.find(([c]) => c === code)?.[1] ?? 1300;
}

/** Articles, pronouns, prepositions… — not worth adding or counting toward difficulty. */
export function isFunctionWord(info: WordRank | null | undefined): boolean {
  return !!info && info.pos === 'other' && info.rank < 150;
}

const isLowerCase = (w: string) => !/^\p{Lu}/u.test(w);

/** Nearest-rank percentile of a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function levelForRank(rank: number): LevelCode {
  for (const [code, max] of LEVEL_BOUNDS) if (rank <= max) return code;
  return 'C2';
}

/** Average number of words per sentence. */
export function averageSentenceLength(tokens: Token[]): number {
  let words = 0;
  let sentences = 0;
  let inSentence = false;
  for (const t of tokens) {
    if (t.word) {
      words++;
      inSentence = true;
    } else if (inSentence && /[.!?]/.test(t.text)) {
      sentences++;
      inSentence = false;
    }
  }
  if (inSentence) sentences++;
  return sentences ? words / sentences : 0;
}

/**
 * Estimated CEFR level of a text: the 80th-percentile frequency rank of its content words
 * (A1 ≤600, A2 ≤1300, B1 ≤2500, B2 ≤4000, C1 ≤6000, else C2), nudged one level down for very
 * short sentences and up for long ones. `info(word)` gives the dictionary rank of the word's
 * lemma, or null if unknown. Capitalised unknown words are skipped (likely names); lower-case
 * unknown words count as rare. Null when the text is too short or the dictionary isn't loaded.
 */
export function estimateLevel(tokens: Token[], info: (word: string) => WordRank | null | undefined): LevelCode | null {
  const ranks: number[] = [];
  let known = 0;
  let total = 0;
  for (const t of tokens) {
    if (!t.word) continue;
    total++;
    const i = info(t.text);
    if (i) {
      known++;
      if (!isFunctionWord(i)) ranks.push(i.rank);
    } else if (isLowerCase(t.text) && t.text.length > 2) {
      ranks.push(UNKNOWN_RANK);
    }
  }
  if (ranks.length < MIN_CONTENT_WORDS || known / total < MIN_COVERAGE) return null;
  ranks.sort((a, b) => a - b);
  let idx = ORDER.indexOf(levelForRank(percentile(ranks, PERCENTILE)));
  const avg = averageSentenceLength(tokens);
  if (avg > 0 && avg < 8) idx--;
  else if (avg > 22) idx++;
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, idx))];
}

/**
 * Share (0…1) of the text's word tokens the user already knows: the word's lemma is a card
 * with status learned or known. `status(word)` gives that status (undefined when no card).
 */
export function knownShare(tokens: Token[], status: (word: string) => WordStatus | undefined): number {
  let words = 0;
  let known = 0;
  for (const t of tokens) {
    if (!t.word) continue;
    words++;
    const s = status(t.text);
    if (s === 'learned' || s === 'known') known++;
  }
  return words ? known / words : 0;
}
